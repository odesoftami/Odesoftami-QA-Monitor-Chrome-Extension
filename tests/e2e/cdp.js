'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const CHROMIUM = process.env.CHROMIUM_BIN || '/Applications/Chromium.app/Contents/MacOS/Chromium';
const PROFILE = path.join(ROOT, '.tmp', 'e2e-profile');
const LOG_FILE = path.join(ROOT, '.tmp', 'e2e-chromium.log');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CDP {
  constructor(wsUrl, label) {
    this.wsUrl = wsUrl;
    this.label = label || 'target';
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.closed = false;
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket timeout for ' + this.label)), 10000);
      this.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(new Error('CDP WebSocket error for ' + this.label + ': ' + (event && event.message ? event.message : 'unknown')));
      });
    });
    this.ws.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8')); } catch (_) { return; }
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      const listeners = this.handlers.get(message.method) || [];
      for (const listener of listeners) {
        try { listener(message.params); } catch (_) { /* ignore listener errors */ }
      }
    });
    this.ws.addEventListener('close', () => {
      this.closed = true;
      for (const pending of this.pending.values()) pending.reject(new Error('CDP connection closed: ' + this.label));
      this.pending.clear();
    });
  }

  async send(method, params = {}, timeoutMs = 20000) {
    await this.ready;
    if (this.closed) throw new Error('CDP connection is closed: ' + this.label);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP timeout ' + method + ' on ' + this.label));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  on(method, listener) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(listener);
    return () => {
      const list = this.handlers.get(method) || [];
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    };
  }

  close() {
    try { this.ws.close(); } catch (_) { /* ignore */ }
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
  return response.json();
}

async function waitFor(fn, timeoutMs, intervalMs, description) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs || 100);
  }
  throw new Error((description || 'Condition') + ' timed out after ' + timeoutMs + 'ms' + (lastError ? ': ' + lastError.message : ''));
}

class PageClient {
  constructor(cdp, target, name) {
    this.cdp = cdp;
    this.target = target;
    this.name = name || target.url;
    this.exceptions = [];
    this.consoleErrors = [];
    cdp.on('Runtime.exceptionThrown', (params) => {
      const details = params && params.exceptionDetails;
      this.exceptions.push({
        text: details && (details.exception && details.exception.description || details.text) || 'unknown exception',
        url: details && details.url,
        line: details && details.lineNumber
      });
    });
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (!params || params.type !== 'error') return;
      const text = (params.args || []).map((arg) => arg.value || arg.description || '').join(' ');
      if (text) this.consoleErrors.push(text);
    });
    cdp.on('Log.entryAdded', (params) => {
      const entry = params && params.entry;
      if (!entry || entry.level !== 'error') return;
      this.consoleErrors.push(entry.text + (entry.url ? ' (' + entry.url + ')' : ''));
    });
  }

  async init() {
    await this.cdp.send('Runtime.enable');
    await this.cdp.send('Page.enable').catch(() => {});
    await this.cdp.send('Log.enable').catch(() => {});
    return this;
  }

  async evaluate(expression, timeoutMs = 20000) {
    const result = await this.cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    }, timeoutMs);
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception && result.exceptionDetails.exception.description
        || result.exceptionDetails.text;
      throw new Error('Page evaluation failed in ' + this.name + ': ' + description);
    }
    return result.result ? result.result.value : undefined;
  }

  async message(payload, timeoutMs = 20000) {
    return this.evaluate(
      '(async () => { const response = await chrome.runtime.sendMessage(' + JSON.stringify(payload) + '); return response; })()',
      timeoutMs
    );
  }

  async waitReady(timeoutMs = 15000) {
    await waitFor(async () => {
      try { return (await this.evaluate('document.readyState')) === 'complete'; } catch (_) { return false; }
    }, timeoutMs, 150, this.name + ' readyState');
  }

  async navigate(url, timeoutMs = 20000) {
    let done = false;
    const loaded = new Promise((resolve) => {
      const off = this.cdp.on('Page.loadEventFired', () => {
        if (done) return;
        done = true;
        off();
        resolve();
      });
      setTimeout(() => {
        if (done) return;
        done = true;
        off();
        resolve();
      }, timeoutMs);
    });
    await this.cdp.send('Page.navigate', { url });
    await loaded;
    await sleep(120);
    await this.waitReady(timeoutMs);
  }

  async screenshot(filePath, clip) {
    const params = { format: 'png' };
    if (clip) params.clip = { ...clip, scale: 1 };
    const result = await this.cdp.send('Page.captureScreenshot', params);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
    return filePath;
  }

  async setViewport(width, height) {
    await this.cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false
    });
  }

  close() {
    this.cdp.close();
  }
}

