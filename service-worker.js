/*
 * Odesoftami QA Monitor — MV3 service worker (v3.1.0)
 *
 * Thin event wiring only. All logic lives in lib/engine.js and lib/core.js
 * so it can be unit-tested with a mocked Chrome API.
 */
'use strict';

importScripts('lib/core.js', 'lib/screenshots.js', 'lib/engine.js');

const engine = self.OdesEngine.createEngine({ chrome });

function logError(context, error) {
  console.error('[Odesoftami] ' + context, error);
}

function listen(event, handler) {
  if (event && typeof event.addListener === 'function') {
    event.addListener(handler);
    return true;
  }
  return false;
}

listen(chrome.runtime.onMessage, (message, sender, sendResponse) => {
  engine.handleMessage(message, sender)
    .then((response) => sendResponse(response || { ok: false, error: 'No response.' }))
    .catch((error) => {
      logError('Message failed', error);
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
  return true;
});

// webRequest is used observe-only (never webRequestBlocking). The explicit
// filter limits callbacks to main-frame HTTP/HTTPS navigations. The engine then
// associates each event with an active session by tab id, so callbacks for
// pages without a session are ignored and collection stops with the session.
const WEB_REQUEST_FILTER = {
  urls: ['http://*/*', 'https://*/*'],
  types: ['main_frame']
};

if (chrome.webRequest) {
  if (chrome.webRequest.onBeforeRequest) {
    chrome.webRequest.onBeforeRequest.addListener((details) => {
      engine.handleBeforeNavigate(details).catch((error) => logError('onBeforeRequest', error));
    }, WEB_REQUEST_FILTER);
  }
  if (chrome.webRequest.onBeforeRedirect) {
    chrome.webRequest.onBeforeRedirect.addListener((details) => {
      engine.handleBeforeRedirect(details).catch((error) => logError('onBeforeRedirect', error));
    }, WEB_REQUEST_FILTER);
  }
  if (chrome.webRequest.onCompleted) {
    chrome.webRequest.onCompleted.addListener((details) => {
      engine.handleCompleted(details).catch((error) => logError('onCompleted', error));
    }, WEB_REQUEST_FILTER);
  }
  if (chrome.webRequest.onErrorOccurred) {
    chrome.webRequest.onErrorOccurred.addListener((details) => {
      engine.handleErrorOccurred(details).catch((error) => logError('onErrorOccurred', error));
    }, WEB_REQUEST_FILTER);
  }
}

if (chrome.alarms) {
  listen(chrome.alarms.onAlarm, (alarm) => {
    if (!alarm || alarm.name !== 'odesoftami:watchdog') return;
    engine.handleWatchdog().catch((error) => logError('watchdog', error));
  });
}

listen(chrome.tabs.onRemoved, (tabId) => {
  engine.handleTabRemoved(tabId).catch((error) => logError('onRemoved', error));
});

listen(chrome.tabs.onReplaced, (addedTabId, removedTabId) => {
  engine.handleTabReplaced(addedTabId, removedTabId).catch((error) => logError('onReplaced', error));
});

listen(chrome.tabs.onUpdated, (tabId, changeInfo, tab) => {
  if (!changeInfo || (!changeInfo.url && changeInfo.status !== 'complete')) return;
  engine.handleTabUpdated(tabId, changeInfo, tab).catch((error) => logError('onUpdated', error));
});

listen(chrome.runtime.onStartup, () => {
  engine.handleStartup().catch((error) => logError('onStartup', error));
});

listen(chrome.runtime.onInstalled, (details) => {
  engine.handleInstalled(details).catch((error) => logError('onInstalled', error));
});

listen(chrome.runtime.onSuspend, () => {
  engine.handleSuspend().catch(() => {});
});

if (chrome.notifications) {
  listen(chrome.notifications.onClicked, (notificationId) => {
    if (!notificationId || !notificationId.startsWith('odesoftami:')) return;
    const parts = notificationId.split(':');
    const sessionId = parts[1] && parts[1].startsWith('sess-') ? parts[1] : null;
    const url = chrome.runtime.getURL('dashboard.html' + (sessionId ? '?session=' + encodeURIComponent(sessionId) : ''));
    chrome.tabs.create({ url }).catch(() => {});
    chrome.notifications.clear(notificationId).catch(() => {});
  });
}

// ---------------------------------------------------------------------------
// Detached floating popup window
// ---------------------------------------------------------------------------
// The action has no default_popup. Clicking the toolbar icon opens the same
// popup page in a small, movable extension window. This is what makes the
// header drag handle meaningful; an anchored action popup cannot be moved
// across the screen. No extra permission is required for chrome.windows.

const FLOATING_POPUP_KEY = 'floatingPopupWindowId';

async function openFloatingPopup(tab) {
  const tabId = tab && Number.isInteger(tab.id) ? tab.id : null;
  const base = chrome.runtime.getURL('popup.html?detached=1');
  const url = tabId === null ? base : base + '&tabId=' + encodeURIComponent(String(tabId));
  try {
    const stored = await chrome.storage.session.get(FLOATING_POPUP_KEY).catch(() => ({}));
    const existingId = stored && stored[FLOATING_POPUP_KEY];
    if (existingId) {
      try {
        const existing = await chrome.windows.get(existingId);
        // Query by window id rather than relying on tab URLs: the extension
        // does not request the broad "tabs" permission, so URLs may be hidden.
        const [popupTab] = await chrome.tabs.query({ windowId: existing.id });
        if (popupTab && existing.type === 'popup') {
          await chrome.tabs.update(popupTab.id, { url, active: true });
          await chrome.windows.update(existing.id, { focused: true });
          return;
        }
      } catch (_) {
        await chrome.storage.session.remove(FLOATING_POPUP_KEY).catch(() => {});
      }
    }
    const created = await chrome.windows.create({
      url,
      type: 'popup',
      width: 420,
      height: 680,
      focused: true
    });
    if (created && created.id !== undefined) {
      await chrome.storage.session.set({ [FLOATING_POPUP_KEY]: created.id }).catch(() => {});
    }
  } catch (error) {
    logError('openFloatingPopup', error);
    // A window may be unavailable in a restricted environment. Keep the UI
    // reachable as a normal tab rather than failing silently.
    chrome.tabs.create({ url }).catch((fallbackError) => logError('openFloatingPopup fallback', fallbackError));
  }
}

if (chrome.action && chrome.action.onClicked) {
  listen(chrome.action.onClicked, (tab) => {
    openFloatingPopup(tab).catch((error) => logError('action.onClicked', error));
  });
}

if (chrome.windows && chrome.windows.onRemoved) {
  listen(chrome.windows.onRemoved, (windowId) => {
    chrome.storage.session.get(FLOATING_POPUP_KEY)
      .then((stored) => {
        if (stored && stored[FLOATING_POPUP_KEY] === windowId) {
          return chrome.storage.session.remove(FLOATING_POPUP_KEY);
        }
        return null;
      })
      .catch(() => {});
  });
}
