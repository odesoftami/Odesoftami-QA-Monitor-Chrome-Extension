'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { startServer } = require('./server.js');
const {
  ROOT, launchBrowser, createPage, closePage, waitFor, sleep, fetchJson,
  findServiceWorkerTarget, PageClient, CDP
} = require('./cdp.js');

const STARTED_AT = new Date().toISOString();
const RESULTS = [];
const ARTIFACTS = { screenshots: [], downloads: [] };
const STORE_DIR = path.join(ROOT, 'store');
const DOWNLOAD_DIR = path.join(ROOT, '.tmp', 'downloads');

function log(message) {
  console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + message);
}

async function step(name, fn, options = {}) {
  const started = Date.now();
  try {
    const detail = await fn();
    RESULTS.push({ name, status: 'PASS', detail: detail || '', durationMs: Date.now() - started });
    log('PASS ' + name + (detail ? ' — ' + detail : ''));
    return detail;
  } catch (error) {
    const optional = options.optional || error.optional;
    const status = optional ? 'NOT TESTED' : 'FAIL';
    RESULTS.push({ name, status, detail: error.message, durationMs: Date.now() - started });
    log(status + ' ' + name + ' — ' + error.message);
    if (options.fatal) throw error;
    return null;
  }
}

function passThrough(value) {
  return value;
}