function extensionIdForPath(extensionPath) {
  const hex = crypto.createHash('sha256').update(extensionPath).digest('hex').slice(0, 32);
  return [...hex].map((character) => String.fromCharCode(97 + parseInt(character, 16))).join('');
}

async function findExtensionId(profile) {
  const candidates = [
    path.join(profile, 'Default', 'Secure Preferences'),
    path.join(profile, 'Default', 'Preferences')
  ];
  return waitFor(() => {
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        const settings = data && data.extensions && data.extensions.settings;
        if (!settings) continue;
        for (const [id, value] of Object.entries(settings)) {
          if (!value || !value.path) continue;
          const extensionPath = String(value.path).replace(/^'+|'+$/g, '');
          let resolved = path.resolve(extensionPath);
          try { resolved = fs.realpathSync(resolved); } catch (_) { /* keep resolved */ }
          if (resolved === ROOT && !value.disable_reasons) return id;
        }
      } catch (_) { /* profile may still be written */ }
    }
    return null;
  }, 15000, 150, 'extension id in profile');
}

async function findServiceWorkerTarget(port) {
  try {
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    return targets.find((target) => target.type === 'service_worker' && target.url.startsWith('chrome-extension://') && target.url.endsWith('/service-worker.js')) || null;
  } catch (_) {
    return null;
  }
}

async function launchBrowser(extensionPath = ROOT) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.rmSync(LOG_FILE, { force: true });
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE}`,
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-gpu-sandbox',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--disable-component-update',
    '--disable-features=OptimizationHints,MediaRouter',
    '--mute-audio',
    '--noerrdialogs',
    '--window-size=1280,900',
    'about:blank'
  ];
  const child = spawn(CHROMIUM, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  child.on('exit', (code, signal) => {
    logStream.write('\n[chromium exited code=' + code + ' signal=' + signal + ']\n');
  });

  const portFile = path.join(PROFILE, 'DevToolsActivePort');
  await waitFor(() => fs.existsSync(portFile), 20000, 100, 'DevToolsActivePort');
  const lines = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  const port = Number(lines[0]);
  const browserPath = lines[1];
  const browserUrl = `ws://127.0.0.1:${port}${browserPath}`;
  const browser = new CDP(browserUrl, 'browser');
  await browser.ready;

  const extensionId = extensionIdForPath(extensionPath);
  const serviceWorker = await findServiceWorkerTarget(port);
  return { child, browser, port, serviceWorker, extensionId, logFile: LOG_FILE };
}

async function createPage(browser, port, url, name) {
  const created = await browser.send('Target.createTarget', { url });
  const target = await waitFor(async () => {
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    return targets.find((item) => item.id === created.targetId);
  }, 10000, 100, 'page target ' + url);
  const cdp = new CDP(target.webSocketDebuggerUrl, name || url);
  const page = new PageClient(cdp, target, name || url);
  await page.init();
  return page;
}

async function closePage(browser, page) {
  try { await browser.send('Target.closeTarget', { targetId: page.target.id }); } catch (_) { /* ignore */ }
  page.close();
}

function readLogTail(maxBytes = 6000) {
  if (!fs.existsSync(LOG_FILE)) return '';
  const size = fs.statSync(LOG_FILE).size;
  const start = Math.max(0, size - maxBytes);
  const fd = fs.openSync(LOG_FILE, 'r');
  const buffer = Buffer.alloc(size - start);
  fs.readSync(fd, buffer, 0, buffer.length, start);
  fs.closeSync(fd);
  return buffer.toString('utf8');
}

module.exports = {
  ROOT, CHROMIUM, PROFILE, LOG_FILE,
  sleep, CDP, PageClient, launchBrowser, createPage, closePage, waitFor, fetchJson, readLogTail,
  findServiceWorkerTarget, extensionIdForPath
};
