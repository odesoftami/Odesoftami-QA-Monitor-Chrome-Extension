/*
 * In-memory Chrome API mock for Node unit tests.
 * Implements only the APIs used by lib/engine.js and lib/core.js.
 */
'use strict';

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function makeEvent() {
  const listeners = [];
  return {
    addListener(fn) { listeners.push(fn); },
    removeListener(fn) {
      const index = listeners.indexOf(fn);
      if (index >= 0) listeners.splice(index, 1);
    },
    hasListener(fn) { return listeners.includes(fn); },
    emit(...args) {
      for (const listener of [...listeners]) listener(...args);
    },
    get listeners() { return [...listeners]; }
  };
}

function createStorageArea(options) {
  const store = {};
  const opts = options || {};
  function sizeOf(items) {
    try { return Buffer.byteLength(JSON.stringify(items), 'utf8'); } catch (_) { return 0; }
  }
  async function get(keys) {
    if (keys === null || keys === undefined) return clone(store);
    const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    const result = {};
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(store, name)) result[name] = clone(store[name]);
      else if (keys && typeof keys === 'object' && !Array.isArray(keys) && Object.prototype.hasOwnProperty.call(keys, name)) {
        result[name] = clone(keys[name]);
      }
    }
    return result;
  }
  async function set(items) {
    const next = { ...store, ...clone(items) };
    const bytes = sizeOf(next);
    if (opts.quotaBytes && bytes > opts.quotaBytes) {
      throw new Error('QUOTA_BYTES quota exceeded');
    }
    for (const [key, value] of Object.entries(items)) store[key] = clone(value);
    opts.lastWriteBytes = bytes;
  }
  async function remove(keys) {
    const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || {});
    for (const name of names) delete store[name];
  }
  async function clear() {
    for (const key of Object.keys(store)) delete store[key];
  }
  async function getBytesInUse(keys) {
    if (keys === null || keys === undefined) return sizeOf(store);
    const result = await get(keys);
    return sizeOf(result);
  }
  return {
    store, get, set, remove, clear, getBytesInUse,
    _raw: store,
    _size: () => sizeOf(store)
  };
}

function createMockChrome(options) {
  const opts = options || {};
  const tabs = new Map();
  const storage = {
    local: createStorageArea({ quotaBytes: opts.quotaBytes }),
    session: createStorageArea({})
  };
  const reloadCalls = [];
  const scriptCalls = [];
  const notifications = [];
  const createCalls = [];
  const badges = { text: {}, color: {} };
  const alarms = new Map();

  function addTab(tab) {
    const full = {
      id: tab.id,
      url: tab.url,
      title: tab.title || tab.url,
      active: tab.active !== false,
      windowId: tab.windowId || 1,
      pendingUrl: tab.pendingUrl
    };
    tabs.set(full.id, full);
    return full;
  }

  const onRemoved = makeEvent();
  const onUpdated = makeEvent();
  const onReplaced = makeEvent();

  const chrome = {
    runtime: {
      id: 'test-extension-id',
      getURL: (path) => 'chrome-extension://test-extension-id/' + String(path).replace(/^\//, ''),
      getManifest: () => ({ version: '3.2.0', manifest_version: 3 }),
      onMessage: makeEvent(),
      onStartup: makeEvent(),
      onInstalled: makeEvent(),
      onSuspend: makeEvent(),
      lastError: null,
      sendMessage: async () => ({ ok: true })
    },
    storage,
    tabs: {
      _map: tabs,
      get: async (tabId) => {
        const tab = tabs.get(Number(tabId));
        if (!tab) throw new Error('No tab with id: ' + tabId);
        return clone(tab);
      },
      query: async (queryInfo) => {
        const result = [...tabs.values()].filter((tab) => {
          if (queryInfo && queryInfo.active !== undefined && tab.active !== queryInfo.active) return false;
          return true;
        });
        return clone(result);
      },
      create: async (createInfo) => {
        createCalls.push(clone(createInfo));
        return { id: 999, url: createInfo.url };
      },
      reload: async (tabId, reloadOptions) => {
        reloadCalls.push({ tabId, options: clone(reloadOptions || {}) });
        if (opts.reloadError) throw new Error(opts.reloadError);
        const tab = tabs.get(Number(tabId));
        if (!tab) throw new Error('No tab with id: ' + tabId);
        return undefined;
      },
      sendMessage: async (tabId, message) => {
        if (opts.messageError) throw new Error(opts.messageError);
        if (typeof opts.messageHandler === 'function') return opts.messageHandler(tabId, message);
        return { ok: true };
      },
      captureVisibleTab: async (windowId, captureOptions) => {
        if (opts.captureError) throw new Error(opts.captureError);
        return opts.captureDataUrl || 'data:image/jpeg;base64,AAAA';
      },
      onRemoved,
      onUpdated,
      onReplaced
    },
    windows: {
      get: async (windowId) => ({ id: windowId, focused: opts.windowFocused !== false })
    },
    scripting: {
      executeScript: async (details) => {
        scriptCalls.push(clone(details));
        return [{ result: null }];
      }
    },
    action: {
      setBadgeText: async ({ tabId, text }) => { badges.text[tabId] = text; },
      setBadgeBackgroundColor: async ({ tabId, color }) => { badges.color[tabId] = color; }
    },
    alarms: {
      create: async (name, info) => { alarms.set(name, { name, ...info }); },
      clear: async (name) => { const had = alarms.has(name); alarms.delete(name); return had; },
      get: async (name) => alarms.get(name),
      getAll: async () => [...alarms.values()],
      onAlarm: makeEvent(),
      _map: alarms
    },
    notifications: {
      create: async (id, notificationOptions) => {
        notifications.push({ id, options: clone(notificationOptions) });
        return id;
      },
      clear: async () => true,
      getAll: async () => Object.fromEntries(notifications.map((item) => [item.id, item.options])),
      onClicked: makeEvent()
    },
    webNavigation: {
      onBeforeNavigate: makeEvent(),
      onCommitted: makeEvent(),
      onBeforeRedirect: makeEvent(),
      onCompleted: makeEvent(),
      onErrorOccurred: makeEvent()
    }
  };

  return {
    chrome,
    tabs,
    addTab,
    storage,
    reloadCalls,
    scriptCalls,
    notifications,
    createCalls,
    badges,
    alarms,
    onRemoved,
    onUpdated,
    onReplaced,
    reset() {
      tabs.clear();
      for (const key of Object.keys(storage.local.store)) delete storage.local.store[key];
      for (const key of Object.keys(storage.session.store)) delete storage.session.store[key];
      reloadCalls.length = 0;
      scriptCalls.length = 0;
      notifications.length = 0;
      createCalls.length = 0;
      alarms.clear();
    }
  };
}

module.exports = { createMockChrome, makeEvent, clone };