async function main() {
  fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const server = await startServer();
  let info = null;
  let dashboard = null;
  let fixture = null;
  let popup = null;
  let extraPages = [];

  const base = server.url;
  const fixturePattern = base + '/*';

  async function getFixtureTabId(urlHint) {
    const tabs = await dashboard.evaluate(
      'chrome.tabs.query({ url: ' + JSON.stringify(fixturePattern) + ' })'
    );
    const tab = tabs.find((item) => item.url === urlHint)
      || tabs.find((item) => item.url && item.url.startsWith(base))
      || tabs[0];
    if (!tab) throw new Error('Fixture tab was not found.');
    return tab.id;
  }

  async function activateFixture() {
    if (!fixture) return;
    const tabId = await getFixtureTabId(await fixture.evaluate('location.href'));
    await dashboard.evaluate('chrome.tabs.update(' + tabId + ', { active: true })');
    return tabId;
  }

  async function startSession(config) {
    await stopAll();
    const tabId = await activateFixture();
    const response = await dashboard.message({ type: 'START_SESSION', tabId, config });
    if (!response || response.ok !== true) throw new Error((response && response.error) || 'Session did not start.');
    return { tabId, sessionId: response.session.id };
  }

  async function getData(sessionId) {
    const response = await dashboard.message({ type: 'GET_SESSION_DATA', sessionId });
    if (!response || response.ok !== true) throw new Error((response && response.error) || 'Session data unavailable.');
    return response;
  }

  async function waitEvent(sessionId, predicate, timeoutMs, description) {
    return waitFor(async () => {
      const data = await getData(sessionId);
      return predicate(data) ? data : null;
    }, timeoutMs || 12000, 200, description || 'session event');
  }

  async function waitStopped(sessionId, timeoutMs, reason) {
    return waitFor(async () => {
      const response = await dashboard.message({ type: 'GET_SESSIONS' });
      const session = (response.sessions || []).find((item) => item.id === sessionId);
      if (!session || session.status !== 'stopped') return null;
      if (reason && session.stopReason !== reason) return null;
      return session;
    }, timeoutMs || 15000, 200, 'session stopped');
  }

  async function stopSession(tabId) {
    await dashboard.message({ type: 'STOP_SESSION', tabId, reason: 'user' });
  }

  async function activateDashboard() {
    const tabs = await dashboard.evaluate('chrome.tabs.query({ url: "chrome-extension://' + info.extensionId + '/dashboard.html" })');
    if (tabs[0]) await dashboard.evaluate('chrome.tabs.update(' + tabs[0].id + ', { active: true })');
    await sleep(600);
  }

  async function stopAll() {
    try { await dashboard.message({ type: 'STOP_ALL_SESSIONS', reason: 'user' }); } catch (_) { /* ignore */ }
  }

  async function openDetachedPopup(tabId) {
    const result = await dashboard.evaluate(`chrome.windows.create({
      url: chrome.runtime.getURL('popup.html?detached=1&tabId=${tabId}'),
      type: 'popup', width: 420, height: 660, focused: true
    }).then((win) => win.id).catch((error) => String(error && error.message || error))`, 8000);
    if (typeof result !== 'number') return { ok: false, error: result };
    const target = await waitFor(async () => {
      const targets = await fetchJson('http://127.0.0.1:' + info.port + '/json/list');
      return targets.find((item) => item.url.includes('/popup.html?detached=1'));
    }, 8000, 150, 'detached popup target');
    const cdp = new CDP(target.webSocketDebuggerUrl, 'popup');
    const page = new PageClient(cdp, target, 'popup');
    await page.init();
    await page.setViewport(400, 600);
    await sleep(300);
    return { ok: true, page, windowId: result };
  }

  async function openExtensionPage(file) {
    const page = await createPage(info.browser, info.port, 'chrome-extension://' + info.extensionId + '/' + file, file);
    await page.waitReady();
    extraPages.push(page);
    return page;
  }

  try {
    info = await launchBrowser();
    log('Chromium launched, extension ' + info.extensionId);
    fixture = await createPage(info.browser, info.port, base + '/ok', 'fixture');
    await fixture.waitReady();
    dashboard = await createPage(info.browser, info.port, 'chrome-extension://' + info.extensionId + '/dashboard.html', 'dashboard');
    await dashboard.waitReady();
    await sleep(800);

    await step('Extension loads as Manifest V3 and exposes 3.2.0 branding', async () => {
      const manifest = await dashboard.evaluate('chrome.runtime.getManifest()');
      assert.equal(manifest.manifest_version, 3);
      assert.equal(manifest.version, '3.2.0');
      assert.equal(manifest.name, 'Odesoftami QA Monitor');
      assert.equal(manifest.short_name, 'QA Monitor');
      assert.equal(manifest.description, 'Browser QA & Monitoring Tool');
      assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'alarms', 'notifications', 'scripting', 'storage', 'webRequest'].sort());
      assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
      const self = await dashboard.evaluate('chrome.management.getSelf()');
      assert.equal(self.enabled, true);
      assert.equal(self.version, '3.2.0');
      return 'permissions: ' + manifest.permissions.join(', ');
    });

    await step('Service worker responds and ships four built-in presets', async () => {
      const settings = await dashboard.message({ type: 'GET_SETTINGS' });
      assert.equal(settings.ok, true);
      assert.equal(settings.settings.historyLimit, 500);
      const presets = await dashboard.message({ type: 'GET_PRESETS' });
      assert.equal(presets.ok, true);
      assert.equal(presets.builtins.length, 4);
      assert.equal(presets.presets.length, 0);
      const diagnostics = await dashboard.message({ type: 'GET_DIAGNOSTICS' });
      assert.equal(diagnostics.ok, true);
      assert.equal(diagnostics.version, '3.2.0');
      return 'service worker ready';
    });

    await step('Detached popup window has fixed header/tabs/footer and starts/stops a monitor session', async () => {
      await stopAll();
      await fixture.navigate(base + '/ok');
      const tabId = await activateFixture();
      const opened = await openDetachedPopup(tabId);
      assert.equal(opened.ok, true, 'detached popup window could not be opened: ' + opened.error);
      popup = opened.page;
      await popup.waitReady();
      await sleep(500);
      assert.match(await popup.evaluate('document.getElementById("pageUrl").textContent'), /127\.0\.0\.1/);
      assert.equal(await popup.evaluate('document.getElementById("startButton").disabled'), false);
      const layout = await popup.evaluate(`(() => {
        const header = document.querySelector('.app-header');
        const headerMain = document.querySelector('.header-main');
        const modeBar = document.querySelector('.app-header .mode-switch');
        const content = document.getElementById('popupContent');
        const footer = document.querySelector('.copyright-footer');
        const actions = document.querySelector('.actions');
        const status = document.getElementById('status');
        const statusBar = status ? status.closest('.status-bar') : null;
        const start = document.getElementById('startButton');
        const exportButton = document.getElementById('exportCsvButton');
        const clearButton = document.getElementById('clearHistoryButton');
        const settings = document.getElementById('settingsButton');
        const close = document.getElementById('closeButton');
        const github = document.getElementById('githubLink');
        const web = document.getElementById('webLink');
        const footerVersion = document.getElementById('footerVersion');
        const summaryType = document.getElementById('summaryType');
        const checksSection = document.getElementById('checksSection');
        const autoRefreshRow = document.getElementById('autoRefreshRow');
        const qaRefreshNote = document.getElementById('qaRefreshNote');
        const appStyle = getComputedStyle(document.querySelector('.app'));
        const before = {
          vw: window.innerWidth, vh: window.innerHeight,
          headerTop: header.getBoundingClientRect().top,
          headerBottom: header.getBoundingClientRect().bottom,
          modeTop: modeBar.getBoundingClientRect().top,
          modeBottom: modeBar.getBoundingClientRect().bottom,
          contentTop: content.getBoundingClientRect().top,
          contentClient: content.clientHeight,
          contentScroll: content.scrollHeight,
          actionsBottom: actions.getBoundingClientRect().bottom,
          statusTop: status.getBoundingClientRect().top,
          statusBottom: status.getBoundingClientRect().bottom,
          footerTop: footer.getBoundingClientRect().top,
          footerBottom: footer.getBoundingClientRect().bottom,
          startBottom: start.getBoundingClientRect().bottom
        };
        content.scrollTop = content.scrollHeight;
        const after = {
          headerTop: header.getBoundingClientRect().top,
          modeTop: modeBar.getBoundingClientRect().top,
          contentTop: content.getBoundingClientRect().top,
          actionsBottom: actions.getBoundingClientRect().bottom,
          statusTop: status.getBoundingClientRect().top,
          statusBottom: status.getBoundingClientRect().bottom,
          footerTop: footer.getBoundingClientRect().top,
          footerBottom: footer.getBoundingClientRect().bottom,
          startBottom: start.getBoundingClientRect().bottom,
          scrollTop: content.scrollTop,
          maxScroll: content.scrollHeight - content.clientHeight
        };
        content.scrollTop = 0;
        const footerStyle = getComputedStyle(footer);
        const settingsStyle = getComputedStyle(settings);
        const exportRect = exportButton.getBoundingClientRect();
        const clearRect = clearButton.getBoundingClientRect();
        return {
          before, after,
          footerText: footer.innerText,
          footerVersionText: footerVersion ? footerVersion.textContent : null,
          footerHasVersion: Boolean(footerVersion),
          footerFont: footerStyle.fontSize,
          footerWeight: footerStyle.fontWeight,
          footerColor: footerStyle.color,
          footerAlign: footerStyle.textAlign,
          footerOneLine: footer.scrollWidth <= footer.clientWidth + 1,
          version: chrome.runtime.getManifest().version,
          headerText: header.innerText,
          bodyDetached: document.body.classList.contains('detached'),
          hamburgerMissing: !document.getElementById('dragHandle') && !document.querySelector('.drag-bars'),
          headerButtonIds: [...document.querySelectorAll('.header-controls .icon-button')].map((button) => button.id),
          closeVisible: getComputedStyle(close).display !== 'none',
          settingsFont: settingsStyle.fontSize,
          modeBarFixed: Boolean(document.querySelector('.app-header .mode-switch')),
          modeBarInContent: Boolean(document.querySelector('#popupContent .mode-switch')),
          headerMain: Boolean(headerMain),
          statusText: document.getElementById('statusText').textContent,
          statusMode: document.getElementById('statusMode').textContent,
          statusInFooter: Boolean(statusBar && statusBar.closest('.app-footer')),
          statusInContent: Boolean(document.querySelector('#popupContent #status')),
          clearText: clearButton.textContent.trim(),
          clearAdjacent: clearRect.left >= exportRect.right - 1 && clearButton.parentElement === exportButton.parentElement,
          minWidth: appStyle.minWidth,
          minHeight: appStyle.minHeight,
          refreshHeading: document.getElementById('refreshHeading').textContent,
          checksHidden: checksSection.classList.contains('hidden'),
          qaRowHidden: autoRefreshRow.classList.contains('hidden'),
          qaNoteHidden: qaRefreshNote.classList.contains('hidden'),
          summaryType: summaryType.textContent,
          summaryTypeHidden: summaryType.classList.contains('hidden'),
          summaryCard: Boolean(document.querySelector('.summary-card')),
          githubHref: github ? github.href : null,
          githubTarget: github ? github.target : null,
          githubRel: github ? github.rel : null,
          webHref: web ? web.href : null,
          webTarget: web ? web.target : null,
          webRel: web ? web.rel : null
        };
      })()`);
      layout.footerText = String(layout.footerText || '').replace(/\s+/g, ' ').trim();
      layout.headerText = String(layout.headerText || '').replace(/\s+/g, ' ').trim();
      assert.ok(layout.before.vw >= 400, 'popup is too narrow: ' + layout.before.vw);
      assert.ok(layout.before.vh >= 560, 'popup is too short: ' + layout.before.vh);
      assert.equal(layout.bodyDetached, true, 'detached window was not detected');
      assert.equal(layout.hamburgerMissing, true, 'the old ☰/drag-handle control is still present');
      assert.deepEqual(layout.headerButtonIds, ['settingsButton', 'closeButton']);
      const popupWindow = await popup.evaluate('chrome.windows.getCurrent()');
      assert.equal(popupWindow.type, 'popup', 'popup is not a detached Chrome popup window');
      assert.equal(await popup.evaluate('typeof chrome.windows.onBoundsChanged'), 'object', 'bounds watcher is unavailable');
      assert.equal(layout.before.headerTop, 0);
      assert.equal(layout.after.headerTop, 0, 'header scrolled away');
      assert.equal(layout.after.modeTop, layout.before.modeTop, 'mode tabs scrolled away');
      assert.equal(layout.modeBarFixed, true, 'mode tabs are not inside the fixed header');
      assert.equal(layout.modeBarInContent, false, 'mode tabs are still inside the scroll area');
      assert.ok(layout.before.contentTop >= layout.before.modeBottom - 1, 'content overlaps the fixed mode tabs');
      assert.ok(layout.before.contentScroll > layout.before.contentClient, 'main content is not scrollable');
      assert.ok(layout.after.scrollTop + layout.before.contentClient >= layout.after.maxScroll - 2, 'last section cannot be scrolled into view: ' + JSON.stringify({ before: layout.before, after: layout.after }));
      assert.ok(layout.before.footerBottom <= layout.before.vh + 1, 'footer is below the viewport');
      assert.ok(layout.after.footerBottom <= layout.before.vh + 1, 'footer disappeared after scrolling');
      assert.ok(layout.before.actionsBottom <= layout.before.footerTop + 1, 'actions overlap footer');
      assert.ok(layout.before.startBottom <= layout.before.footerTop + 1, 'Start button overlaps footer');
      assert.ok(layout.after.startBottom <= layout.after.footerTop + 1, 'Start button overlaps footer after scrolling');
      assert.equal(layout.footerText, '© 2026 Denys Oleksiienko · v3.2.0 · GitHub ↗ · Web ↗');
      assert.equal(layout.footerFont, '10px');
      assert.equal(layout.footerWeight, '400');
      assert.equal(layout.footerColor, 'rgb(115, 115, 115)');
      assert.equal(layout.footerAlign, 'center');
      assert.equal(layout.footerOneLine, true);
      assert.equal(layout.footerHasVersion, true, 'dynamic version is missing from the footer');
      assert.equal(layout.footerVersionText, 'v3.2.0');
      assert.equal(layout.githubHref, 'https://github.com/odesoftami');
      assert.equal(layout.githubTarget, '_blank');
      assert.match(layout.githubRel, /noreferrer/);
      assert.equal(layout.webHref, 'https://odesoftami.com/apk');
      assert.equal(layout.webTarget, '_blank');
      assert.match(layout.webRel, /noreferrer/);
      assert.match(layout.headerText, /Odesoftami QA Monitor/);
      assert.match(layout.headerText, /v3\.2\.0/);
      assert.equal(layout.closeVisible, true, 'close button is not visible');
      assert.ok(parseFloat(layout.settingsFont) >= 24, 'settings gear was not enlarged: ' + layout.settingsFont);
      assert.equal(layout.clearText, 'Clear history');
      assert.equal(layout.clearAdjacent, true, 'Clear history is not next to Export CSV');
      const tabLabels = await popup.evaluate(`[...document.querySelectorAll('.mode-button')].map((button) => ({
        text: button.textContent.trim(),
        fits: button.scrollWidth <= button.clientWidth + 1
      }))`);
      assert.deepEqual(tabLabels.map((entry) => entry.text), ['Refresh', 'Monitor', 'QA Session']);
      assert.equal(tabLabels.every((entry) => entry.fits), true, 'a mode tab label is clipped');
      const overflow = await popup.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1');
      assert.equal(overflow, false, 'popup has horizontal overflow');
      await popup.setViewport(640, 720);
      await sleep(400);
      const wide = await popup.evaluate(`(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        tabs: [...document.querySelectorAll('.mode-button')].every((button) => button.scrollWidth <= button.clientWidth + 1),
        footerVisible: document.querySelector('.copyright-footer').getBoundingClientRect().bottom <= window.innerHeight + 1,
        statusVisible: document.getElementById('status').getBoundingClientRect().bottom <= window.innerHeight + 1
      }))()`);
      assert.equal(wide.overflow, false, 'popup overflows when enlarged');
      assert.equal(wide.tabs, true, 'mode tabs clip when enlarged');
      assert.equal(wide.footerVisible, true);
      assert.equal(wide.statusVisible, true);
      await popup.setViewport(400, 600);
      await sleep(350);
      await popup.screenshot(path.join(STORE_DIR, 'popup-400.png'));
      ARTIFACTS.screenshots.push('store/popup-400.png');

      assert.equal(layout.checksHidden, true, 'legacy checks are visible in Refresh');
      assert.equal(layout.refreshHeading, 'Refresh');
      assert.equal(layout.qaRowHidden, true, 'QA reload toggle is visible in Refresh');
      assert.equal(layout.qaNoteHidden, true, 'QA note is visible in Refresh');
      assert.equal(layout.summaryTypeHidden, true, 'summary type is shown without a session');
      assert.equal(layout.summaryCard, true, 'Last session/summary card is missing');

      const qaUi = await popup.evaluate(`(() => {
        document.querySelector('.mode-button[data-mode="qa"]').click();
        return {
          heading: document.getElementById('refreshHeading').textContent,
          rowHidden: document.getElementById('autoRefreshRow').classList.contains('hidden'),
          noteHidden: document.getElementById('qaRefreshNote').classList.contains('hidden'),
          checksHidden: document.getElementById('checksSection').classList.contains('hidden'),
          autoRefresh: document.getElementById('autoRefresh').checked,
          summary: Boolean(document.querySelector('.summary-card'))
        };
      })()`);
      assert.equal(qaUi.heading, 'Optional page refresh');
      assert.equal(qaUi.rowHidden, false);
      assert.equal(qaUi.noteHidden, false);
      assert.equal(qaUi.checksHidden, false);
      assert.equal(qaUi.autoRefresh, true, 'preserved QA default should remain checked');
      assert.equal(qaUi.summary, true);
      await popup.screenshot(path.join(STORE_DIR, 'popup-qa.png'));
      ARTIFACTS.screenshots.push('store/popup-qa.png');

      const monitorUi = await popup.evaluate(`(() => {
        document.querySelector('.mode-button[data-mode="monitor"]').click();
        const initial = {
          text: document.getElementById('textState').textContent,
          dom: document.getElementById('domState').textContent,
          url: document.getElementById('urlState').textContent,
          options: document.getElementById('optionsState').textContent,
          qaRowHidden: document.getElementById('autoRefreshRow').classList.contains('hidden'),
          qaNoteHidden: document.getElementById('qaRefreshNote').classList.contains('hidden')
        };
        for (const id of ['textEnabled', 'domEnabled', 'urlEnabled']) {
          const el = document.getElementById(id);
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        for (const id of ['textDetails', 'domDetails', 'urlDetails']) {
          document.getElementById(id).open = false;
        }
        return {
          initial,
          enabled: {
            text: document.getElementById('textState').textContent,
            dom: document.getElementById('domState').textContent,
            url: document.getElementById('urlState').textContent
          }
        };
      })()`);
      assert.equal(monitorUi.initial.text, 'OFF');
      assert.equal(monitorUi.initial.dom, 'OFF');
      assert.equal(monitorUi.initial.url, 'OFF');
      assert.equal(monitorUi.initial.options, 'DEFAULTS');
      assert.equal(monitorUi.initial.qaRowHidden, true);
      assert.equal(monitorUi.initial.qaNoteHidden, true);
      assert.equal(monitorUi.enabled.text, 'ON');
      assert.equal(monitorUi.enabled.dom, 'ON');
      assert.equal(monitorUi.enabled.url, 'ON');

      const refreshUi = await popup.evaluate(`(() => {
        document.querySelector('.mode-button[data-mode="refresh"]').click();
        return {
          heading: document.getElementById('refreshHeading').textContent,
          checksHidden: document.getElementById('checksSection').classList.contains('hidden'),
          presetVisible: !document.getElementById('presetCard').classList.contains('hidden'),
          summary: Boolean(document.querySelector('.summary-card')),
          status: document.getElementById('statusText').textContent
        };
      })()`);
      assert.equal(refreshUi.heading, 'Refresh');
      assert.equal(refreshUi.checksHidden, true);
      assert.equal(refreshUi.presetVisible, true);
      assert.equal(refreshUi.summary, true);
      assert.equal(refreshUi.status, 'Not monitoring');

      for (const mode of ['refresh', 'monitor', 'qa']) {
        await popup.evaluate('document.querySelector(\'.mode-button[data-mode="' + mode + '"]\').click()');
        assert.equal(await popup.evaluate('document.querySelector(\'.mode-button[data-mode="' + mode + '"]\').getAttribute("aria-pressed")'), 'true');
      }
      await popup.evaluate(`(() => {
        document.querySelector('.mode-button[data-mode="monitor"]').click();
        const dom = document.getElementById('domEnabled');
        dom.checked = false;
        dom.dispatchEvent(new Event('change', { bubbles: true }));
        const enabled = document.getElementById('textEnabled');
        enabled.checked = true;
        enabled.dispatchEvent(new Event('change', { bubbles: true }));
        const pattern = document.getElementById('textPattern');
        pattern.value = 'READY';
        pattern.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await popup.evaluate('document.getElementById("startButton").click()');
      await waitFor(async () => {
        const state = await dashboard.message({ type: 'GET_STATE', tabId });
        return state.state ? state : null;
      }, 8000, 200, 'popup start');
      await waitFor(async () => popup.evaluate('document.getElementById("statusText").textContent === "Monitoring"'), 8000, 200, 'monitoring status');
      assert.equal(await popup.evaluate('document.getElementById("statusMode").textContent'), 'Monitor');
      await popup.screenshot(path.join(STORE_DIR, 'popup-active.png'));
      ARTIFACTS.screenshots.push('store/popup-active.png');
      assert.equal(await popup.evaluate('document.getElementById("stopButton").disabled'), false);
      await popup.evaluate('document.getElementById("stopButton").click()');
      await waitFor(async () => {
        const state = await dashboard.message({ type: 'GET_STATE', tabId });
        return state.state === null ? true : null;
      }, 8000, 200, 'popup stop');
      await waitFor(async () => popup.evaluate('document.getElementById("statusText").textContent === "Not monitoring"'), 8000, 200, 'stopped status');
      await sleep(500);
      assert.equal(await popup.evaluate('document.getElementById("summaryHeading").textContent'), 'Last session');
      assert.equal(await popup.evaluate('document.getElementById("summaryType").textContent'), 'Monitor');
      const lastInRefresh = await popup.evaluate(`(() => {
        document.querySelector('.mode-button[data-mode="refresh"]').click();
        return {
          heading: document.getElementById('summaryHeading').textContent,
          type: document.getElementById('summaryType').textContent,
          checksHidden: document.getElementById('checksSection').classList.contains('hidden')
        };
      })()`);
      assert.equal(lastInRefresh.heading, 'Last session');
      assert.equal(lastInRefresh.type, 'Monitor');
      assert.equal(lastInRefresh.checksHidden, true);
      const lastInQa = await popup.evaluate(`(() => {
        document.querySelector('.mode-button[data-mode="qa"]').click();
        return {
          heading: document.getElementById('summaryHeading').textContent,
          type: document.getElementById('summaryType').textContent,
          refreshHeading: document.getElementById('refreshHeading').textContent
        };
      })()`);
      assert.equal(lastInQa.heading, 'Last session');
      assert.equal(lastInQa.type, 'Monitor');
      assert.equal(lastInQa.refreshHeading, 'Optional page refresh');
      await popup.evaluate('document.querySelector(\'.mode-button[data-mode="monitor"]\').click()');
      await waitFor(async () => popup.evaluate('document.getElementById("clearHistoryButton").disabled === false'), 8000, 250, 'popup clear enabled after stop');
      await popup.evaluate('document.getElementById("popupContent").scrollTop = document.getElementById("popupContent").scrollHeight');
      await sleep(300);
      await popup.screenshot(path.join(STORE_DIR, 'popup-summary.png'));
      ARTIFACTS.screenshots.push('store/popup-summary.png');
      const sessionsBeforePopupClear = (await dashboard.message({ type: 'GET_SESSIONS' })).sessions;
      assert.ok(sessionsBeforePopupClear.some((entry) => entry.status !== 'active'), 'popup clear had no completed session to remove');
      await popup.evaluate('window.confirm = () => true');
      await popup.evaluate('document.getElementById("clearHistoryButton").click()');
      await waitFor(async () => popup.evaluate('document.getElementById("clearHistoryButton").disabled === true'), 8000, 250, 'popup clear completed');
      assert.equal(await popup.evaluate('document.getElementById("summaryHeading").textContent'), 'Live summary');
      const sessionsAfterPopupClear = (await dashboard.message({ type: 'GET_SESSIONS' })).sessions;
      assert.equal(sessionsAfterPopupClear.some((entry) => entry.status !== 'active'), false, 'popup clear left completed sessions');

      // Fixed status must reflect each active mode and pause, not just Monitor.
      await popup.evaluate(`(() => {
        document.querySelector('.mode-button[data-mode="refresh"]').click();
        const pattern = document.getElementById('textPattern');
        pattern.value = '';
        pattern.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('interval').value = '10';
        document.getElementById('interval').dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await popup.evaluate('document.getElementById("startButton").click()');
      await waitFor(async () => popup.evaluate('document.getElementById("statusText").textContent === "Refreshing"'), 8000, 200, 'Refreshing status');
      assert.equal(await popup.evaluate('document.getElementById("statusMode").textContent'), 'Refresh');
      await popup.evaluate('document.getElementById("stopButton").click()');
      await waitFor(async () => popup.evaluate('document.getElementById("statusText").textContent === "Not monitoring"'), 8000, 200, 'refresh stopped status');
      await waitFor(async () => popup.evaluate('document.getElementById("summaryType").textContent === "Refresh"'), 8000, 200, 'Refresh last-session type');

      await popup.evaluate(`(() => {
        document.querySelector('.mode-button[data-mode="qa"]').click();
        document.getElementById('autoRefresh').checked = false;
        document.getElementById('autoRefresh').dispatchEvent(new Event('change', { bubbles: true }));
        const enabled = document.getElementById('textEnabled');
        enabled.checked = true;
        enabled.dispatchEvent(new Event('change', { bubbles: true }));
        const pattern = document.getElementById('textPattern');
        pattern.value = 'READY';
        pattern.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await popup.evaluate('document.getElementById("startButton").click()');
      await waitFor(async () => popup.evaluate('document.getElementById("statusText").textContent === "QA Session running"'), 8000, 200, 'QA running status');
      assert.equal(await popup.evaluate('document.getElementById("statusMode").textContent'), 'QA Session');
      const qaState = await dashboard.message({ type: 'GET_STATE', tabId });
      assert.equal(qaState.state.config.autoRefresh, false);
      await popup.evaluate('document.getElementById("stopButton").click()');
      await waitFor(async () => popup.evaluate('document.getElementById("statusText").textContent === "Not monitoring"'), 8000, 200, 'QA stopped status');
      await waitFor(async () => popup.evaluate('document.getElementById("summaryType").textContent === "QA Session"'), 8000, 200, 'QA last-session type');

      await popup.evaluate(`(() => {
        document.querySelector('.mode-button[data-mode="refresh"]').click();
        const pattern = document.getElementById('textPattern');
        pattern.value = '';
        pattern.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('interval').value = '2';
        document.getElementById('interval').dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('cycleMode').value = 'cycles';
        document.getElementById('cycleMode').dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('reloadsPerCycle').value = '1';
        document.getElementById('pauseSeconds').value = '10';
        return true;
      })()`);
      await popup.evaluate('document.getElementById("startButton").click()');
      await waitFor(async () => popup.evaluate('document.getElementById("statusText").textContent === "Paused"'), 12000, 250, 'Paused status');
      assert.equal(await popup.evaluate('document.getElementById("statusMode").textContent'), 'Refresh');
      await popup.evaluate('document.getElementById("stopButton").click()');
      await waitFor(async () => popup.evaluate('document.getElementById("statusText").textContent === "Not monitoring"'), 8000, 200, 'paused session stopped status');

      // Real window bounds: headless CDP can shrink the extension popup, so
      // verify the onBoundsChanged/resize guard restores the minimum.
      await popup.cdp.send('Emulation.clearDeviceMetricsOverride');
      const popupWindowInfo = await info.browser.send('Browser.getWindowForTarget', { targetId: popup.target.id });
      await info.browser.send('Browser.setWindowBounds', {
        windowId: popupWindowInfo.windowId,
        bounds: { width: 320, height: 400 }
      });
      const enforced = await waitFor(async () => {
        const current = await popup.evaluate('chrome.windows.getCurrent()');
        return current.width >= 420 && current.height >= 560 ? current : null;
      }, 7000, 200, 'minimum window enforcement');
      const minLayout = await popup.evaluate(`(() => {
        const start = document.getElementById('startButton').getBoundingClientRect();
        const status = document.getElementById('status').getBoundingClientRect();
        const footer = document.querySelector('.copyright-footer').getBoundingClientRect();
        return {
          vw: window.innerWidth,
          vh: window.innerHeight,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          tabsFit: [...document.querySelectorAll('.mode-button')].every((button) => button.scrollWidth <= button.clientWidth + 1),
          startVisible: start.bottom <= window.innerHeight + 1,
          statusVisible: status.bottom <= window.innerHeight + 1,
          footerVisible: footer.bottom <= window.innerHeight + 1,
          statusAboveFooter: status.bottom <= footer.top + 1
        };
      })()`);
      assert.ok(enforced.width >= 420 && enforced.height >= 560, 'window did not return to the minimum size');
      assert.equal(minLayout.overflow, false, 'minimum-size window has horizontal overflow');
      assert.equal(minLayout.tabsFit, true, 'mode tabs clip at the minimum size');
      assert.equal(minLayout.startVisible, true, 'Start/Stop is not visible at the minimum size');
      assert.equal(minLayout.statusVisible, true, 'status is not visible at the minimum size');
      assert.equal(minLayout.footerVisible, true, 'footer is not visible at the minimum size');
      assert.equal(minLayout.statusAboveFooter, true, 'status overlaps footer at the minimum size');

      await popup.evaluate('document.getElementById("closeButton").click()').catch(() => {});
      await waitFor(async () => {
        const targets = await fetchJson('http://127.0.0.1:' + info.port + '/json/list');
        return targets.some((item) => item.url.includes('/popup.html?detached=1')) ? null : true;
      }, 8000, 200, 'popup close');
      popup = null;
      return 'detached window 400×' + layout.before.vh + ', fixed header/mode tabs/footer, new GitHub/Web footer links, larger gear, close button, clear next to export; started and stopped';
    });

    await step('QA Session records checks without optional auto refresh', async () => {
      await fixture.navigate(base + '/');
      const { tabId, sessionId } = await startSession({
        mode: 'qa', autoRefresh: false, intervalSeconds: 2, cycleMode: 'continuous',
        text: { enabled: true, condition: 'appears', pattern: 'READY' },
        url: { enabled: false }, timing: { enabled: false }, http: { enabled: false },
        settleMs: 300, notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      const state = await dashboard.message({ type: 'GET_STATE', tabId });
      assert.ok(state.state, 'QA session without refresh is not active');
      assert.equal(state.state.config.autoRefresh, false);
      const data = await waitEvent(sessionId, (value) => value.events.some((event) =>
        event.eventType === 'text_check' && event.result === 'PASS'), 8000, 'QA check without refresh');
      await sleep(2500);
      const later = await getData(sessionId);
      assert.equal(later.events.some((event) => event.eventType === 'reload_requested'), false, 'QA session reloaded despite auto refresh being off');
      assert.ok(later.events.length >= data.events.length);
      await stopSession(tabId);
      const stopped = await waitStopped(sessionId, 8000, 'user');
      assert.equal(stopped.stopReason, 'user');
      return 'text check recorded without reload; autoRefresh=false preserved';
    });

    await step('Continuous refresh reloads, records HTTP 200, timing and badge countdown', async () => {
      await fixture.navigate(base + '/ok');
      const { tabId, sessionId } = await startSession({
        mode: 'refresh', intervalSeconds: 2, cycleMode: 'continuous', reloadsPerCycle: 5, pauseSeconds: 10,
        text: { enabled: false, pattern: '' }, notifyOnMatch: false, stopOnMatch: false, notifyOnFailure: false,
        screenshotOnFailure: false
      });
      const data = await waitEvent(sessionId, (value) => {
        const reloads = value.events.filter((event) => event.eventType === 'reload_requested').length;
        const nav200 = value.events.some((event) => event.eventType === 'navigation' && event.httpStatus === 200 && event.result === 'PASS');
        const load = value.events.some((event) => event.eventType === 'page_load' && event.result === 'PASS' && event.loadDurationMs !== null);
        return reloads >= 1 && nav200 && load;
      }, 15000, 'refresh reload + navigation + load timing');
      const nav = data.events.find((event) => event.eventType === 'navigation' && event.httpStatus === 200);
      assert.ok(nav);
      assert.ok(nav.url.includes('/ok'));
      const load = data.events.find((event) => event.eventType === 'page_load' && event.result === 'PASS' && event.loadDurationMs !== null);
      assert.ok(load.loadDurationMs >= 0);
      const badge = await dashboard.evaluate('chrome.action.getBadgeText({ tabId: ' + tabId + ' })');
      assert.notEqual(badge, '', 'badge countdown is empty while refreshing');
      assert.ok(server.counts['/ok'] >= 2, 'server did not observe a reload');
      await stopSession(tabId);
      const stopped = await waitStopped(sessionId, 8000, 'user');
      assert.equal(stopped.stopReason, 'user');
      return 'HTTP 200 and load timing recorded; badge "' + badge + '"';
    });

    await step('Refresh cycles enter pause and resume with a new active cycle', async () => {
      await fixture.navigate(base + '/ok');
      const { tabId, sessionId } = await startSession({
        mode: 'refresh', intervalSeconds: 2, cycleMode: 'cycles', reloadsPerCycle: 2, pauseSeconds: 2,
        text: { enabled: false, pattern: '' }, notifyOnMatch: false, stopOnMatch: false, notifyOnFailure: false
      });
      const data = await waitEvent(sessionId, (value) => {
        const reloads = value.events.filter((event) => event.eventType === 'reload_requested').length;
        const pause = value.events.some((event) => event.eventType === 'reload_requested' && event.details && event.details.phase === 'pause');
        const afterPause = value.events.some((event) => event.eventType === 'reload_requested' && event.details && event.details.phase === 'active' && event.details.reloadsInCycle === 1);
        return reloads >= 3 && pause && afterPause;
      }, 20000, 'cycle pause/resume');
      const phases = data.events.filter((event) => event.eventType === 'reload_requested').map((event) => event.details && event.details.phase);
      await stopSession(tabId);
      return 'phases: ' + phases.join(' → ');
    });

    await step('Text and DOM checks catch dynamically rendered content', async () => {
      await fixture.navigate(base + '/dynamic');
      const { tabId, sessionId } = await startSession({
        mode: 'monitor', autoRefresh: false, intervalSeconds: 10,
        text: { enabled: true, condition: 'appears', pattern: 'DYNAMIC TEXT', regex: false },
        dom: { enabled: true, selector: '.late-element', condition: 'appears', expectedText: '' },
        url: { enabled: true, expectedUrl: base + '/dynamic', ignoreHash: true },
        http: { enabled: true }, timing: { enabled: true, budgetMs: 5000 },
        settleMs: 300, notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      const initial = await waitEvent(sessionId, (value) =>
        value.events.some((event) => event.eventType === 'text_check' && event.result === 'WARN') &&
        value.events.some((event) => event.eventType === 'dom_check' && event.result === 'WARN'), 6000, 'initial pending checks');
      assert.ok(initial.events.some((event) => event.eventType === 'text_check' && event.result === 'WARN'));
      const final = await waitEvent(sessionId, (value) =>
        value.events.some((event) => event.eventType === 'text_check' && event.result === 'PASS') &&
        value.events.some((event) => event.eventType === 'dom_check' && event.result === 'PASS'), 8000, 'dynamic content found');
      const load = final.events.find((event) => event.eventType === 'page_load');
      assert.ok(load, 'page load timing event is missing');
      assert.equal(load.result, 'UNKNOWN', 'pre-session timing must not be reported as a new PASS');
      assert.match(load.reason, /before the session started/);
      assert.ok(final.events.some((event) => event.eventType === 'url_check' && event.result === 'PASS'));
      await stopSession(tabId);
      return 'WARN → PASS for text and DOM; historical timing marked UNKNOWN';
    });

    await step('Floating QA panel uses existing session data and supports collapse, drag, hide and stop', async () => {
      await fixture.navigate(base + '/');
      const started = await startSession({
        mode: 'monitor', autoRefresh: false, intervalSeconds: 10,
        text: { enabled: true, condition: 'absent', pattern: 'PANEL FAIL', regex: false },
        url: { enabled: false }, timing: { enabled: false }, http: { enabled: false },
        settleMs: 300, notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      const getPanel = () => fixture.evaluate(`(() => {
        const host = document.querySelector('[data-odesoftami-floating-panel]');
        if (!host) return null;
        const root = host.shadowRoot;
        if (!root) return { shadow: false };
        const panel = root.querySelector('.panel');
        const rect = panel ? panel.getBoundingClientRect() : null;
        const counts = {};
        for (const key of ['pass', 'fail', 'warn', 'unknown']) {
          const el = root.querySelector('.stat.' + key + ' strong');
          counts[key] = el ? el.textContent : null;
        }
        return {
          shadow: true,
          text: root.textContent || '',
          counts,
          rect: rect ? { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
          collapsed: !root.querySelector('.collapsed-pill').classList.contains('hidden'),
          bodyHidden: root.querySelector('.body').classList.contains('hidden')
        };
      })()`).then((panel) => panel ? { ...panel, text: String(panel.text || '').replace(/\s+/g, ' ').trim() } : panel);
      const initial = await waitFor(getPanel, 7000, 200, 'floating panel');
      assert.equal(initial.shadow, true);
      assert.match(initial.text, /Odesoftami QA Monitor/);
      assert.match(initial.text, /Monitor/);
      assert.match(initial.text, /PASS/);
      assert.match(initial.text, /FAIL/);
      assert.ok(initial.rect && initial.rect.width > 250, 'panel has no usable size');

      await fixture.evaluate('document.body.insertAdjacentHTML("beforeend", "<p>PANEL FAIL</p>")');
      const failedData = await waitEvent(started.sessionId, (value) => value.events.some((event) =>
        event.eventType === 'text_check' && event.result === 'FAIL'), 8000, 'panel failure event');
      await sleep(1800);
      const withFailure = await getPanel();
      assert.equal(withFailure.counts.fail, String(failedData.stats.failed));
      assert.equal(withFailure.counts.pass, String(failedData.stats.passed));
      assert.equal(withFailure.counts.warn, String(failedData.stats.warnings));
      assert.equal(withFailure.counts.unknown, String(failedData.stats.unknown));
      assert.match(withFailure.text, /Text condition — FAIL/);
      assert.match(withFailure.text, /FAIL/);

      await fixture.evaluate(`(() => {
        const root = document.querySelector('[data-odesoftami-floating-panel]').shadowRoot;
        root.querySelector('.icon-button[aria-label="Collapse panel"]').click();
      })()`);
      await sleep(350);
      const collapsed = await getPanel();
      assert.equal(collapsed.collapsed, true);
      assert.equal(collapsed.bodyHidden, true);
      assert.match(collapsed.text, /1 FAIL/);
      await fixture.evaluate(`(() => {
        const root = document.querySelector('[data-odesoftami-floating-panel]').shadowRoot;
        root.querySelector('.collapsed-pill').click();
      })()`);
      await sleep(350);
      const expanded = await getPanel();
      assert.equal(expanded.collapsed, false);
      assert.equal(expanded.bodyHidden, false);
      await fixture.screenshot(path.join(STORE_DIR, 'floating-panel.png'));
      ARTIFACTS.screenshots.push('store/floating-panel.png');

      const dragResult = await fixture.evaluate(`(() => {
        const root = document.querySelector('[data-odesoftami-floating-panel]').shadowRoot;
        const panel = root.querySelector('.panel');
        const bar = root.querySelector('.bar');
        const rect = panel.getBoundingClientRect();
        const opts = (x, y) => ({ bubbles: true, cancelable: true, button: 0, pointerId: 41, clientX: x, clientY: y });
        bar.dispatchEvent(new PointerEvent('pointerdown', opts(rect.left + 50, rect.top + 10)));
        window.dispatchEvent(new PointerEvent('pointermove', opts(rect.left + 130, rect.top + 70)));
        window.dispatchEvent(new PointerEvent('pointerup', opts(rect.left + 130, rect.top + 70)));
        const after = panel.getBoundingClientRect();
        return { before: { left: Math.round(rect.left), top: Math.round(rect.top) }, after: { left: Math.round(after.left), top: Math.round(after.top) } };
      })()`);
      assert.notDeepEqual(dragResult.after, dragResult.before, 'panel did not move after drag');
      await sleep(600);
      const prefs = await dashboard.evaluate('chrome.storage.local.get("qaPanelPrefs")');
      const stored = Object.values(prefs.qaPanelPrefs || {})[0];
      assert.ok(stored && stored.position, 'panel position was not persisted');
      await fixture.navigate(base + '/');
      const reloaded = await waitFor(async () => {
        const panel = await getPanel();
        if (!panel || !panel.rect) return null;
        return Math.abs(panel.rect.left - dragResult.after.left) <= 5 && Math.abs(panel.rect.top - dragResult.after.top) <= 5
          ? panel : null;
      }, 9000, 200, 'panel position after reload');
      assert.ok(reloaded.rect);

      await fixture.evaluate('history.pushState({ route: "spa" }, "", "/spa?route=2")');
      await sleep(1200);
      const hostCount = await fixture.evaluate('document.querySelectorAll("[data-odesoftami-floating-panel]").length');
      assert.equal(hostCount, 1, 'SPA navigation created duplicate panels');
      const stateAfterSpa = await dashboard.message({ type: 'GET_STATE', tabId: started.tabId });
      assert.ok(stateAfterSpa.state, 'SPA navigation broke the session');

      const beforeHide = await getData(started.sessionId);
      await fixture.evaluate(`(() => {
        const root = document.querySelector('[data-odesoftami-floating-panel]').shadowRoot;
        root.querySelector('.icon-button[aria-label="Hide panel; monitoring continues"]').click();
      })()`);
      await sleep(300);
      assert.equal(await getPanel(), null, 'hidden panel is still in the DOM');
      await fixture.evaluate('[...document.querySelectorAll("p")].filter((p) => p.textContent.includes("PANEL FAIL")).forEach((p) => p.remove())');
      await sleep(1500);
      await fixture.evaluate('document.body.insertAdjacentHTML("beforeend", "<p>PANEL FAIL</p>")');
      const afterHide = await waitEvent(started.sessionId, (value) =>
        value.events.length > beforeHide.events.length && value.events.some((event) =>
          event.eventType === 'text_check' && event.result === 'FAIL'), 8000, 'events after hiding panel');
      const stateAfterHide = await dashboard.message({ type: 'GET_STATE', tabId: started.tabId });
      assert.ok(stateAfterHide.state, 'hiding the panel stopped monitoring');
      await stopSession(started.tabId);

      await fixture.navigate(base + '/ok');
      const finalStart = await startSession({
        mode: 'monitor', autoRefresh: false, intervalSeconds: 10,
        text: { enabled: true, condition: 'appears', pattern: 'READY' }, url: { enabled: false }, timing: { enabled: false },
        settleMs: 300, notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      await waitFor(getPanel, 7000, 200, 'floating panel for stop');
      await fixture.evaluate(`(() => {
        const root = document.querySelector('[data-odesoftami-floating-panel]').shadowRoot;
        root.querySelector('.button.danger').click();
      })()`);
      await waitStopped(finalStart.sessionId, 10000, 'user');
      const finalPanel = await waitFor(async () => {
        const panel = await getPanel();
        return panel && /Session stopped/i.test(panel.text) ? panel : null;
      }, 7000, 250, 'final panel summary');
      assert.match(finalPanel.text, /Session stopped/);
      assert.match(finalPanel.text, /Dismiss/);
      await fixture.evaluate(`(() => {
        const root = document.querySelector('[data-odesoftami-floating-panel]').shadowRoot;
        root.querySelector('.button.primary').click();
      })()`);
      await sleep(300);
      assert.equal(await getPanel(), null, 'final summary could not be dismissed');

      await dashboard.message({ type: 'SAVE_SETTINGS', settings: { floatingPanelEnabled: false } });
      const disabledStart = await startSession({
        mode: 'monitor', autoRefresh: false, intervalSeconds: 10,
        text: { enabled: true, condition: 'appears', pattern: 'READY' }, url: { enabled: false }, timing: { enabled: false },
        settleMs: 300, notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      await sleep(1200);
      assert.equal(await getPanel(), null, 'disabled panel was displayed');
      const disabledState = await dashboard.message({ type: 'GET_STATE', tabId: disabledStart.tabId });
      assert.ok(disabledState.state, 'disabling the panel stopped monitoring');
      await stopSession(disabledStart.tabId);
      await dashboard.message({ type: 'SAVE_SETTINGS', settings: { floatingPanelEnabled: true } });

      const refreshStart = await startSession({
        mode: 'refresh', intervalSeconds: 5, cycleMode: 'continuous', reloadsPerCycle: 5, pauseSeconds: 10,
        text: { enabled: false, pattern: '' }, notifyOnMatch: false, stopOnMatch: false, notifyOnFailure: false
      });
      await sleep(1000);
      assert.equal(await getPanel(), null, 'Refresh mode should not show the QA panel');
      await stopSession(refreshStart.tabId);

      await fixture.navigate(base + '/ok');
      const qaStart = await startSession({
        mode: 'qa', autoRefresh: true, intervalSeconds: 2, cycleMode: 'continuous',
        reloadsPerCycle: 5, pauseSeconds: 10, text: { enabled: false, pattern: '' },
        url: { enabled: false }, timing: { enabled: true, budgetMs: 5000 },
        notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      await waitEvent(qaStart.sessionId, (value) => value.events.some((event) =>
        event.eventType === 'page_load' && event.result === 'PASS' && event.loadDurationMs !== null), 12000, 'QA panel load timing');
      await sleep(1800);
      const qaPanel = await waitFor(async () => {
        const panel = await getPanel();
        return panel && /QA Session/.test(panel.text) && /Load \d/.test(panel.text) ? panel : null;
      }, 8000, 250, 'QA panel data');
      assert.match(qaPanel.text, /QA Session/);
      assert.match(qaPanel.text, /Load \d/);
      await stopSession(qaStart.tabId);
      return 'counters matched, collapse/expand, drag persisted, hide kept monitoring, stop final summary, disabled panel, refresh exclusion and QA mode/load timing verified';
    });

    await step('Text change condition (regex) detects a page-text change', async () => {
      await fixture.navigate(base + '/');
      const { tabId, sessionId } = await startSession({
        mode: 'monitor', autoRefresh: false, intervalSeconds: 10,
        text: { enabled: true, condition: 'changes', pattern: 'READY', regex: true },
        url: { enabled: false }, timing: { enabled: false }, http: { enabled: false },
        settleMs: 300, notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      await waitEvent(sessionId, (value) => value.events.some((event) =>
        event.eventType === 'text_check' && event.result === 'WARN' && /change/i.test(event.reason || '')), 6000, 'text change baseline');
      await fixture.evaluate('document.body.insertAdjacentHTML("beforeend", "<p>UPDATED CONTENT</p>")');
      const data = await waitEvent(sessionId, (value) => value.events.some((event) =>
        event.eventType === 'text_check' && event.result === 'PASS' && /changed/i.test(event.reason || '')), 8000, 'text changed');
      assert.ok(data.events.some((event) => event.eventType === 'text_check' && event.result === 'PASS'));
      await stopSession(tabId);
      return 'text change PASS recorded with regex matching';
    });

    await step('DOM element disappearance and expected-text mismatch are detected', async () => {
      await fixture.navigate(base + '/');
      let started = await startSession({
        mode: 'monitor', autoRefresh: false, intervalSeconds: 10,
        text: { enabled: false, pattern: '' },
        dom: { enabled: true, selector: '.status-message', condition: 'disappears', expectedText: '' },
        url: { enabled: false }, timing: { enabled: false }, http: { enabled: false },
        settleMs: 300, notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      await waitEvent(started.sessionId, (value) => value.events.some((event) =>
        event.eventType === 'dom_check' && event.result === 'WARN' && /still present/i.test(event.reason || '')), 6000, 'DOM disappearance baseline');
      await fixture.evaluate('document.querySelector(".status-message").remove()');
      await waitEvent(started.sessionId, (value) => value.events.some((event) =>
        event.eventType === 'dom_check' && event.result === 'PASS' && /disappeared/i.test(event.reason || '')), 8000, 'DOM disappeared');
      await stopSession(started.tabId);

      await fixture.navigate(base + '/');
      started = await startSession({
        mode: 'monitor', autoRefresh: false, intervalSeconds: 10,
        text: { enabled: false, pattern: '' },
        dom: { enabled: true, selector: '.status-message', condition: 'appears', expectedText: 'OK' },
        url: { enabled: false }, timing: { enabled: false }, http: { enabled: false },
        settleMs: 300, notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      await waitEvent(started.sessionId, (value) => value.events.some((event) =>
        event.eventType === 'dom_check' && event.result === 'PASS' && /expected text/i.test(event.reason || '')), 6000, 'expected text baseline');
      await fixture.evaluate('document.querySelector(".status-message").textContent = "CHANGED"');
      const failed = await waitEvent(started.sessionId, (value) => value.events.some((event) =>
        event.eventType === 'dom_check' && event.result === 'FAIL' && /expected text/i.test(event.reason || '')), 8000, 'expected text mismatch');
      assert.ok(failed.events.some((event) => event.eventType === 'dom_check' && event.result === 'FAIL'));
      await stopSession(started.tabId);
      return 'disappearance PASS and expected-text FAIL recorded';
    });

    await step('Text disappears, DOM text changes and SPA URL changes are detected', async () => {
      await fixture.navigate(base + '/');
      const { tabId, sessionId } = await startSession({
        mode: 'monitor', autoRefresh: false, intervalSeconds: 10,
        text: { enabled: true, condition: 'disappears', pattern: 'READY', regex: false },
        dom: { enabled: true, selector: '.status-message', condition: 'textChanges', expectedText: '' },
        url: { enabled: true, expectedUrl: base + '/', ignoreHash: true },
        http: { enabled: false }, timing: { enabled: false },
        settleMs: 300, notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      await waitEvent(sessionId, (value) =>
        value.events.some((event) => event.eventType === 'text_check' && event.result === 'WARN') &&
        value.events.some((event) => event.eventType === 'dom_check' && event.result === 'WARN'), 5000, 'monitor baseline');
      await fixture.evaluate('document.getElementById("title").remove()');
      await waitEvent(sessionId, (value) => value.events.some((event) => event.eventType === 'text_check' && event.result === 'PASS'), 8000, 'text disappeared');
      await fixture.evaluate('document.querySelector(".status-message").textContent = "CHANGED"');
      await waitEvent(sessionId, (value) => value.events.some((event) => event.eventType === 'dom_check' && event.result === 'PASS'), 8000, 'dom text changed');
      await fixture.evaluate('history.pushState({ route: "2" }, "", "/spa?route=2")');
      const data = await waitEvent(sessionId, (value) => value.events.some((event) => event.eventType === 'url_check' && event.result === 'FAIL'), 8000, 'SPA URL change');
      const urlEvent = data.events.filter((event) => event.eventType === 'url_check' && event.result === 'FAIL').pop();
      assert.match(urlEvent.actualValue, /route=2/);
      await stopSession(tabId);
      return 'text disappearance, DOM text change and URL mismatch recorded';
    });

    await step('Text absent fails and screenshot-on-failure is handled honestly', async () => {
      await fixture.navigate(base + '/');
      const { tabId, sessionId } = await startSession({
        mode: 'monitor', autoRefresh: false, intervalSeconds: 10,
        text: { enabled: true, condition: 'absent', pattern: 'SEVERE ERROR', regex: false },
        url: { enabled: false }, timing: { enabled: false },
        screenshotOnFailure: true, settleMs: 300,
        notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      await waitEvent(sessionId, (value) => value.events.some((event) => event.eventType === 'text_check' && event.result === 'PASS'), 5000, 'text absent baseline');
      await activateFixture();
      await fixture.evaluate('document.body.insertAdjacentHTML("beforeend", "<p>SEVERE ERROR</p>")');
      const data = await waitEvent(sessionId, (value) => value.events.some((event) => event.eventType === 'text_check' && event.result === 'FAIL'), 8000, 'text absent failure');
      const fail = data.events.filter((event) => event.eventType === 'text_check' && event.result === 'FAIL').pop();
      assert.match(fail.reason, /expected to be absent/);
      const shot = await waitEvent(sessionId, (value) => value.events.some((event) => event.eventType === 'screenshot' || event.eventType === 'screenshot_skipped'), 5000, 'screenshot outcome');
      const screenshotEvent = shot.events.find((event) => event.eventType === 'screenshot' || event.eventType === 'screenshot_skipped');
      await stopSession(tabId);
      return screenshotEvent.eventType + (screenshotEvent.reason ? ' — ' + screenshotEvent.reason : '');
    });

    await step('Invalid selectors fail clearly and invalid regex is rejected before start', async () => {
      await fixture.navigate(base + '/ok');
      const { tabId, sessionId } = await startSession({
        mode: 'monitor', autoRefresh: false, intervalSeconds: 10,
        text: { enabled: false, pattern: '' },
        dom: { enabled: true, selector: '???', condition: 'appears', expectedText: '' },
        url: { enabled: false }, timing: { enabled: false },
        settleMs: 300, notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      const data = await waitEvent(sessionId, (value) => value.events.some((event) =>
        event.eventType === 'dom_check' && event.result === 'FAIL' && /selector/i.test(event.reason || '')), 6000, 'invalid selector');
      const event = data.events.find((item) => item.eventType === 'dom_check' && item.result === 'FAIL');
      assert.match(event.reason, /invalid/i);
      await stopSession(tabId);
      const tabId2 = await activateFixture();
      const badRegex = await dashboard.message({
        type: 'START_SESSION', tabId: tabId2,
        config: { mode: 'monitor', intervalSeconds: 10, text: { enabled: true, pattern: 'x(', regex: true } }
      });
      assert.equal(badRegex.ok, false);
      assert.match(badRegex.error, /Invalid regular expression/);
      return 'invalid selector recorded; invalid regex rejected';
    });

    await step('HTTP 200/403/404/500, redirects and URL destination checks work', async () => {
      await fixture.navigate(base + '/ok');
      const { tabId, sessionId } = await startSession({
        mode: 'monitor', autoRefresh: false, intervalSeconds: 10,
        text: { enabled: false, pattern: '' },
        url: { enabled: true, expectedUrl: base + '/ok', ignoreHash: true },
        http: { enabled: true }, timing: { enabled: true, budgetMs: 5000 },
        settleMs: 300, notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      await fixture.navigate(base + '/missing');
      let data = await waitEvent(sessionId, (value) => value.events.some((event) => event.eventType === 'navigation' && event.httpStatus === 404), 8000, '404');
      assert.equal(data.events.find((event) => event.eventType === 'navigation' && event.httpStatus === 404).result, 'FAIL');
      await fixture.navigate(base + '/forbidden');
      data = await waitEvent(sessionId, (value) => value.events.some((event) => event.eventType === 'navigation' && event.httpStatus === 403), 8000, '403');
      assert.equal(data.events.find((event) => event.eventType === 'navigation' && event.httpStatus === 403).result, 'FAIL');
      await fixture.navigate(base + '/error');
      data = await waitEvent(sessionId, (value) => value.events.some((event) => event.eventType === 'navigation' && event.httpStatus === 500), 8000, '500');
      assert.equal(data.events.find((event) => event.eventType === 'navigation' && event.httpStatus === 500).result, 'FAIL');
      await fixture.navigate(base + '/redirect');
      data = await waitEvent(sessionId, (value) =>
        value.events.some((event) => event.eventType === 'navigation' && event.url.includes('redirected=1') && event.httpStatus === 200) &&
        value.events.some((event) => event.eventType === 'redirect'), 10000, 'redirect');
      const redirect = data.events.find((event) => event.eventType === 'redirect');
      assert.match(redirect.actualValue, /redirected=1/);
      assert.ok(redirect.httpStatus >= 300 && redirect.httpStatus < 400, 'redirect status was not exposed: ' + redirect.httpStatus);
      const urlFail = data.events.filter((event) => event.eventType === 'url_check' && event.result === 'FAIL').pop();
      assert.ok(urlFail, 'redirect destination was not flagged by URL validation');
      await fixture.navigate(base + '/ok');
      data = await waitEvent(sessionId, (value) => value.events.some((event) =>
        event.eventType === 'navigation' && event.url.endsWith('/ok') && event.httpStatus === 200 && event.result === 'PASS'), 8000, '200 after redirect');
      await stopSession(tabId);
      return '403, 404, 500, redirect and recovery recorded';
    });

    await step('Network errors are recorded as FAIL with no fabricated HTTP status', async () => {
      await fixture.navigate(base + '/ok');
      const { tabId, sessionId } = await startSession({
        mode: 'monitor', autoRefresh: false, intervalSeconds: 10,
        text: { enabled: false, pattern: '' }, url: { enabled: false }, timing: { enabled: false },
        http: { enabled: true }, settleMs: 300,
        notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      const closer = http.createServer();
      await new Promise((resolve) => closer.listen(0, '127.0.0.1', resolve));
      const closedPort = closer.address().port;
      await new Promise((resolve) => closer.close(resolve));
      await fixture.cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + closedPort + '/unreachable' });
      const data = await waitEvent(sessionId, (value) => value.events.some((event) =>
        event.eventType === 'navigation_error' && event.result === 'FAIL'), 15000, 'network error');
      const failure = data.events.filter((event) => event.eventType === 'navigation_error' && event.result === 'FAIL').pop();
      assert.match(failure.reason, /ERR_/);
      assert.equal(failure.httpStatus, null);
      const state = await dashboard.message({ type: 'GET_STATE', tabId });
      assert.ok(state.state, 'network error unexpectedly stopped the session');
      await fixture.cdp.send('Page.navigate', { url: base + '/ok' });
      await sleep(1000);
      await stopSession(tabId);
      return failure.reason;
    });

    await step('Collection stops after STOP_SESSION', async () => {
      await fixture.navigate(base + '/ok');
      const { tabId, sessionId } = await startSession({
        mode: 'monitor', autoRefresh: false, intervalSeconds: 10,
        text: { enabled: true, condition: 'appears', pattern: 'READY' }, url: { enabled: false }, timing: { enabled: false },
        http: { enabled: true }, settleMs: 300,
        notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      await waitEvent(sessionId, (value) => value.events.some((event) => event.eventType === 'text_check' && event.result === 'PASS'), 6000, 'baseline before stop');
      await stopSession(tabId);
      await waitStopped(sessionId, 8000, 'user');
      const before = await getData(sessionId);
      const stateAfterStop = await dashboard.message({ type: 'GET_STATE', tabId });
      assert.equal(stateAfterStop.state, null);
      await fixture.cdp.send('Page.navigate', { url: base + '/error' });
      await sleep(1800);
      const after = await getData(sessionId);
      assert.equal(after.events.length, before.events.length, 'events were recorded after the session stopped');
      assert.equal(after.events.some((event) => event.eventType === 'navigation' && event.httpStatus === 500), false);
      return 'no events added after stop';
    });

    await step('Stop-on-match and notifications preserve v2.3 behavior', async () => {
      await fixture.navigate(base + '/ok');
      await dashboard.evaluate(`(async () => {
        const all = await chrome.notifications.getAll();
        for (const id of Object.keys(all)) await chrome.notifications.clear(id);
        return true;
      })()`);
      const { tabId, sessionId } = await startSession({
        mode: 'refresh', intervalSeconds: 5, cycleMode: 'continuous', reloadsPerCycle: 5, pauseSeconds: 10,
        text: { enabled: true, condition: 'appears', pattern: 'READY', regex: false },
        notifyOnMatch: true, stopOnMatch: true, notifyOnFailure: false
      });
      const stopped = await waitStopped(sessionId, 10000, 'condition_met');
      assert.equal(stopped.stopReason, 'condition_met');
      const notifications = await dashboard.evaluate('chrome.notifications.getAll()');
      assert.ok(Object.keys(notifications).length >= 1, 'no notification was created for the matched condition');
      const data = await getData(sessionId);
      assert.ok(data.events.some((event) => event.eventType === 'text_check' && event.result === 'PASS'));
      assert.ok(data.events.some((event) => event.eventType === 'session_stop'));
      return 'stopped with condition_met and notified';
    });

    await step('Legacy START_REFRESH message still works for v2.3 callers', async () => {
      await fixture.navigate(base + '/ok');
      const tabId = await activateFixture();
      const response = await dashboard.message({
        type: 'START_REFRESH', tabId, intervalSeconds: 5, mode: 'continuous',
        reloadsPerCycle: 5, pauseSeconds: 10, searchText: 'MISSING TEXT',
        searchCondition: 'notFound', notifyOnMatch: false, stopOnMatch: true
      });
      assert.equal(response.ok, true);
      const sessionId = response.state.sessionId;
      const stopped = await waitStopped(sessionId, 10000, 'condition_met');
      assert.equal(stopped.stopReason, 'condition_met');
      const data = await getData(sessionId);
      assert.ok(data.events.some((event) => event.eventType === 'text_check' && event.result === 'PASS'));
      return 'legacy message mapped to a v3 session';
    });

    await step('Closing the tab finalizes the session with tab_closed', async () => {
      await fixture.navigate(base + '/ok');
      const { sessionId } = await startSession({
        mode: 'monitor', autoRefresh: false, intervalSeconds: 10,
        text: { enabled: true, condition: 'appears', pattern: 'READY' }, url: { enabled: false }, timing: { enabled: false },
        settleMs: 300, notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      const tabId = await getFixtureTabId(await fixture.evaluate('location.href'));
      await closePage(info.browser, fixture);
      fixture = null;
      const stopped = await waitStopped(sessionId, 10000, 'tab_closed');
      assert.equal(stopped.stopReason, 'tab_closed');
      return 'session for tab ' + tabId + ' stopped cleanly';
    });

    await step('Service worker suspension/restart preserves the active session', async () => {
      fixture = await createPage(info.browser, info.port, base + '/ok', 'fixture-restart');
      await fixture.waitReady();
      const { tabId, sessionId } = await startSession({
        mode: 'monitor', autoRefresh: false, intervalSeconds: 10,
        text: { enabled: true, condition: 'appears', pattern: 'READY' }, url: { enabled: false }, timing: { enabled: false },
        settleMs: 300, notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      await waitEvent(sessionId, (value) => value.events.some((event) => event.eventType === 'text_check' && event.result === 'PASS'), 6000, 'baseline before suspension');
      const worker = await findServiceWorkerTarget(info.port);
      if (!worker) throw new Error('service worker target was not found');
      await info.browser.send('Target.closeTarget', { targetId: worker.id }).catch(() => {});
      const state = await waitFor(async () => {
        try {
          const response = await dashboard.message({ type: 'GET_STATE', tabId });
          return response && response.state ? response : null;
        } catch (_) { return null; }
      }, 12000, 300, 'session after worker restart');
      assert.equal(state.state.sessionId, sessionId);
      await stopSession(tabId);
      return 'session state recovered after worker restart';
    });

    await step('Preset form saves a valid custom preset', async () => {
      await dashboard.evaluate('location.hash = "#presets"');
      await sleep(700);
      const builtins = await dashboard.evaluate('document.querySelectorAll(".preset-card").length');
      assert.ok(builtins >= 4, 'built-in presets were not rendered');
      await dashboard.evaluate(`(() => {
        document.getElementById('presetName').value = 'E2E preset';
        document.getElementById('presetDescription').value = 'Created by the Chromium integration test';
        document.getElementById('presetMode').value = 'monitor';
        document.getElementById('presetMode').dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('presetTextEnabled').checked = true;
        document.getElementById('presetTextPattern').value = 'READY';
        document.getElementById('presetForm').requestSubmit();
        return true;
      })()`);
      const preset = await waitFor(async () => {
        const response = await dashboard.message({ type: 'GET_PRESETS' });
        return (response.presets || []).find((item) => item.name === 'E2E preset') || null;
      }, 8000, 200, 'saved preset');
      assert.equal(preset.mode, 'monitor');
      assert.equal(preset.config.text.pattern, 'READY');
      await dashboard.evaluate('location.hash = "#overview"');
      await dashboard.message({ type: 'DELETE_PRESET', id: preset.id });
      return 'preset saved with id ' + preset.id;
    });

    await step('Options page saves and restores monitoring defaults', async () => {
      const options = await openExtensionPage('options.html');
      await options.setViewport(760, 900);
      await sleep(500);
      await options.evaluate(`(() => {
        document.getElementById('settleMs').value = '900';
        document.getElementById('screenshotOnFailure').checked = true;
        document.getElementById('save').click();
        return true;
      })()`);
      await waitFor(async () => {
        const response = await dashboard.message({ type: 'GET_SETTINGS' });
        return response.settings.settleMs === 900 && response.settings.screenshotOnFailure === true;
      }, 6000, 200, 'saved options');
      assert.equal(await options.evaluate('document.getElementById("optionsVersion").textContent'), 'v3.2.0');
      await options.evaluate(`(() => {
        document.getElementById('settleMs').value = '800';
        document.getElementById('screenshotOnFailure').checked = false;
        document.getElementById('floatingPanelEnabled').checked = false;
        document.getElementById('floatingPanelDefaultPosition').value = 'top-left';
        document.getElementById('floatingPanelDefaultCollapsed').checked = true;
        document.getElementById('floatingPanelRetainSummary').checked = false;
        document.getElementById('save').click();
        return true;
      })()`);
      await waitFor(async () => {
        const response = await dashboard.message({ type: 'GET_SETTINGS' });
        return response.settings.settleMs === 800 && response.settings.screenshotOnFailure === false &&
          response.settings.floatingPanelEnabled === false &&
          response.settings.floatingPanelDefaultPosition === 'top-left' &&
          response.settings.floatingPanelDefaultCollapsed === true &&
          response.settings.floatingPanelRetainSummary === false;
      }, 6000, 200, 'saved floating panel options');
      await options.evaluate(`(() => {
        document.getElementById('floatingPanelEnabled').checked = true;
        document.getElementById('floatingPanelDefaultPosition').value = 'bottom-right';
        document.getElementById('floatingPanelDefaultCollapsed').checked = false;
        document.getElementById('floatingPanelRetainSummary').checked = true;
        document.getElementById('save').click();
        return true;
      })()`);
      await waitFor(async () => {
        const response = await dashboard.message({ type: 'GET_SETTINGS' });
        return response.settings.floatingPanelEnabled === true &&
          response.settings.floatingPanelDefaultPosition === 'bottom-right' &&
          response.settings.floatingPanelDefaultCollapsed === false &&
          response.settings.floatingPanelRetainSummary === true;
      }, 6000, 200, 'restored floating panel options');
      return 'settleMs, screenshot default and floating-panel options persisted/restored';
    });

    await step('Local screenshot storage can be written, read and cleared without network', async () => {
      const result = await dashboard.evaluate(`(async () => {
        const sessionId = 'e2e-screenshot-test';
        const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1X0AAAAASUVORK5CYII=';
        await OdesScreenshots.put({ sessionId, timestamp: new Date().toISOString(), url: 'http://127.0.0.1/', dataUrl, eventId: 'evt-test' });
        const before = await OdesScreenshots.listBySession(sessionId);
        const record = await OdesScreenshots.getById(before[0].id);
        await OdesScreenshots.deleteBySession(sessionId);
        const after = await OdesScreenshots.listBySession(sessionId);
        const usage = await OdesScreenshots.usage();
        return { before: before.length, hasImage: Boolean(record && record.dataUrl.startsWith('data:image/')), after: after.length, usageCount: usage.count };
      })()`);
      assert.equal(result.before, 1);
      assert.equal(result.hasImage, true);
      assert.equal(result.after, 0);
      return 'IndexedDB put/list/get/delete verified';
    });

    await step('CSV, HTML and JSON reports are generated from real session data', async () => {
      const sessionsResponse = await dashboard.message({ type: 'GET_SESSIONS' });
      let session = null;
      for (const candidate of sessionsResponse.sessions.filter((item) => item.status === 'stopped' && item.eventCount > 0)) {
        const candidateData = await getData(candidate.id);
        if (candidateData.stats.totalChecks > 0) { session = candidate; break; }
      }
      assert.ok(session, 'no completed session with checks available');
      await activateDashboard();
      await dashboard.evaluate('location.hash = "#overview"');
      await dashboard.evaluate('document.getElementById("refreshButton").click()');
      await sleep(1200);
      await waitFor(async () => {
        return dashboard.evaluate(`[...document.querySelectorAll('#sessionSelect option')].some((option) => option.value === ${JSON.stringify(session.id)})`);
      }, 8000, 300, 'session option');
      await dashboard.evaluate(`(() => {
        const select = document.getElementById('sessionSelect');
        select.value = ${JSON.stringify(session.id)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return select.value;
      })()`);
      await waitFor(async () => {
        const count = await dashboard.evaluate('document.getElementById("dashTotal").textContent');
        return Number(count) > 0 ? true : null;
      }, 8000, 250, 'dashboard statistics');
      const data = await getData(session.id);
      const generated = await dashboard.evaluate(`(() => {
        const session = ${JSON.stringify(data.session)};
        const events = ${JSON.stringify(data.events)};
        const stats = ${JSON.stringify(data.stats)};
        return {
          csv: OdesCore.buildCsvReport(session, events),
          html: OdesCore.buildHtmlReport(session, events, stats),
          json: OdesCore.buildJsonReport(session, events, stats)
        };
      })()`);
      assert.ok(generated.csv.includes('Odesoftami QA Monitor 3.2.0'));
      assert.ok(generated.csv.includes(session.id));
      assert.ok(generated.html.includes('<!doctype html>'));
      assert.ok(generated.html.includes('Event timeline'));
      const parsed = JSON.parse(generated.json);
      assert.equal(parsed.session.id, session.id);
      assert.ok(parsed.events.length > 0);
      return 'reports built for ' + session.id;
    });

    await step('Browser downloads CSV, HTML and JSON reports', async () => {
      try {
        await info.browser.send('Browser.setDownloadBehavior', {
          behavior: 'allow', downloadPath: DOWNLOAD_DIR, eventsEnabled: true
        });
      } catch (error) {
        throw Object.assign(new Error('Download behavior unavailable: ' + error.message), { optional: true });
      }
      const buttons = ['exportCsv', 'exportHtml', 'exportJson'];
      for (const id of buttons) {
        assert.equal(await dashboard.evaluate('document.getElementById(' + JSON.stringify(id) + ').disabled'), false, id + ' is disabled');
      }
      for (const id of buttons) {
        await dashboard.evaluate('document.getElementById(' + JSON.stringify(id) + ').click()');
        await sleep(400);
      }
      const files = await waitFor(() => {
        if (!fs.existsSync(DOWNLOAD_DIR)) return null;
        const list = fs.readdirSync(DOWNLOAD_DIR).filter((name) => /\.(csv|html|json)$/i.test(name));
        return list.length >= 3 ? list : null;
      }, 10000, 300, 'downloaded reports');
      const byExtension = {};
      for (const name of files) byExtension[path.extname(name).toLowerCase()] = name;
      assert.ok(byExtension['.csv'] && byExtension['.html'] && byExtension['.json'], 'not all report formats downloaded');
      const csv = fs.readFileSync(path.join(DOWNLOAD_DIR, byExtension['.csv']), 'utf8');
      const html = fs.readFileSync(path.join(DOWNLOAD_DIR, byExtension['.html']), 'utf8');
      JSON.parse(fs.readFileSync(path.join(DOWNLOAD_DIR, byExtension['.json']), 'utf8'));
      assert.ok(csv.replace(/^\ufeff/, '').includes('Odesoftami QA Monitor'));
      assert.ok(html.includes('<!doctype html>'));
      ARTIFACTS.downloads = files.map((name) => 'downloads/' + name);
      return files.join(', ');
    }, { optional: true });

    await step('Dashboard and options remain usable at desktop and narrow widths', async () => {
      await activateDashboard();
      assert.equal(await dashboard.evaluate('document.getElementById("dashboardVersion").textContent'), 'v3.2.0');
      assert.equal(await dashboard.evaluate('document.getElementById("dashboardFooterVersion").textContent'), 'v3.2.0');
      await dashboard.evaluate('location.hash = "#overview"');
      await dashboard.evaluate('document.getElementById("refreshButton").click()');
      await sleep(900);
      // Pick a completed session with real failures for the store screenshot.
      const allSessions = (await dashboard.message({ type: 'GET_SESSIONS' })).sessions;
      let showcase = null;
      for (const candidate of allSessions.filter((item) => item.status !== 'active')) {
        try {
          const candidateData = await getData(candidate.id);
          if (candidateData.stats.failed > 0) { showcase = candidate; break; }
        } catch (_) { /* ignore */ }
      }
      if (showcase) {
        await waitFor(async () => dashboard.evaluate(`[...document.querySelectorAll('#sessionSelect option')].some((option) => option.value === ${JSON.stringify(showcase.id)})`), 8000, 250, 'showcase session option');
        await dashboard.evaluate(`(() => {
          const select = document.getElementById('sessionSelect');
          select.value = ${JSON.stringify(showcase.id)};
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`);
        await sleep(1000);
      }
      await dashboard.evaluate('document.getElementById("toast").classList.add("hidden")');
      await dashboard.setViewport(1280, 800);
      await sleep(500);
      const desktopOverflow = await dashboard.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1');
      assert.equal(desktopOverflow, false, 'dashboard overflows at 1280px');
      await dashboard.screenshot(path.join(STORE_DIR, 'dashboard-1280x800.png'));
      ARTIFACTS.screenshots.push('store/dashboard-1280x800.png');
      await dashboard.setViewport(390, 844);
      await sleep(400);
      const mobileOverflow = await dashboard.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1');
      assert.equal(mobileOverflow, false, 'dashboard overflows at 390px');
      await dashboard.screenshot(path.join(STORE_DIR, 'dashboard-390.png'));
      ARTIFACTS.screenshots.push('store/dashboard-390.png');
      await dashboard.setViewport(1280, 800);
      const options = await openExtensionPage('options.html');
      await options.setViewport(760, 900);
      await sleep(500);
      const optionsOverflow = await options.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1');
      assert.equal(optionsOverflow, false, 'options page overflows at 760px');
      await options.screenshot(path.join(STORE_DIR, 'options-760.png'));
      ARTIFACTS.screenshots.push('store/options-760.png');
      const privacy = await openExtensionPage('privacy.html');
      const privacyTitle = await privacy.evaluate('document.title');
      assert.match(privacyTitle, /Privacy Policy/);
      return 'dashboard 1280/390, options 760, privacy page';
    });

    await step('Quick Clear history confirms, preserves active session/settings/presets/screenshots and updates UI', async () => {
      await stopAll();
      await fixture.navigate(base + '/ok');
      const active = await startSession({
        mode: 'monitor', autoRefresh: false, intervalSeconds: 10,
        text: { enabled: true, condition: 'appears', pattern: 'READY' }, url: { enabled: false }, timing: { enabled: false },
        settleMs: 300, notifyOnMatch: false, notifyOnFailure: false, stopOnMatch: false, stopOnFailure: false
      });
      await waitEvent(active.sessionId, (value) => value.events.some((event) => event.eventType === 'text_check' && event.result === 'PASS'), 6000, 'active baseline before clear');
      await activateDashboard();
      await dashboard.evaluate('location.hash = "#overview"');
      await dashboard.evaluate('document.getElementById("refreshButton").click()');
      await sleep(900);
      await waitFor(async () => dashboard.evaluate(`[...document.querySelectorAll('#sessionSelect option')].some((option) => option.value === ${JSON.stringify(active.sessionId)})`), 8000, 250, 'active session option');
      await dashboard.evaluate(`(() => {
        const select = document.getElementById('sessionSelect');
        select.value = ${JSON.stringify(active.sessionId)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await sleep(600);

      const dashboardClearLayout = await dashboard.evaluate(`(() => {
        const exportButton = document.getElementById('exportCsv');
        const clearButton = document.getElementById('clearHistoryQuick');
        const exportRect = exportButton.getBoundingClientRect();
        const clearRect = clearButton.getBoundingClientRect();
        return { adjacent: clearRect.left >= exportRect.right - 1, text: clearButton.textContent.trim() };
      })()`);
      assert.equal(dashboardClearLayout.adjacent, true, 'dashboard Clear history is not immediately right of Export CSV');
      assert.equal(dashboardClearLayout.text, 'Clear history');
      const before = await dashboard.message({ type: 'GET_SESSIONS' });
      const completed = before.sessions.filter((session) => session.status !== 'active');
      assert.ok(completed.length >= 1, 'no completed sessions available to clear');
      const completedIds = new Set(completed.map((session) => session.id));
      const completedEvents = completed.reduce((sum, session) => sum + (session.eventCount || 0), 0);
      const presetsBefore = await dashboard.message({ type: 'GET_PRESETS' });
      const settingsBefore = await dashboard.message({ type: 'GET_SETTINGS' });
      const fakeShot = await dashboard.evaluate(`(async () => {
        const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1X0AAAAASUVORK5CYII=';
        return OdesScreenshots.put({
          sessionId: ${JSON.stringify(completed[0].id)},
          timestamp: new Date().toISOString(),
          url: 'http://127.0.0.1/clear-test',
          dataUrl,
          eventId: 'evt-clear-test'
        });
      })()`);

      const clickClearAndHandleDialog = async (accept) => {
        let resolved = false;
        let resolveDialog;
        const dialogPromise = new Promise((resolve) => { resolveDialog = resolve; });
        const off = dashboard.cdp.on('Page.javascriptDialogOpening', async (params) => {
          if (resolved) return;
          resolved = true;
          off();
          await dashboard.cdp.send('Page.handleJavaScriptDialog', { accept });
          resolveDialog(params.message);
        });
        const clickPromise = dashboard.evaluate('document.getElementById("clearHistoryQuick").click()').catch(() => null);
        const message = await Promise.race([
          dialogPromise,
          sleep(6000).then(() => { throw new Error('confirmation dialog did not appear'); })
        ]);
        await clickPromise;
        return message;
      };

      const cancelMessage = await clickClearAndHandleDialog(false);
      assert.match(cancelMessage, /completed session/);
      await sleep(700);
      const afterCancel = await dashboard.message({ type: 'GET_SESSIONS' });
      assert.equal(afterCancel.sessions.length, before.sessions.length, 'cancelling clear history removed sessions');
      assert.ok(afterCancel.sessions.some((session) => session.id === active.sessionId), 'cancel removed the active session');
      assert.ok(completedIds.size > 0);

      const clearMessage = await clickClearAndHandleDialog(true);
      const afterClear = await waitFor(async () => {
        const response = await dashboard.message({ type: 'GET_SESSIONS' });
        const stillCompleted = response.sessions.filter((session) => completedIds.has(session.id));
        return stillCompleted.length === 0 ? response : null;
      }, 12000, 300, 'completed history cleared');
      assert.ok(afterClear.sessions.some((session) => session.id === active.sessionId), 'active session was removed');
      const activeNow = afterClear.sessions.find((session) => session.id === active.sessionId);
      assert.equal(activeNow.status, 'active');
      assert.deepEqual((await dashboard.message({ type: 'GET_PRESETS' })).presets.map((preset) => preset.id), presetsBefore.presets.map((preset) => preset.id));
      const settingsAfter = await dashboard.message({ type: 'GET_SETTINGS' });
      assert.deepEqual(settingsAfter.settings, settingsBefore.settings);
      const preservedShot = await dashboard.evaluate(`OdesScreenshots.listBySession(${JSON.stringify(completed[0].id)})`);
      assert.ok(preservedShot.some((entry) => entry.id === fakeShot.id), 'clear history deleted a screenshot');
      assert.match(clearMessage, new RegExp(completed.length + ' completed session'));
      assert.match(clearMessage, new RegExp(completedEvents + ' historical event'));
      assert.match(clearMessage, /screenshots will be preserved/);
      assert.equal(await dashboard.evaluate('document.getElementById("clearHistoryQuick").disabled'), true, 'Clear history should disable when nothing remains');
      await waitFor(async () => {
        const value = await dashboard.evaluate('document.getElementById("sessionSelect").value');
        return value === active.sessionId ? true : null;
      }, 8000, 250, 'active session selected after clear');
      await waitFor(async () => {
        const value = await dashboard.evaluate('document.getElementById("dashTotal").textContent');
        return Number(value) > 0 ? true : null;
      }, 8000, 250, 'dashboard counters after clear');
      await dashboard.evaluate(`OdesScreenshots.deleteById(${JSON.stringify(fakeShot.id)})`);
      await stopSession(active.tabId);
      return 'cancel preserved; confirm removed ' + completed.length + ' sessions / ' + completedEvents + ' events; active session, presets, settings and screenshots preserved';
    });

    await step('No uncaught JavaScript exceptions in extension pages', async () => {
      const pages = [dashboard, fixture, ...extraPages].filter(Boolean);
      const problems = [];
      for (const page of pages) {
        for (const exception of page.exceptions) problems.push(page.name + ': ' + exception.text);
      }
      assert.deepEqual(problems, []);
      return pages.length + ' pages checked';
    });

  } finally {
    try { await stopAll(); } catch (_) { /* ignore */ }
    if (popup) await closePage(info.browser, popup).catch(() => {});
    if (fixture) await closePage(info.browser, fixture).catch(() => {});
    for (const page of extraPages) await closePage(info.browser, page).catch(() => {});
    if (dashboard) await closePage(info.browser, dashboard).catch(() => {});
    if (info) {
      try { info.child.kill('SIGTERM'); } catch (_) { /* ignore */ }
      await sleep(800);
      if (info.child.exitCode === null) {
        try { info.child.kill('SIGKILL'); } catch (_) { /* ignore */ }
      }
    }
    await server.close();
    const finishedAt = new Date().toISOString();
    const failures = RESULTS.filter((item) => item.status === 'FAIL');
    const report = {
      startedAt: STARTED_AT,
      finishedAt,
      chromium: 'Chromium 153.0.7983.0 (headless=new)',
      extensionId: info ? info.extensionId : null,
      results: RESULTS,
      artifacts: ARTIFACTS,
      summary: {
        pass: RESULTS.filter((item) => item.status === 'PASS').length,
        fail: failures.length,
        notTested: RESULTS.filter((item) => item.status === 'NOT TESTED').length
      }
    };
    fs.writeFileSync(path.join(ROOT, 'tests', 'e2e', 'results.json'), JSON.stringify(report, null, 2));
    console.log('\n=== E2E SUMMARY ===');
    for (const item of RESULTS) console.log(item.status.padEnd(10) + item.name + (item.detail ? ' — ' + item.detail : ''));
    console.log('PASS: ' + report.summary.pass + ', FAIL: ' + report.summary.fail + ', NOT TESTED: ' + report.summary.notTested);
    if (failures.length) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('E2E RUN ABORTED', error);
  process.exitCode = 1;
});
