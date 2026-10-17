/*
 * Odesoftami QA Monitor — background engine (v3.1.0)
 *
 * The engine is intentionally independent from chrome.* listener wiring so
 * that it can be exercised with a mocked Chrome API in the automated tests.
 * It owns:
 *   - active session state (chrome.storage.session)
 *   - durable session metadata and bounded event history (chrome.storage.local)
 *   - refresh scheduling, webRequest navigation bookkeeping and local reports data
 *   - opt-in local screenshots (IndexedDB)
 *
 * No network requests and no remote code are used.
 */
/* global OdesCore, OdesScreenshots */
(function (root) {
  'use strict';

  const core = root.OdesCore;
  const shots = root.OdesScreenshots || null;
  if (!core) throw new Error('OdesCore must be loaded before OdesEngine.');

  const KEYS = {
    settings: 'settings',
    sessions: 'qaSessions',
    presets: 'qaPresets',
    runtime: 'qaRuntime',
    legacyLogs: 'qaLogs',
    legacyBackup: 'qaLogsV2Backup',
    legacyMigrated: 'legacyMigratedV3',
    legacyRuntime: 'refreshTabs',
    panelPrefs: 'qaPanelPrefs'
  };

  const EVENTS_PREFIX = 'qaEvents:';
  const WATCHDOG_ALARM = 'odesoftami:watchdog';
  const NOTIFICATION_TTL_MS = 60000;

  function eventsKey(sessionId) {
    return EVENTS_PREFIX + sessionId;
  }

  function isQuotaError(error) {
    const message = String((error && error.message) || error || '');
    return /quota|QUOTA_BYTES|storage is full|MAX_WRITE/i.test(message);
  }

  function sameUrl(a, b, ignoreHash) {
    if (!a || !b) return false;
    try {
      const left = new URL(a);
      const right = new URL(b);
      if (ignoreHash) {
        left.hash = '';
        right.hash = '';
      }
      return left.href === right.href;
    } catch (_) {
      return String(a) === String(b);
    }
  }

  function httpStatusResult(status) {
    if (!Number.isInteger(status) || status < 100 || status > 599) return 'UNKNOWN';
    if (status >= 400) return 'FAIL';
    return 'PASS';
  }

  function statusText(status) {
    const map = {
      200: 'OK', 201: 'Created', 204: 'No content', 301: 'Moved permanently', 302: 'Found',
      303: 'See other', 307: 'Temporary redirect', 308: 'Permanent redirect',
      400: 'Bad request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not found',
      429: 'Too many requests', 500: 'Internal server error', 502: 'Bad gateway',
      503: 'Service unavailable', 504: 'Gateway timeout'
    };
    return map[status] || ('HTTP ' + status);
  }

  function createEngine(options) {
    const opts = options || {};
    const chromeApi = opts.chrome || (typeof chrome !== 'undefined' ? chrome : null);
    const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    const logger = opts.logger || (typeof console !== 'undefined' ? console : { error() {}, warn() {}, log() {} });
    const screenshots = opts.screenshots === undefined ? shots : opts.screenshots;
    if (!chromeApi) throw new Error('A Chrome API object is required.');

    const state = {
      settings: { ...core.DEFAULT_SETTINGS },
      sessions: {},
      runtime: new Map(),
      presets: [],
      locks: new Map(),
      eventQueues: new Map(),
      panelPrefs: {},
      readyPromise: null,
      storageWarning: null,
      migrated: false,
      lastNotifyCleanup: 0
    };

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    async function localGet(keys) {
      const result = await chromeApi.storage.local.get(keys);
      return result || {};
    }

    async function localSet(items) {
      return chromeApi.storage.local.set(items);
    }

    async function localRemove(keys) {
      return chromeApi.storage.local.remove(keys);
    }

    function runtimeArea() {
      return (chromeApi.storage && chromeApi.storage.session) ? chromeApi.storage.session : chromeApi.storage.local;
    }

    async function runtimeGet() {
      const result = await runtimeArea().get(KEYS.runtime);
      return result && result[KEYS.runtime] && typeof result[KEYS.runtime] === 'object'
        ? result[KEYS.runtime]
        : {};
    }

    async function runtimeSet(value) {
      return runtimeArea().set({ [KEYS.runtime]: value });
    }

    async function getEvents(sessionId) {
      const key = eventsKey(sessionId);
      const result = await localGet(key);
      return Array.isArray(result[key]) ? result[key] : [];
    }

    async function safeSetLocal(items) {
      try {
        await localSet(items);
        return true;
      } catch (error) {
        if (!isQuotaError(error)) throw error;
        const removed = await pruneForQuota();
        state.storageWarning = removed > 0
          ? 'Local storage was full. Removed ' + removed + ' oldest completed session(s) to continue recording.'
          : 'Local storage is full. Finish or delete old sessions to free space.';
        try {
          await localSet(items);
          return true;
        } catch (secondError) {
          if (isQuotaError(secondError)) {
            state.storageWarning = 'Local storage is full. The latest events could not be saved.';
            return false;
          }
          throw secondError;
        }
      }
    }

    async function pruneForQuota() {
      const completed = Object.values(state.sessions)
        .filter((session) => session.status !== 'active')
        .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
      let removed = 0;
      for (const session of completed) {
        if (removed >= 8) break;
        delete state.sessions[session.id];
        try { await localRemove(eventsKey(session.id)); } catch (_) { /* ignore */ }
        if (screenshots) { try { await screenshots.deleteBySession(session.id); } catch (_) { /* ignore */ } }
        removed += 1;
      }
      if (removed > 0) {
        try { await localSet({ [KEYS.sessions]: state.sessions }); } catch (_) { /* ignore */ }
      }
      return removed;
    }

    async function saveSessions() {
      return safeSetLocal({ [KEYS.sessions]: state.sessions });
    }

    async function saveRuntime() {
      const output = {};
      for (const [tabId, runtime] of state.runtime.entries()) output[tabId] = runtime;
      try {
        await runtimeSet(output);
      } catch (error) {
        logger.warn('Could not persist runtime state', error);
      }
    }

    function appendEvent(sessionId, input) {
      const previous = state.eventQueues.get(sessionId) || Promise.resolve();
      const task = previous.catch(() => {}).then(() => appendEventNow(sessionId, input));
      const tracked = task.finally(() => {
        if (state.eventQueues.get(sessionId) === tracked) state.eventQueues.delete(sessionId);
      });
      state.eventQueues.set(sessionId, tracked);
      return tracked;
    }

    async function appendEventNow(sessionId, input) {
      const session = state.sessions[sessionId];
      if (!session) return null;
      let events = await getEvents(sessionId);
      const event = core.createEvent({
        ...input,
        sessionId,
        tabId: input.tabId === undefined ? session.tabId : input.tabId
      });
      events.push(event);
      const limit = state.settings.historyLimit;
      if (events.length > limit) {
        const dropped = events.length - limit;
        events = events.slice(dropped);
        session.droppedEvents = (session.droppedEvents || 0) + dropped;
      }
      session.eventCount = events.length;
      session.lastEventAt = event.timestamp;
      const saved = await safeSetLocal({
        [KEYS.sessions]: state.sessions,
        [eventsKey(sessionId)]: events
      });
      if (!saved) state.storageWarning = 'Local storage is full; the latest event could not be saved.';
      return event;
    }

    async function updateSession(session) {
      state.sessions[session.id] = session;
      await saveSessions();
      return session;
    }

    // -----------------------------------------------------------------------
    // Hydration, migration, reconciliation
    // -----------------------------------------------------------------------

    async function ensureReady() {
      if (state.readyPromise) return state.readyPromise;
      state.readyPromise = (async () => {
        const local = await localGet([KEYS.settings, KEYS.sessions, KEYS.presets, KEYS.panelPrefs]);
        state.settings = core.normalizeSettings(local[KEYS.settings]);
        state.sessions = local[KEYS.sessions] && typeof local[KEYS.sessions] === 'object'
          ? local[KEYS.sessions]
          : {};
        state.presets = Array.isArray(local[KEYS.presets]) ? local[KEYS.presets] : [];
        state.panelPrefs = normalizePanelPrefs(local[KEYS.panelPrefs]);
        await migrateLegacyLogs();
        const runtimeObject = await runtimeGet();
        state.runtime = new Map();
        for (const [tabId, runtime] of Object.entries(runtimeObject)) {
          if (!runtime || !runtime.sessionId) continue;
          const session = state.sessions[runtime.sessionId];
          if (!session || session.status !== 'active') continue;
          state.runtime.set(String(tabId), runtime);
        }
        await reconcileOrphans();
        await ensureWatchdog();
      })().catch((error) => {
        state.readyPromise = null;
        throw error;
      });
      return state.readyPromise;
    }

    async function migrateLegacyLogs() {
      if (state.migrated) return;
      state.migrated = true;
      const local = await localGet([KEYS.legacyMigrated, KEYS.legacyLogs]);
      if (local[KEYS.legacyMigrated]) return;
      const legacy = local[KEYS.legacyLogs];
      if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
        await localSet({ [KEYS.legacyMigrated]: true });
        return;
      }
      const rows = [];
      for (const [tabId, entries] of Object.entries(legacy)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (!entry || typeof entry !== 'object') continue;
          rows.push({ tabId: Number(tabId), entry });
        }
      }
      if (!rows.length) {
        await localSet({ [KEYS.legacyMigrated]: true });
        return;
      }
      rows.sort((a, b) => String(a.entry.time || '').localeCompare(String(b.entry.time || '')));
      const startedAt = core.isoOrNow(rows[0].entry.time);
      const endedAt = core.isoOrNow(rows[rows.length - 1].entry.time);
      const sessionId = 'legacy-v2.3.0';
      const events = rows.slice(-1000).map((row) => core.createEvent({
        timestamp: row.entry.time,
        sessionId,
        tabId: Number.isFinite(row.tabId) ? row.tabId : null,
        eventType: 'legacy_event',
        checkName: 'Legacy v2.3 log',
        result: 'INFO',
        severity: 'info',
        url: row.entry.url || null,
        actualValue: row.entry.event || 'Legacy event',
        description: row.entry.event || 'Legacy event',
        details: row.entry,
        isCheck: false
      }));
      state.sessions[sessionId] = {
        id: sessionId,
        tabId: null,
        mode: 'refresh',
        startedAt,
        endedAt,
        status: 'stopped',
        stopReason: null,
        url: null,
        title: 'Imported v2.3.0 history',
        config: null,
        eventCount: events.length,
        droppedEvents: Math.max(0, rows.length - events.length),
        screenshotCount: 0,
        importedFrom: '2.3.0'
      };
      const saved = await safeSetLocal({
        [KEYS.sessions]: state.sessions,
        [eventsKey(sessionId)]: events,
        [KEYS.legacyBackup]: legacy,
        [KEYS.legacyMigrated]: true
      });
      if (saved) {
        try { await localRemove(KEYS.legacyLogs); } catch (_) { /* keep backup */ }
      } else {
        state.migrated = false;
      }
    }

    function isFinalizable(sessionId, reason) {
      const session = state.sessions[sessionId];
      if (!session || session.status !== 'active') return Promise.resolve();
      return finalizeSession(session, reason);
    }

    async function finalizeSession(session, reason) {
      const endedAt = core.nowIso(now());
      await appendEvent(session.id, {
        timestamp: endedAt,
        eventType: 'session_stop',
        checkName: 'Session',
        result: 'INFO',
        severity: 'info',
        url: session.url,
        reason,
        actualValue: core.stopReasonLabel(reason),
        description: 'Session stopped — ' + core.stopReasonLabel(reason)
      });
      session.status = 'stopped';
      session.endedAt = endedAt;
      session.stopReason = reason;
      session.durationMs = Math.max(0, Date.parse(endedAt) - Date.parse(session.startedAt));
      await saveSessions();
    }

    async function reconcileOrphans() {
      let changed = false;
      for (const [tabId, runtime] of [...state.runtime.entries()]) {
        const session = state.sessions[runtime.sessionId];
        if (!session || session.status !== 'active') {
          state.runtime.delete(tabId);
          changed = true;
          continue;
        }
        try {
          const tab = await chromeApi.tabs.get(Number(tabId));
          if (!tab || !tab.url || !/^https?:\/\//i.test(tab.url)) throw new Error('Tab is unavailable.');
        } catch (_) {
          state.runtime.delete(tabId);
          await finalizeSession(session, 'tab_closed');
          changed = true;
        }
      }
      const activeWithoutRuntime = Object.values(state.sessions).filter((session) =>
        session.status === 'active' && ![...state.runtime.values()].some((runtime) => runtime.sessionId === session.id));
      for (const session of activeWithoutRuntime) {
        await finalizeSession(session, 'service_worker_reset');
        changed = true;
      }
      if (changed) {
        await safeSetLocal({ [KEYS.sessions]: state.sessions });
        await saveRuntime();
      }
      await ensureWatchdog();
    }

    async function ensureWatchdog() {
      if (!chromeApi.alarms) return;
      const hasReloading = [...state.runtime.values()].some((runtime) => core.isReloadingMode(runtime));
      try {
        if (hasReloading) {
          await chromeApi.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
        } else {
          await chromeApi.alarms.clear(WATCHDOG_ALARM);
        }
      } catch (error) {
        logger.warn('Could not configure the watchdog alarm', error);
      }
    }

    // -----------------------------------------------------------------------
    // Session lifecycle
    // -----------------------------------------------------------------------

    function withLock(tabId, task) {
      const key = String(tabId);
      const previous = state.locks.get(key) || Promise.resolve();
      const next = previous.catch(() => {}).then(task);
      const tracked = next.finally(() => {
        if (state.locks.get(key) === tracked) state.locks.delete(key);
      });
      state.locks.set(key, tracked);
      return tracked;
    }

    function publicState(runtime) {
      if (!runtime) return null;
      return {
        sessionId: runtime.sessionId,
        tabId: runtime.tabId,
        mode: runtime.mode,
        config: runtime.config,
        intervalSeconds: runtime.config.intervalSeconds,
        cycleMode: runtime.config.cycleMode,
        reloadsPerCycle: runtime.config.reloadsPerCycle,
        pauseSeconds: runtime.config.pauseSeconds,
        autoRefresh: runtime.config.autoRefresh,
        phase: runtime.phase,
        reloadsInCycle: runtime.reloadsInCycle,
        nextActionAt: runtime.nextActionAt,
        startedAt: runtime.startedAt,
        url: runtime.currentUrl || runtime.url,
        expectedUrl: runtime.expectedUrl,
        title: runtime.title,
        lastResult: runtime.lastResult,
        lastCheck: runtime.lastCheck,
        failureCount: runtime.failureCount || 0,
        isReloading: core.isReloadingMode(runtime.config),
        status: 'active'
      };
    }

    function latestSessionForTab(tabId) {
      return Object.values(state.sessions)
        .filter((session) => session.tabId === Number(tabId))
        .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0] || null;
    }

    async function startSession(payload) {
      const tabId = Number(payload && payload.tabId);
      if (!Number.isInteger(tabId)) return { ok: false, error: 'A valid tab is required.' };
      return withLock(tabId, () => startSessionLocked(tabId, payload));
    }

    async function startSessionLocked(tabId, payload) {
      await ensureReady();
      if (state.runtime.has(String(tabId))) {
        return { ok: false, error: 'Monitoring is already active on this tab. Stop it before starting a new session.' };
      }
      const configCheck = core.validateConfig(payload && payload.config);
      if (!configCheck.ok) return { ok: false, error: configCheck.errors.join(' ') };
      const config = configCheck.config;
      let tab;
      try {
        tab = await chromeApi.tabs.get(tabId);
      } catch (_) {
        return { ok: false, error: 'The tab could not be found. It may have been closed.' };
      }
      const url = tab && (tab.url || tab.pendingUrl);
      if (!url || !/^https?:\/\//i.test(url)) {
        return { ok: false, error: 'This page cannot be monitored. Open a regular HTTP or HTTPS webpage.' };
      }
      const activeCount = [...state.runtime.values()].length;
      if (activeCount >= core.LIMITS.maxSessions) {
        return { ok: false, error: 'Too many active sessions. Stop one before starting another.' };
      }
      const sessionId = 'sess-' + now().toString(36) + '-' + core.uuid().slice(0, 8);
      const startedAt = core.nowIso(now());
      const session = {
        id: sessionId,
        tabId,
        mode: config.mode,
        startedAt,
        endedAt: null,
        status: 'active',
        stopReason: null,
        url,
        title: tab.title || url,
        expectedUrl: config.url.expectedUrl || url,
        config,
        eventCount: 0,
        droppedEvents: 0,
        screenshotCount: 0,
        importedFrom: null
      };
      state.sessions[sessionId] = session;
      const runtime = {
        sessionId,
        tabId,
        mode: config.mode,
        config,
        url,
        currentUrl: url,
        title: session.title,
        expectedUrl: session.expectedUrl,
        startedAt,
        phase: 'active',
        reloadsInCycle: 0,
        nextActionAt: core.isReloadingMode(config) ? now() + config.intervalSeconds * 1000 : null,
        lastReloadAt: 0,
        consecutiveFailures: 0,
        failureCount: 0,
        lastResult: null,
        lastCheck: null,
        lastCheckAt: null,
        lastBaselineAt: null,
        lastLoadKey: null,
        lastCompletion: null,
        lastRedirect: null,
        checkDedupe: {},
        matchedState: {},
        failureState: {},
        notifications: {},
        screenshotCount: 0,
        lastScreenshotAt: 0,
        pendingNavigation: null,
        lastNavigation: null
      };
      state.runtime.set(String(tabId), runtime);
      await saveSessions();
      await saveRuntime();
      await pruneSessions();
      await appendEvent(sessionId, {
        eventType: 'session_start',
        checkName: 'Session',
        result: 'INFO',
        severity: 'info',
        url,
        actualValue: core.modeLabel(config.mode),
        description: 'Session started — ' + core.modeLabel(config.mode) + ' — ' + url,
        details: {
          mode: config.mode,
          intervalSeconds: config.intervalSeconds,
          cycleMode: config.cycleMode,
          autoRefresh: config.autoRefresh,
          settleMs: config.settleMs
        }
      });
      if (config.http.enabled) {
        await appendEvent(sessionId, {
          eventType: 'http_status',
          checkName: 'HTTP status',
          result: 'UNKNOWN',
          severity: 'info',
          url,
          expectedValue: null,
          actualValue: 'Not observed',
          reason: 'The page was already loaded before monitoring started. The current response status cannot be determined.',
          details: { observed: false }
        });
      }
      await ensureWatchdog();
      await updateBadge(tabId, runtime);
      await ensureContentScript(tabId);
      return { ok: true, state: publicState(runtime), session, settings: state.settings };
    }

    async function pruneSessions() {
      const entries = Object.values(state.sessions).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
      let excess = entries.length - core.LIMITS.maxSessions;
      if (excess <= 0) return;
      for (const session of entries) {
        if (excess <= 0) break;
        if (session.status === 'active') continue;
        delete state.sessions[session.id];
        try { await localRemove(eventsKey(session.id)); } catch (_) { /* ignore */ }
        if (screenshots) { try { await screenshots.deleteBySession(session.id); } catch (_) { /* ignore */ } }
        excess -= 1;
      }
      await saveSessions();
    }

    async function stopSession(tabId, options) {
      const id = Number(tabId);
      if (!Number.isInteger(id)) return { ok: false, error: 'A valid tab is required.' };
      return withLock(id, () => stopSessionLocked(id, options));
    }

    async function stopSessionLocked(tabId, options) {
      await ensureReady();
      const opts = options || {};
      const runtime = state.runtime.get(String(tabId));
      if (!runtime) return { ok: true, alreadyStopped: true };
      const session = state.sessions[runtime.sessionId];
      state.runtime.delete(String(tabId));
      await saveRuntime();
      await ensureWatchdog();
      // Finalize durable data before telling the page to stop, so a floating
      // panel that asks for its final summary sees the stopped session.
      if (session && session.status === 'active') {
        await finalizeSession(session, opts.reason || 'user');
      }
      try {
        await chromeApi.tabs.sendMessage(tabId, { type: 'STOP_CONTENT_REFRESH' });
      } catch (_) { /* tab may be gone */ }
      try {
        await chromeApi.action.setBadgeText({ tabId, text: '' });
      } catch (_) { /* ignore */ }
      return { ok: true, state: null, session };
    }

    async function stopAllSessions(reason) {
      await ensureReady();
      const ids = [...state.runtime.keys()].map(Number);
      for (const tabId of ids) {
        await stopSession(tabId, { reason: reason || 'user' });
      }
      return { ok: true, stopped: ids.length };
    }

    async function handleTabRemoved(tabId) {
      await ensureReady();
      await stopSession(Number(tabId), { reason: 'tab_closed' });
    }

    async function handleTabReplaced(addedTabId, removedTabId) {
      await ensureReady();
      if (state.runtime.has(String(removedTabId))) {
        await stopSession(Number(removedTabId), { reason: 'tab_unavailable' });
      }
      if (state.runtime.has(String(addedTabId))) {
        await stopSession(Number(addedTabId), { reason: 'tab_unavailable' });
      }
    }

    async function handleTabUpdated(tabId, changeInfo, tab) {
      await ensureReady();
      return withLock(tabId, async () => {
        const runtime = state.runtime.get(String(tabId));
        if (!runtime) return;
        if (changeInfo && changeInfo.url) {
          if (!/^https?:\/\//i.test(changeInfo.url)) {
            await stopSessionLocked(tabId, { reason: 'tab_unavailable' });
            return;
          }
          runtime.currentUrl = changeInfo.url;
          runtime.url = changeInfo.url;
          await saveRuntime();
        }
        if (tab && tab.title) runtime.title = tab.title;
        if (changeInfo && changeInfo.status === 'complete') {
          try {
            await chromeApi.tabs.sendMessage(tabId, { type: 'SYNC_CONTENT_REFRESH' });
          } catch (_) {
            await ensureContentScript(tabId);
          }
          await updateBadge(tabId, runtime);
          await saveRuntime();
        }
      });
    }

    // -----------------------------------------------------------------------
    // Refresh scheduling
    // -----------------------------------------------------------------------

    async function updateBadge(tabId, runtime) {
      if (!chromeApi.action) return;
      const badge = core.badgeForState(runtime, state.settings, now(), runtime ? runtime.failureCount : 0);
      try {
        await chromeApi.action.setBadgeText({ tabId, text: badge.text });
        if (badge.color) await chromeApi.action.setBadgeBackgroundColor({ tabId, color: badge.color });
      } catch (_) { /* tab may be gone */ }
    }

    async function handleRefreshDue(tabId) {
      const id = Number(tabId);
      return withLock(id, () => refreshDueLocked(id));
    }

    async function refreshDueLocked(tabId) {
      await ensureReady();
      const runtime = state.runtime.get(String(tabId));
      if (!runtime) return { ok: false, error: 'No active session for this tab.' };
      if (!core.isReloadingMode(runtime.config)) return { ok: false, error: 'This session does not reload pages.' };
      if (!Number.isFinite(Number(runtime.nextActionAt))) {
        runtime.nextActionAt = now() + runtime.config.intervalSeconds * 1000;
        await saveRuntime();
      }
      const earlyBy = Number(runtime.nextActionAt) - now();
      if (earlyBy > 500) return { ok: false, error: 'Refresh is not due yet.', nextActionAt: runtime.nextActionAt };
      if (runtime.lastReloadAt && now() - runtime.lastReloadAt < 1500) {
        return { ok: false, error: 'A refresh was already requested moments ago.' };
      }
      let tab;
      try {
        tab = await chromeApi.tabs.get(tabId);
      } catch (_) {
        await stopSessionLocked(tabId, { reason: 'tab_closed' });
        return { ok: false, error: 'Tab closed.' };
      }
      if (!tab || !tab.url || !/^https?:\/\//i.test(tab.url)) {
        await stopSessionLocked(tabId, { reason: 'tab_unavailable' });
        return { ok: false, error: 'Tab is not an HTTP/HTTPS page.' };
      }
      const nextState = core.advanceSchedule(runtime, now());
      runtime.phase = nextState.phase;
      runtime.reloadsInCycle = nextState.reloadsInCycle;
      runtime.nextActionAt = nextState.nextActionAt;
      runtime.lastReloadAt = now();
      runtime.currentUrl = tab.url;
      runtime.url = tab.url;
      await saveRuntime();
      await appendEvent(runtime.sessionId, {
        eventType: 'reload_requested',
        checkName: 'Refresh',
        result: 'INFO',
        severity: 'info',
        url: tab.url,
        actualValue: runtime.config.cycleMode === 'cycles'
          ? runtime.reloadsInCycle + '/' + runtime.config.reloadsPerCycle
          : 'Continuous',
        description: 'Reload requested.',
        details: {
          phase: runtime.phase,
          reloadsInCycle: runtime.reloadsInCycle,
          intervalSeconds: runtime.config.intervalSeconds,
          bypassCache: runtime.config.bypassCache
        }
      });
      await updateBadge(tabId, runtime);
      try {
        await chromeApi.tabs.reload(tabId, { bypassCache: Boolean(runtime.config.bypassCache) });
        runtime.consecutiveFailures = 0;
        await saveRuntime();
      } catch (error) {
        runtime.consecutiveFailures = (runtime.consecutiveFailures || 0) + 1;
        const reason = error && error.message ? error.message : 'Chrome could not reload the tab.';
        await appendEvent(runtime.sessionId, {
          eventType: 'reload_failed',
          checkName: 'Refresh',
          result: 'FAIL',
          severity: 'error',
          url: tab.url,
          reason,
          actualValue: String(runtime.consecutiveFailures),
          description: 'Reload failed — ' + reason
        });
        if (runtime.consecutiveFailures >= 3) {
          await stopSessionLocked(tabId, { reason: 'reload_failed' });
        } else {
          try { await chromeApi.tabs.sendMessage(tabId, { type: 'SYNC_CONTENT_REFRESH' }); } catch (_) { /* ignore */ }
        }
        return { ok: false, error: reason };
      }
      return { ok: true, nextActionAt: runtime.nextActionAt, phase: runtime.phase };
    }

    async function handleWatchdog() {
      await ensureReady();
      const tabIds = [...state.runtime.keys()].map(Number);
      for (const tabId of tabIds) {
        await withLock(tabId, async () => {
          const runtime = state.runtime.get(String(tabId));
          if (!runtime) return;
          if (!core.isReloadingMode(runtime.config) || !Number.isFinite(Number(runtime.nextActionAt))) {
            await updateBadge(tabId, runtime);
            return;
          }
          if (now() < runtime.nextActionAt - 500) {
            await updateBadge(tabId, runtime);
            return;
          }
          const overdue = now() - runtime.nextActionAt;
          if (overdue > Math.max(120000, runtime.config.intervalSeconds * 3000)) {
            const nextState = core.advanceSchedule(runtime, now());
            runtime.phase = nextState.phase;
            runtime.reloadsInCycle = nextState.reloadsInCycle;
            runtime.nextActionAt = nextState.nextActionAt;
            await saveRuntime();
            await appendEvent(runtime.sessionId, {
              eventType: 'reload_failed',
              checkName: 'Refresh',
              result: 'WARN',
              severity: 'warning',
              url: runtime.currentUrl,
              reason: 'Missed refresh window',
              actualValue: core.formatDuration(Math.round(overdue / 1000)),
              description: 'Missed refresh skipped after the browser was inactive; the next refresh was rescheduled.'
            });
            await updateBadge(tabId, runtime);
            try { await chromeApi.tabs.sendMessage(tabId, { type: 'SYNC_CONTENT_REFRESH' }); } catch (_) { /* ignore */ }
            return;
          }
          await refreshDueLocked(tabId);
        });
      }
    }

    async function ensureContentScript(tabId) {
      try {
        const response = await chromeApi.tabs.sendMessage(tabId, { type: 'SYNC_CONTENT_REFRESH' });
        if (response && response.ok !== false) return;
      } catch (_) { /* inject below */ }
      try {
        if (chromeApi.scripting && chromeApi.scripting.executeScript) {
          await chromeApi.scripting.executeScript({ target: { tabId }, files: ['refresh-content.js'] });
        }
      } catch (error) {
        logger.warn('Could not inject the monitoring content script', error);
      }
      try {
        await chromeApi.tabs.sendMessage(tabId, { type: 'SYNC_CONTENT_REFRESH' });
      } catch (_) { /* page may forbid injection */ }
    }

    // -----------------------------------------------------------------------
    // webRequest navigation events
    // -----------------------------------------------------------------------

    function navigationRuntime(details) {
      if (!details || details.frameId !== 0) return null;
      return state.runtime.get(String(details.tabId)) || null;
    }

    async function handleBeforeNavigate(details) {
      await ensureReady();
      const runtime = navigationRuntime(details);
      if (!runtime) return;
      runtime.pendingNavigation = {
        url: details.url || runtime.currentUrl,
        timeStamp: details.timeStamp || now(),
        transitionType: details.transitionType || null
      };
      await saveRuntime();
    }

    async function recordRedirect(runtime, fromUrl, toUrl, status, reason) {
      const nowMs = now();
      if (runtime.lastRedirect && runtime.lastRedirect.url === String(toUrl) && nowMs - runtime.lastRedirect.at < 3000) return;
      runtime.lastRedirect = { url: String(toUrl), at: nowMs };
      const expected = runtime.config.url.expectedUrl || runtime.expectedUrl;
      const unexpected = runtime.config.url.enabled && expected && !sameUrl(toUrl, expected, runtime.config.url.ignoreHash);
      await appendEvent(runtime.sessionId, {
        eventType: 'redirect',
        checkName: 'Redirect',
        result: unexpected ? 'WARN' : 'INFO',
        severity: unexpected ? 'warning' : 'info',
        url: fromUrl,
        expectedValue: expected || null,
        actualValue: toUrl,
        httpStatus: status || null,
        reason: reason || (unexpected ? 'Redirected away from the expected URL.' : 'Redirect observed.'),
        description: 'Redirect — ' + (unexpected ? 'WARN' : 'INFO') + ' — ' + toUrl,
        details: { from: fromUrl, to: toUrl, status: status || null }
      });
      if (unexpected && runtime.config.notifyOnFailure) {
        await maybeNotify(runtime, 'redirect', 'Redirected away from the expected URL: ' + toUrl);
      }
      await saveRuntime();
    }

    async function handleBeforeRedirect(details) {
      await ensureReady();
      const runtime = navigationRuntime(details);
      if (!runtime) return;
      await withLock(details.tabId, async () => {
        const fresh = state.runtime.get(String(details.tabId));
        if (!fresh) return;
        await recordRedirect(fresh, details.url, details.redirectUrl, details.statusCode, 'Server redirect observed.');
      });
    }

    async function handleCompleted(details) {
      await ensureReady();
      const runtime = navigationRuntime(details);
      if (!runtime) return;
      await withLock(details.tabId, async () => {
        const fresh = state.runtime.get(String(details.tabId));
        if (!fresh) return;
        const status = Number.isInteger(details.statusCode) && details.statusCode >= 100 && details.statusCode <= 599
          ? details.statusCode
          : null;
        const result = httpStatusResult(status);
        const completionKey = (details.url || '') + '|' + String(status || 'unknown');
        const previous = fresh.lastCompletion;
        if (previous && previous.key === completionKey && now() - previous.at < 1500) return;
        fresh.lastCompletion = { key: completionKey, at: now() };
        fresh.currentUrl = details.url || fresh.currentUrl;
        fresh.url = details.url || fresh.url;
        const pending = fresh.pendingNavigation;
        const navDurationMs = pending && pending.timeStamp && details.timeStamp
          ? Math.max(0, Math.round(details.timeStamp - pending.timeStamp))
          : null;
        const description = status
          ? 'Navigation completed — ' + result + ' — HTTP ' + status + ' ' + statusText(status)
          : 'Navigation completed — UNKNOWN — HTTP status unavailable';
        const event = await appendEvent(fresh.sessionId, {
          eventType: 'navigation',
          checkName: 'HTTP status',
          result,
          severity: result === 'FAIL' ? 'error' : core.severityForResult(result),
          url: details.url || fresh.currentUrl,
          expectedValue: null,
          actualValue: status ? 'HTTP ' + status : null,
          httpStatus: status,
          reason: status ? statusText(status) : 'Chrome did not expose a response status for this navigation.',
          description,
          details: {
            statusCode: status,
            fromCache: Boolean(details.fromCache),
            transitionType: details.transitionType || null,
            transitionQualifiers: Array.isArray(details.transitionQualifiers) ? details.transitionQualifiers : [],
            navigationDurationMs: navDurationMs
          }
        });
        fresh.lastResult = result;
        fresh.lastCheck = { type: 'http', result, description, at: core.nowIso(now()) };
        fresh.lastCheckAt = now();
        if (result === 'FAIL') {
          fresh.failureCount = (fresh.failureCount || 0) + 1;
          if (fresh.config.notifyOnFailure) {
            await maybeNotify(fresh, 'http-failure', description);
          }
          if (event && fresh.config.screenshotOnFailure) {
            await maybeCapture(fresh.sessionId, fresh, event, 'HTTP ' + status);
          }
        }
        if (fresh.config.url.enabled) {
          const expected = fresh.config.url.expectedUrl || fresh.expectedUrl;
          if (expected) {
            const matches = sameUrl(details.url || fresh.currentUrl, expected, fresh.config.url.ignoreHash);
            const urlResult = matches ? 'PASS' : 'FAIL';
            const urlDescription = matches
              ? 'URL validation — PASS — URL unchanged'
              : 'URL validation — FAIL — unexpected destination';
            const dedupe = fresh.checkDedupe.url || {};
            const urlKey = urlResult + '|' + details.url;
            if (!dedupe.key || dedupe.key !== urlKey || now() - dedupe.at > 2000) {
              await appendEvent(fresh.sessionId, {
                eventType: 'url_check',
                checkName: 'URL validation',
                result: urlResult,
                severity: urlResult === 'FAIL' ? 'error' : 'info',
                url: details.url || fresh.currentUrl,
                expectedValue: expected,
                actualValue: details.url || fresh.currentUrl,
                reason: matches ? 'Top-level URL matches the expectation.' : 'Navigation ended on a different URL than expected.',
                description: urlDescription,
                details: { ignoreHash: fresh.config.url.ignoreHash, source: 'webRequest' }
              });
              fresh.checkDedupe.url = { key: urlKey, at: now(), result: urlResult };
              if (urlResult === 'FAIL') {
                fresh.failureCount = (fresh.failureCount || 0) + 1;
                if (fresh.config.notifyOnFailure) await maybeNotify(fresh, 'url-failure', urlDescription);
              }
            }
          }
        }
        await saveRuntime();
        await updateBadge(details.tabId, fresh);
        if (fresh.config.stopOnFailure && (result === 'FAIL' || fresh.checkDedupe.url?.result === 'FAIL')) {
          await stopSessionLocked(details.tabId, { reason: 'failure_condition' });
        }
      });
    }

    async function handleErrorOccurred(details) {
      await ensureReady();
      const runtime = navigationRuntime(details);
      if (!runtime) return;
      await withLock(details.tabId, async () => {
        const fresh = state.runtime.get(String(details.tabId));
        if (!fresh) return;
        const errorText = details.error || 'Navigation error';
        const aborted = errorText === 'net::ERR_ABORTED';
        const result = aborted ? 'WARN' : 'FAIL';
        await appendEvent(fresh.sessionId, {
          eventType: 'navigation_error',
          checkName: 'Navigation',
          result,
          severity: aborted ? 'warning' : 'error',
          url: details.url || fresh.currentUrl,
          actualValue: errorText,
          reason: aborted ? 'Navigation was aborted (often caused by another navigation).' : errorText,
          description: 'Navigation failed — ' + result + ' — ' + errorText,
          details: { error: errorText, transitionType: details.transitionType || null }
        });
        fresh.lastResult = result;
        fresh.lastCheck = { type: 'navigation', result, description: 'Navigation failed — ' + errorText, at: core.nowIso(now()) };
        fresh.lastCheckAt = now();
        if (result === 'FAIL') {
          fresh.failureCount = (fresh.failureCount || 0) + 1;
          if (fresh.config.notifyOnFailure) await maybeNotify(fresh, 'navigation-error', 'Navigation failed: ' + errorText);
          if (fresh.config.screenshotOnFailure) {
            const events = await getEvents(fresh.sessionId);
            const latest = events[events.length - 1];
            if (latest) await maybeCapture(fresh.sessionId, fresh, latest, errorText);
          }
          if (fresh.config.stopOnFailure) {
            await stopSessionLocked(details.tabId, { reason: 'navigation_error' });
            return;
          }
        }
        await saveRuntime();
        await updateBadge(details.tabId, fresh);
      });
    }

    // -----------------------------------------------------------------------
    // Notifications and screenshots
    // -----------------------------------------------------------------------

    async function maybeNotify(runtime, key, message) {
      if (!chromeApi.notifications) return;
      const map = runtime.notifications || (runtime.notifications = {});
      const last = map[key];
      if (last && now() - last < NOTIFICATION_TTL_MS) return;
      map[key] = now();
      const notificationId = 'odesoftami:' + runtime.sessionId + ':' + key + ':' + now().toString(36);
      try {
        await chromeApi.notifications.create(notificationId, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: core.PRODUCT,
          message: String(message).slice(0, 300),
          priority: 1
        });
      } catch (error) {
        logger.warn('Notification could not be shown', error);
      }
      if (now() - state.lastNotifyCleanup > 300000) {
        state.lastNotifyCleanup = now();
        for (const [entryKey, at] of Object.entries(map)) {
          if (now() - at > 600000) delete map[entryKey];
        }
      }
      await saveRuntime();
    }

    async function maybeCapture(sessionId, runtime, event, reason) {
      if (!screenshots) return;
      if (!runtime || !runtime.config.screenshotOnFailure) return;
      const session = state.sessions[sessionId];
      if (!session) return;
      const skippedKey = 'screenshot-skip';
      if ((session.screenshotCount || 0) >= core.LIMITS.maxScreenshotsPerSession) {
        await recordScreenshotSkipped(runtime, skippedKey, 'Screenshot limit reached for this session (maximum 3).');
        return;
      }
      if (now() - (runtime.lastScreenshotAt || 0) < core.LIMITS.screenshotThrottleMs) return;
      let tab;
      try {
        tab = await chromeApi.tabs.get(runtime.tabId);
      } catch (_) {
        await recordScreenshotSkipped(runtime, skippedKey, 'The tab is no longer available.');
        return;
      }
      if (!tab || !tab.active) {
        await recordScreenshotSkipped(runtime, skippedKey, 'The tab is not active. Chrome can only capture the visible tab.');
        return;
      }
      if (chromeApi.windows && typeof chromeApi.windows.get === 'function') {
        try {
          const windowInfo = await chromeApi.windows.get(tab.windowId);
          if (!windowInfo || windowInfo.focused === false) {
            await recordScreenshotSkipped(runtime, skippedKey, 'The browser window is not focused.');
            return;
          }
        } catch (_) { /* proceed; capture may still work */ }
      }
      if (!chromeApi.tabs.captureVisibleTab) {
        await recordScreenshotSkipped(runtime, skippedKey, 'Screenshot capture is not available in this Chrome version.');
        return;
      }
      try {
        const dataUrl = await chromeApi.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 });
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
          throw new Error('Chrome returned no image data.');
        }
        if (dataUrl.length * 0.75 > core.LIMITS.maxScreenshotDataUrlBytes) {
          throw new Error('The screenshot is larger than the 2.5 MB local limit.');
        }
        const record = await screenshots.put({
          sessionId,
          eventId: event ? event.id : null,
          timestamp: core.nowIso(now()),
          url: runtime.currentUrl || runtime.url,
          dataUrl
        });
        session.screenshotCount = (session.screenshotCount || 0) + 1;
        runtime.screenshotCount = session.screenshotCount;
        runtime.lastScreenshotAt = now();
        await saveSessions();
        await appendEvent(sessionId, {
          eventType: 'screenshot',
          checkName: 'Screenshot',
          result: 'INFO',
          severity: 'info',
          url: runtime.currentUrl || runtime.url,
          actualValue: core.formatBytes(record.bytes),
          reason: reason || null,
          description: 'Screenshot captured locally — ' + core.formatBytes(record.bytes),
          details: { screenshotId: record.id, storage: 'IndexedDB', uploaded: false }
        });
        await saveRuntime();
      } catch (error) {
        await recordScreenshotSkipped(runtime, skippedKey, error && error.message ? error.message : 'Screenshot capture failed.');
      }
    }

    async function recordScreenshotSkipped(runtime, key, reason) {
      const map = runtime.notifications || (runtime.notifications = {});
      const dedupeKey = key + ':' + reason;
      if (map[dedupeKey] && now() - map[dedupeKey] < 60000) return;
      map[dedupeKey] = now();
      await appendEvent(runtime.sessionId, {
        eventType: 'screenshot_skipped',
        checkName: 'Screenshot',
        result: 'WARN',
        severity: 'warning',
        url: runtime.currentUrl || runtime.url,
        reason,
        actualValue: 'Not captured',
        description: 'Screenshot skipped — ' + reason
      });
      await saveRuntime();
    }

    // -----------------------------------------------------------------------
    // Content-script messages
    // -----------------------------------------------------------------------

    async function handleContentReady(sender, message) {
      await ensureReady();
      const tabId = sender && sender.tab ? Number(sender.tab.id) : NaN;
      const runtime = Number.isInteger(tabId) ? state.runtime.get(String(tabId)) : null;
      if (!runtime) return { ok: true, state: null, settings: state.settings };
      return withLock(tabId, async () => {
        const fresh = state.runtime.get(String(tabId));
        if (!fresh) return { ok: true, state: null, settings: state.settings };
        if (message && message.url && /^https?:\/\//i.test(message.url)) {
          fresh.currentUrl = message.url;
          fresh.url = message.url;
        }
        await saveRuntime();
        return {
          ok: true,
          state: publicState(fresh),
          settings: state.settings,
          sessionId: fresh.sessionId
        };
      });
    }

    async function handleBaseline(sender, message) {
      await ensureReady();
      const tabId = sender && sender.tab ? Number(sender.tab.id) : NaN;
      const runtime = Number.isInteger(tabId) ? state.runtime.get(String(tabId)) : null;
      if (!runtime) return { ok: true, ignored: true };
      return withLock(tabId, async () => {
        const fresh = state.runtime.get(String(tabId));
        if (!fresh) return { ok: true, ignored: true };
        const url = message && typeof message.url === 'string' ? message.url.slice(0, 2048) : fresh.currentUrl;
        if (fresh.lastBaselineAt && now() - fresh.lastBaselineAt < 1500 && fresh.lastBaselineUrl === url) {
          return { ok: true, deduped: true };
        }
        fresh.lastBaselineAt = now();
        fresh.lastBaselineUrl = url;
        await appendEvent(fresh.sessionId, {
        eventType: 'baseline',
        checkName: 'Baseline',
        result: 'INFO',
        severity: 'info',
        url,
        actualValue: message && message.found === true ? 'Text present' : 'Text absent',
        reason: 'Initial state captured before live checks were evaluated.',
        description: 'Monitoring baseline captured.',
        details: {
          textFound: Boolean(message && message.found),
          textLength: core.toInteger(message && message.textLength, 0),
          domPresent: message && message.domPresent === null ? null : Boolean(message && message.domPresent),
          domTextLength: core.toInteger(message && message.domTextLength, 0),
          readyState: core.toNullableString(message && message.readyState, 20)
        }
      });
        await saveRuntime();
        return { ok: true };
      });
    }

    async function handleCheckResults(sender, message) {
      await ensureReady();
      const tabId = sender && sender.tab ? Number(sender.tab.id) : NaN;
      const runtime = Number.isInteger(tabId) ? state.runtime.get(String(tabId)) : null;
      if (!runtime) return { ok: true, ignored: true };
      return withLock(tabId, async () => {
        const fresh = state.runtime.get(String(tabId));
        if (!fresh) return { ok: true, ignored: true };
        const session = state.sessions[fresh.sessionId];
        if (!session || session.status !== 'active') return { ok: true, ignored: true };
        const checks = Array.isArray(message && message.checks) ? message.checks.slice(0, 10) : [];
        let stopReason = null;
        let recorded = 0;
        for (const raw of checks) {
          if (!raw || typeof raw !== 'object') continue;
          const type = ['text', 'dom', 'url'].includes(raw.type) ? raw.type : null;
          if (!type) continue;
          const result = ['PASS', 'FAIL', 'WARN', 'UNKNOWN'].includes(raw.result) ? raw.result : 'UNKNOWN';
          const checkName = type === 'text' ? 'Text condition' : type === 'dom' ? 'DOM element' : 'URL validation';
          const actual = core.toNullableString(raw.actual, 500);
          const reason = core.toNullableString(raw.reason, 500);
          const expected = core.toNullableString(raw.expected, 500);
          const description = core.toNullableString(raw.description, 500) ||
            (checkName + ' — ' + result + (reason ? ' — ' + reason : ''));
          const dedupe = fresh.checkDedupe[type] || {};
          const dedupeKey = result + '|' + String(actual) + '|' + String(reason);
          const dedupeMs = Math.max(1500, Number(fresh.config.settleMs) * 2);
          const matchedNow = raw.matched === true;
          fresh.matchedState = fresh.matchedState || {};
          fresh.failureState = fresh.failureState || {};
          const wasMatched = fresh.matchedState[type] === true;
          const wasFailing = fresh.failureState[type] === true;
          fresh.matchedState[type] = matchedNow;
          fresh.failureState[type] = result === 'FAIL';
          fresh.lastCheck = { type, result, description, at: core.nowIso(now()) };
          fresh.lastCheckAt = now();
          fresh.lastResult = result;
          if (dedupe.key === dedupeKey && now() - dedupe.at < dedupeMs) {
            continue;
          }
          fresh.checkDedupe[type] = { key: dedupeKey, at: now(), result };
          const event = await appendEvent(fresh.sessionId, {
            eventType: type === 'text' ? 'text_check' : type === 'dom' ? 'dom_check' : 'url_check',
            checkName,
            result,
            severity: core.severityForResult(result),
            url: core.toNullableString(raw.url, 2048) || fresh.currentUrl,
            expectedValue: expected,
            actualValue: actual,
            reason,
            description,
            details: core.isPlainObject(raw.details) ? raw.details : null
          });
          recorded += 1;
          if (result === 'FAIL') {
            fresh.failureCount = (fresh.failureCount || 0) + 1;
            if (fresh.config.notifyOnFailure && !wasFailing) {
              await maybeNotify(fresh, type + '-failure', checkName + ': ' + (reason || actual || 'check failed'));
            }
            if (fresh.config.screenshotOnFailure && event) {
              await maybeCapture(fresh.sessionId, fresh, event, reason || checkName + ' failed');
            }
            if (fresh.config.stopOnFailure && !stopReason) stopReason = 'failure_condition';
          }
          if (type === 'text' && matchedNow && !wasMatched && fresh.config.notifyOnMatch) {
            await maybeNotify(fresh, 'text-matched', 'Condition matched: ' + checkName + (actual ? ' — ' + actual : ''));
          }
          if (type === 'text' && matchedNow && !wasMatched && fresh.config.stopOnMatch && !stopReason) stopReason = 'condition_met';
        }
        await saveRuntime();
        await updateBadge(tabId, fresh);
        if (stopReason) {
          await stopSessionLocked(tabId, { reason: stopReason });
        }
        return { ok: true, recorded, stopped: Boolean(stopReason), stopReason };
      });
    }

    async function handleLoadTiming(sender, message) {
      await ensureReady();
      const tabId = sender && sender.tab ? Number(sender.tab.id) : NaN;
      const runtime = Number.isInteger(tabId) ? state.runtime.get(String(tabId)) : null;
      if (!runtime) return { ok: true, ignored: true };
      return withLock(tabId, async () => {
        const fresh = state.runtime.get(String(tabId));
        if (!fresh) return { ok: true, ignored: true };
        if (!fresh.config.timing.enabled) return { ok: true, ignored: true };
        const navigationStart = core.toNullableNumber(message && message.navigationStart, 0, Number.MAX_SAFE_INTEGER);
        const dcl = core.toNullableNumber(message && message.domContentLoadedMs, 0, 600000);
        const load = core.toNullableNumber(message && message.loadEventMs, 0, 600000);
        const duration = core.toNullableNumber(message && message.durationMs, 0, 600000);
        const readyState = core.toNullableString(message && message.readyState, 20) || 'unknown';
        const loadKey = String(navigationStart) + '|' + String(duration) + '|' + readyState;
        if (fresh.lastLoadKey === loadKey) return { ok: true, deduped: true };
        fresh.lastLoadKey = loadKey;
        const historical = navigationStart && navigationStart < Date.parse(fresh.startedAt);
        let result = 'PASS';
        let reason = null;
        if (message && message.state === 'unavailable') {
          result = 'UNKNOWN';
          reason = 'Navigation Timing data is unavailable for this document.';
        } else if (message && message.state === 'incomplete' || readyState !== 'complete' && duration === null) {
          result = 'WARN';
          reason = 'The load event has not fired yet; the total load duration is unavailable.';
        } else if (duration === null || load === null) {
          result = 'UNKNOWN';
          reason = 'Navigation Timing data is unavailable for this document.';
        } else if (historical) {
          result = 'UNKNOWN';
          reason = 'This timing belongs to a page loaded before the session started; it is historical, not a new measurement.';
        } else if (fresh.config.timing.budgetMs > 0 && duration > fresh.config.timing.budgetMs) {
          result = 'WARN';
          reason = 'Load duration exceeded the configured ' + fresh.config.timing.budgetMs + ' ms budget.';
        }
        const countable = result !== 'UNKNOWN' && !historical && duration !== null;
        await appendEvent(fresh.sessionId, {
          eventType: 'page_load',
          checkName: 'Page load',
          result,
          severity: core.severityForResult(result),
          url: fresh.currentUrl,
          expectedValue: fresh.config.timing.budgetMs > 0 ? '≤ ' + fresh.config.timing.budgetMs + ' ms' : null,
          actualValue: duration === null ? null : core.formatMs(duration) + (countable ? '' : ' (not counted)'),
          loadDurationMs: countable ? duration : null,
          reason,
          description: 'Page load — ' + result + (duration === null
            ? ' — timing unavailable'
            : countable ? ' — ' + core.formatMs(duration) : ' — historical timing (not counted)'),
          details: {
            navigationStart,
            domContentLoadedMs: dcl,
            loadEventMs: load,
            durationMs: duration,
            readyState,
            historical: Boolean(historical),
            source: 'Navigation Timing API'
          }
        });
        fresh.lastCheck = { type: 'performance', result, description: 'Page load — ' + result, at: core.nowIso(now()) };
        fresh.lastCheckAt = now();
        fresh.lastResult = result;
        await saveRuntime();
        return { ok: true, result };
      });
    }

    async function handleContentError(sender, message) {
      await ensureReady();
      const tabId = sender && sender.tab ? Number(sender.tab.id) : NaN;
      const runtime = Number.isInteger(tabId) ? state.runtime.get(String(tabId)) : null;
      if (!runtime) return { ok: true, ignored: true };
      return withLock(tabId, async () => {
        const fresh = state.runtime.get(String(tabId));
        if (!fresh) return { ok: true, ignored: true };
        const scope = message && message.scope === 'dom' ? 'dom' : 'text';
        const code = core.toNullableString(message && message.code, 80) || 'monitor_error';
        const reason = core.toNullableString(message && message.message, 500) || 'The monitor could not run.';
        const key = scope + ':' + code;
        const dedupe = fresh.checkDedupe[key] || {};
        if (dedupe.at && now() - dedupe.at < 5000) return { ok: true, deduped: true };
        fresh.checkDedupe[key] = { at: now() };
        const invalid = code === 'invalid_selector' || code === 'invalid_regex';
        const result = invalid ? 'FAIL' : 'WARN';
        await appendEvent(fresh.sessionId, {
          eventType: scope === 'dom' ? 'dom_check' : 'text_check',
          checkName: scope === 'dom' ? 'DOM element' : 'Text condition',
          result,
          severity: core.severityForResult(result),
          url: fresh.currentUrl,
          actualValue: 'Monitoring failed',
          reason,
          description: (scope === 'dom' ? 'DOM element' : 'Text condition') + ' — ' + result + ' — ' + reason,
          details: { code, scope }
        });
        fresh.lastResult = result;
        fresh.lastCheck = { type: scope, result, description: reason, at: core.nowIso(now()) };
        fresh.lastCheckAt = now();
        if (result === 'FAIL') {
          fresh.failureCount = (fresh.failureCount || 0) + 1;
          if (fresh.config.notifyOnFailure) await maybeNotify(fresh, scope + '-monitor-error', reason);
          if (fresh.config.stopOnFailure) {
            await stopSessionLocked(tabId, { reason: 'failure_condition' });
          }
        }
        await saveRuntime();
        return { ok: true };
      });
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    async function getState(tabId, options) {
      await ensureReady();
      const id = Number(tabId);
      const runtime = Number.isInteger(id) ? state.runtime.get(String(id)) : null;
      if (runtime) {
        if (options && options.light) {
          return { ok: true, state: publicState(runtime), settings: state.settings, session: state.sessions[runtime.sessionId] || null };
        }
        const events = await getEvents(runtime.sessionId);
        const session = state.sessions[runtime.sessionId] || null;
        return {
          ok: true,
          state: publicState(runtime),
          session,
          events,
          stats: core.computeStats(events, session, now()),
          settings: state.settings,
          storageWarning: state.storageWarning
        };
      }
      const latest = Number.isInteger(id) ? latestSessionForTab(id) : null;
      if (!latest) return { ok: true, state: null, session: null, stats: null, settings: state.settings };
      const events = options && options.light ? [] : await getEvents(latest.id);
      return {
        ok: true,
        state: null,
        session: latest,
        events,
        stats: core.computeStats(events, latest, now()),
        settings: state.settings,
        storageWarning: state.storageWarning
      };
    }

    async function getSessionData(sessionId, tabId) {
      await ensureReady();
      let session = sessionId ? state.sessions[sessionId] : null;
      if (!session && tabId !== undefined && tabId !== null) {
        const runtime = state.runtime.get(String(tabId));
        session = runtime ? state.sessions[runtime.sessionId] : latestSessionForTab(Number(tabId));
      }
      if (!session) {
        const runtime = state.runtime.get(String(tabId));
        if (runtime) session = state.sessions[runtime.sessionId];
      }
      if (!session) return { ok: false, error: 'Session not found.' };
      const events = await getEvents(session.id);
      return {
        ok: true,
        session,
        events,
        stats: core.computeStats(events, session, now()),
        settings: state.settings,
        storageWarning: state.storageWarning
      };
    }

    async function getSessions() {
      await ensureReady();
      const sessions = Object.values(state.sessions)
        .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
        .map((session) => ({ ...session, active: session.status === 'active' }));
      return {
        ok: true,
        sessions,
        activeTabIds: [...state.runtime.values()].map((runtime) => runtime.tabId),
        storageWarning: state.storageWarning
      };
    }

    async function deleteSession(sessionId) {
      await ensureReady();
      const session = state.sessions[sessionId];
      if (!session) return { ok: false, error: 'Session not found.' };
      if (session.status === 'active') return { ok: false, error: 'Stop the session before deleting it.' };
      delete state.sessions[sessionId];
      await saveSessions();
      try { await localRemove(eventsKey(sessionId)); } catch (_) { /* ignore */ }
      if (screenshots) { try { await screenshots.deleteBySession(sessionId); } catch (_) { /* ignore */ } }
      return { ok: true };
    }

    async function clearHistory() {
      await ensureReady();
      const completed = Object.values(state.sessions).filter((session) => session.status !== 'active');
      for (const session of completed) {
        delete state.sessions[session.id];
        try { await localRemove(eventsKey(session.id)); } catch (_) { /* ignore */ }
        // Clear-history intentionally preserves screenshots. They are removed
        // only by the separate "Clear stored screenshots" action or by pruning.
      }
      await saveSessions();
      return { ok: true, removed: completed.length };
    }

    async function getPresets() {
      await ensureReady();
      return { ok: true, presets: state.presets, builtins: core.BUILTIN_PRESETS };
    }

    async function savePreset(input) {
      await ensureReady();
      const existingNames = state.presets
        .filter((preset) => !input || preset.id !== input.id)
        .map((preset) => preset.name);
      const check = core.validatePreset(input, { existingNames });
      if (!check.ok) return { ok: false, error: check.errors.join(' '), errors: check.errors };
      const incoming = check.preset;
      const existing = input && input.id ? state.presets.find((preset) => preset.id === input.id) : null;
      if (existing) {
        incoming.id = existing.id;
        incoming.createdAt = existing.createdAt;
      }
      if (!existing && state.presets.length >= core.LIMITS.maxPresets) {
        return { ok: false, error: 'Preset limit reached (maximum 50). Delete a preset first.' };
      }
      state.presets = existing
        ? state.presets.map((preset) => preset.id === existing.id ? incoming : preset)
        : [...state.presets, incoming];
      await localSet({ [KEYS.presets]: state.presets });
      return { ok: true, preset: incoming, presets: state.presets };
    }

    async function deletePreset(id) {
      await ensureReady();
      state.presets = state.presets.filter((preset) => preset.id !== id);
      await localSet({ [KEYS.presets]: state.presets });
      return { ok: true, presets: state.presets };
    }

    async function importPresets(jsonText) {
      await ensureReady();
      const parsed = core.parsePresetImport(jsonText);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const imported = [];
      const errors = [];
      let names = state.presets.map((preset) => preset.name);
      for (const candidate of parsed.candidates) {
        if (state.presets.length + imported.length >= core.LIMITS.maxPresets) {
          errors.push('Preset limit reached; remaining presets were skipped.');
          break;
        }
        const check = core.validatePreset(candidate, { existingNames: names });
        if (!check.ok) {
          errors.push((candidate && candidate.name ? candidate.name + ': ' : '') + check.errors.join(' '));
          continue;
        }
        imported.push(check.preset);
        names.push(check.preset.name);
      }
      if (!imported.length) {
        return { ok: false, error: errors.length ? errors.join(' ') : 'No valid presets were found.', errors };
      }
      state.presets = [...state.presets, ...imported];
      await localSet({ [KEYS.presets]: state.presets });
      return { ok: true, imported: imported.length, presets: state.presets, errors };
    }

    async function getSettings() {
      await ensureReady();
      return { ok: true, settings: state.settings };
    }

    async function saveSettings(patch) {
      await ensureReady();
      state.settings = core.normalizeSettings({ ...state.settings, ...(patch || {}) });
      await localSet({ [KEYS.settings]: state.settings });
      for (const [tabId, runtime] of state.runtime.entries()) {
        await updateBadge(Number(tabId), runtime);
        try {
          await chromeApi.tabs.sendMessage(Number(tabId), { type: 'SYNC_CONTENT_REFRESH' });
        } catch (_) { /* page may not have a content script */ }
      }
      return { ok: true, settings: state.settings };
    }

    async function getDiagnostics() {
      await ensureReady();
      let bytes = null;
      try {
        if (chromeApi.storage.local.getBytesInUse) {
          bytes = await chromeApi.storage.local.getBytesInUse(null);
        }
      } catch (_) { /* ignore */ }
      let screenshotUsage = null;
      if (screenshots) {
        try { screenshotUsage = await screenshots.usage(); } catch (_) { /* ignore */ }
      }
      return {
        ok: true,
        version: core.VERSION,
        storageBytes: bytes,
        storageWarning: state.storageWarning,
        activeSessions: state.runtime.size,
        sessions: Object.keys(state.sessions).length,
        screenshotUsage,
        settings: state.settings
      };
    }

    // -----------------------------------------------------------------------
    // Lifecycle hooks
    // -----------------------------------------------------------------------

    async function handleStartup() {
      await ensureReady();
      // chrome.storage.session is cleared on browser restart. Any session still
      // marked active without runtime state is finalized by reconcileOrphans().
      const local = await localGet(KEYS.legacyRuntime);
      if (local[KEYS.legacyRuntime]) {
        await localRemove(KEYS.legacyRuntime);
      }
      await ensureWatchdog();
      return { ok: true };
    }

    async function handleInstalled(details) {
      await ensureReady();
      if (details && (details.reason === 'update' || details.reason === 'install')) {
        await stopAllSessions('extension_updated');
        try { await localRemove(KEYS.legacyRuntime); } catch (_) { /* ignore */ }
      }
      if (!details || details.reason === 'install') {
        await localSet({ [KEYS.settings]: state.settings });
      }
      return { ok: true };
    }

    async function handleSuspend() {
      await saveRuntime();
    }

    // -----------------------------------------------------------------------
    // Floating QA panel data (UI only; no second monitoring engine)
    // -----------------------------------------------------------------------

    function normalizePanelPrefs(raw) {
      const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const output = {};
      const entries = [];
      for (const [origin, value] of Object.entries(source)) {
        if (!/^https?:\/\/[^/]+$/i.test(origin) || !value || typeof value !== 'object') continue;
        const x = Number(value.position && value.position.x);
        const y = Number(value.position && value.position.y);
        const position = Number.isFinite(x) && Number.isFinite(y)
          ? { x: Math.round(core.clamp(x, 0, 100000)), y: Math.round(core.clamp(y, 0, 100000)) }
          : null;
        const entry = {
          position,
          collapsed: Boolean(value.collapsed),
          updatedAt: core.isoOrNow(value.updatedAt)
        };
        output[origin] = entry;
        entries.push([origin, entry]);
      }
      if (entries.length > 50) {
        entries.sort((a, b) => String(a[1].updatedAt).localeCompare(String(b[1].updatedAt)));
        for (const [origin] of entries.slice(0, entries.length - 50)) delete output[origin];
      }
      return output;
    }

    function senderOrigin(sender, session) {
      const raw = (sender && sender.url) || (sender && sender.tab && sender.tab.url) || (session && session.url) || '';
      try {
        const url = new URL(raw);
        return /^https?:$/.test(url.protocol) ? url.origin : null;
      } catch (_) {
        return null;
      }
    }

    async function savePanelPrefs(sender, message) {
      await ensureReady();
      const tabId = sender && sender.tab ? Number(sender.tab.id) : NaN;
      const runtime = Number.isInteger(tabId) ? state.runtime.get(String(tabId)) : null;
      const session = runtime ? state.sessions[runtime.sessionId] : (Number.isInteger(tabId) ? latestSessionForTab(tabId) : null);
      const origin = senderOrigin(sender, session);
      if (!origin) return { ok: false, error: 'Panel preferences need an HTTP/HTTPS page origin.' };
      const existing = state.panelPrefs[origin] || {};
      const x = Number(message && message.position && message.position.x);
      const y = Number(message && message.position && message.position.y);
      const position = Number.isFinite(x) && Number.isFinite(y)
        ? { x: Math.round(core.clamp(x, 0, 100000)), y: Math.round(core.clamp(y, 0, 100000)) }
        : existing.position || null;
      state.panelPrefs[origin] = {
        position,
        collapsed: message && message.collapsed !== undefined ? Boolean(message.collapsed) : Boolean(existing.collapsed),
        updatedAt: core.nowIso(now())
      };
      const entries = Object.entries(state.panelPrefs);
      if (entries.length > 50) {
        entries.sort((a, b) => String(a[1].updatedAt).localeCompare(String(b[1].updatedAt)));
        for (const [key] of entries.slice(0, entries.length - 50)) delete state.panelPrefs[key];
      }
      await localSet({ [KEYS.panelPrefs]: state.panelPrefs });
      return { ok: true, prefs: state.panelPrefs[origin] };
    }

    async function getPanelData(sender) {
      await ensureReady();
      const tabId = sender && sender.tab ? Number(sender.tab.id) : NaN;
      if (!Number.isInteger(tabId)) return { ok: true, panel: null };
      const runtime = state.runtime.get(String(tabId));
      const session = runtime ? state.sessions[runtime.sessionId] : latestSessionForTab(tabId);
      if (!session || session.mode === 'refresh') return { ok: true, panel: null };
      const events = await getEvents(session.id);
      const stats = core.computeStats(events, session, now());
      const lastLoad = [...events].reverse().find((event) => event.eventType === 'page_load' && event.loadDurationMs !== null) || null;
      const origin = senderOrigin(sender, session);
      const prefs = origin ? state.panelPrefs[origin] || null : null;
      return {
        ok: true,
        panel: {
          sessionId: session.id,
          mode: session.mode,
          active: session.status === 'active',
          status: session.status,
          phase: runtime ? runtime.phase : null,
          url: (runtime && runtime.currentUrl) || session.url,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          stopReason: session.stopReason,
          counts: {
            pass: stats.passed,
            fail: stats.failed,
            warn: stats.warnings,
            unknown: stats.unknown,
            info: stats.info,
            total: stats.totalChecks
          },
          latest: stats.lastEvent ? {
            timestamp: stats.lastEvent.timestamp,
            result: stats.lastEvent.result,
            description: stats.lastEvent.description
          } : null,
          loadDurationMs: lastLoad ? lastLoad.loadDurationMs : null,
          loadResult: lastLoad ? lastLoad.result : null,
          avgLoadDurationMs: stats.avgLoadDurationMs,
          durationMs: stats.sessionDurationMs,
          eventCount: stats.totalEvents
        },
        prefs,
        settings: state.settings
      };
    }

    async function openDashboardFromPanel(sender) {
      await ensureReady();
      const tabId = sender && sender.tab ? Number(sender.tab.id) : NaN;
      const runtime = Number.isInteger(tabId) ? state.runtime.get(String(tabId)) : null;
      const sessionId = runtime ? runtime.sessionId : null;
      const url = chromeApi.runtime.getURL('dashboard.html' + (sessionId ? '?session=' + encodeURIComponent(sessionId) : ''));
      await chromeApi.tabs.create({ url });
      return { ok: true };
    }

    async function stopFromPanel(sender) {
      const tabId = sender && sender.tab ? Number(sender.tab.id) : NaN;
      if (!Number.isInteger(tabId)) return { ok: false, error: 'Panel stop needs a tab.' };
      return stopSession(tabId, { reason: 'user' });
    }

    // -----------------------------------------------------------------------
    // Message dispatch
    // -----------------------------------------------------------------------

    const CONTENT_TYPES = new Set([
      'CONTENT_READY', 'GET_STATE', 'CONTENT_CHECK', 'MONITOR_BASELINE', 'CHECK_RESULT',
      'LOAD_TIMING', 'CONTENT_ERROR', 'REFRESH_DUE', 'BADGE_TICK', 'TEXT_WATCH_BASELINE',
      'TEXT_WATCH_RESULT', 'SEARCH_RESULT', 'GET_PANEL_DATA', 'SAVE_PANEL_PREFS',
      'PANEL_STOP_SESSION', 'OPEN_DASHBOARD'
    ]);

    async function handleMessage(message, sender) {
      const type = message && typeof message.type === 'string' ? message.type : '';
      const isContentSender = Boolean(
        sender && sender.tab && sender.url && !String(sender.url).startsWith('chrome-extension://')
      );
      if (!type) return { ok: false, error: 'Unknown request.' };
      if (isContentSender && !CONTENT_TYPES.has(type)) {
        return { ok: false, error: 'This request is not allowed from a content script.' };
      }
      switch (type) {
        case 'START_SESSION': {
          const tabId = Number(message.tabId);
          return startSession({ ...message, tabId });
        }
        case 'STOP_SESSION':
          return stopSession(Number(message.tabId), { reason: message.reason || 'user' });
        case 'STOP_ALL_SESSIONS':
          return stopAllSessions(message.reason || 'user');
        case 'GET_STATE':
          return getState(Number(message.tabId), { light: Boolean(message.light) });
        case 'CONTENT_READY':
          return handleContentReady(sender, message);
        case 'CONTENT_CHECK':
          return handleContentReady(sender, message);
        case 'MONITOR_BASELINE':
        case 'TEXT_WATCH_BASELINE':
          return handleBaseline(sender, message);
        case 'CHECK_RESULT':
        case 'TEXT_WATCH_RESULT':
        case 'SEARCH_RESULT':
          if (type !== 'CHECK_RESULT') {
            return handleCheckResults(sender, {
              checks: [{
                type: 'text',
                result: message.matched === false ? 'FAIL' : 'PASS',
                matched: Boolean(message.matched),
                expected: null,
                actual: message.matched ? 'Condition matched' : 'Condition not matched',
                reason: message.matched ? 'Text condition satisfied.' : 'Text condition not satisfied.',
                description: 'Text condition — ' + (message.matched ? 'PASS' : 'FAIL'),
                url: sender && sender.tab ? sender.tab.url : null,
                details: { condition: message.condition || null, textLength: Number(message.textLength) || null }
              }]
            });
          }
          return handleCheckResults(sender, message);
        case 'LOAD_TIMING':
          return handleLoadTiming(sender, message);
        case 'CONTENT_ERROR':
          return handleContentError(sender, message);
        case 'REFRESH_DUE':
          return handleRefreshDue(sender && sender.tab ? sender.tab.id : message.tabId);
        case 'BADGE_TICK': {
          await ensureReady();
          const tabId = sender && sender.tab ? Number(sender.tab.id) : Number(message.tabId);
          const runtime = state.runtime.get(String(tabId));
          if (runtime) await updateBadge(tabId, runtime);
          return { ok: true };
        }
        case 'GET_SESSION_DATA':
          return getSessionData(message.sessionId || null, message.tabId);
        case 'GET_SESSIONS':
          return getSessions();
        case 'DELETE_SESSION':
          return deleteSession(message.sessionId);
        case 'CLEAR_HISTORY':
          return clearHistory();
        case 'GET_QA_LOGS': {
          const data = await getSessionData(message.sessionId || null, message.tabId);
          if (!data.ok) return { ok: false, error: data.error };
          return {
            ok: true,
            logs: data.events.map((event) => ({
              time: event.timestamp,
              event: event.description,
              type: event.eventType,
              result: event.result,
              url: event.url,
              reason: event.reason,
              ...(event.details || {})
            }))
          };
        }
        case 'CLEAR_QA_LOGS': {
          await ensureReady();
          const session = message.sessionId
            ? state.sessions[message.sessionId]
            : latestSessionForTab(Number(message.tabId));
          if (!session) return { ok: true };
          if (session.status === 'active') {
            return { ok: false, error: 'Stop the session before clearing its events.' };
          }
          await localSet({ [eventsKey(session.id)]: [] });
          session.eventCount = 0;
          await saveSessions();
          return { ok: true };
        }
        case 'GET_PANEL_DATA':
          return getPanelData(sender);
        case 'SAVE_PANEL_PREFS':
          return savePanelPrefs(sender, message);
        case 'PANEL_STOP_SESSION':
          return stopFromPanel(sender);
        case 'OPEN_DASHBOARD':
          return openDashboardFromPanel(sender);
        case 'GET_PRESETS':
          return getPresets();
        case 'SAVE_PRESET':
          return savePreset(message.preset);
        case 'DELETE_PRESET':
          return deletePreset(message.id);
        case 'IMPORT_PRESETS':
          return importPresets(message.json);
        case 'GET_SETTINGS':
          return getSettings();
        case 'SAVE_SETTINGS':
          return saveSettings(message.settings);
        case 'GET_DIAGNOSTICS':
          return getDiagnostics();
        case 'START_REFRESH': {
          // v2.3 compatibility: map the legacy popup request to a v3 session.
          const config = core.configFromLegacy({
            intervalSeconds: message.intervalSeconds,
            mode: message.mode === 'cycles' ? 'cycles' : 'continuous',
            reloadsPerCycle: message.reloadsPerCycle,
            pauseSeconds: message.pauseSeconds,
            searchText: message.searchText,
            searchCondition: message.searchCondition,
            notifyOnMatch: message.notifyOnMatch,
            stopOnMatch: message.stopOnMatch
          });
          const legacyInterval = core.validateIntervalSeconds(message.intervalSeconds);
          if (!legacyInterval.ok) return { ok: false, error: legacyInterval.error };
          config.intervalSeconds = legacyInterval.value;
          if (config.cycleMode === 'cycles') {
            const cycleCheck = core.validateCycleSettings(message.reloadsPerCycle, message.pauseSeconds);
            if (!cycleCheck.ok) return { ok: false, error: cycleCheck.error };
            config.reloadsPerCycle = cycleCheck.value.reloadsPerCycle;
            config.pauseSeconds = cycleCheck.value.pauseSeconds;
          }
          const result = await startSession({ tabId: message.tabId, config });
          return result.ok ? { ok: true, state: result.state } : result;
        }
        case 'STOP_REFRESH':
          return stopSession(Number(message.tabId), { reason: 'user' });
        default:
          return { ok: false, error: 'Unknown request.' };
      }
    }

    // -----------------------------------------------------------------------
    // Public engine API
    // -----------------------------------------------------------------------

    return {
      handleMessage,
      startSession,
      stopSession,
      stopAllSessions,
      getState,
      getSessionData,
      getSessions,
      deleteSession,
      clearHistory,
      getPresets,
      savePreset,
      deletePreset,
      importPresets,
      getSettings,
      saveSettings,
      getDiagnostics,
      handleBeforeNavigate,
      handleBeforeRedirect,
      handleCompleted,
      handleErrorOccurred,
      handleTabRemoved,
      handleTabReplaced,
      handleTabUpdated,
      handleRefreshDue,
      handleWatchdog,
      handleStartup,
      handleInstalled,
      handleSuspend,
      ensureReady,
      saveRuntime,
      // Test/diagnostic accessors (not exposed as messages).
      _state: state
    };
  }

  root.OdesEngine = { createEngine, KEYS, eventsKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.OdesEngine;
})(typeof self !== 'undefined' ? self : globalThis);
