/*
 * Odesoftami QA Monitor — shared core (v3.1.0)
 *
 * Pure, dependency-free helpers shared by the service worker, extension
 * pages and the automated tests. This file performs no DOM access and makes
 * no network requests. It attaches itself to `globalThis.OdesCore`.
 */
(function (root) {
  'use strict';

  const PRODUCT = 'Odesoftami QA Monitor';
  const SHORT_NAME = 'QA Monitor';
  const TAGLINE = 'Browser QA & Monitoring Tool';
  const AUTHOR = 'Denys Oleksiienko';
  const COPYRIGHT_YEAR = 2026;
  const VERSION = '3.2.0';
  const SCHEMA_VERSION = 1;
  const WEBSITE = 'https://odesoftami.com/apk/';
  // Public links supplied by the project owner (2026-10-17 review).
  const GITHUB_URL = 'https://github.com/odesoftami';
  const WEBSITE_URL = 'https://odesoftami.com/apk';

  const MODES = ['refresh', 'monitor', 'qa'];
  const PANEL_POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
  const MODE_LABELS = { refresh: 'Refresh', monitor: 'Monitor', qa: 'QA Session' };
  const RESULTS = ['PASS', 'FAIL', 'WARN', 'UNKNOWN', 'INFO'];
  const RESULT_SEVERITY = { PASS: 'info', FAIL: 'error', WARN: 'warning', UNKNOWN: 'info', INFO: 'info' };
  const TEXT_CONDITIONS = ['appears', 'absent', 'disappears', 'changes'];
  const DOM_CONDITIONS = ['appears', 'disappears', 'textChanges'];
  const LEGACY_TEXT_CONDITIONS = { found: 'appears', notFound: 'absent', disappears: 'disappears', changes: 'changes' };

  const CHECK_EVENT_TYPES = [
    'http_status',
    'navigation',
    'redirect',
    'navigation_error',
    'page_load',
    'text_check',
    'dom_check',
    'url_check'
  ];
  const EVENT_TYPES = CHECK_EVENT_TYPES.concat([
    'session_start',
    'session_stop',
    'session_resumed',
    'baseline',
    'reload_requested',
    'reload_failed',
    'screenshot',
    'screenshot_skipped',
    'config',
    'legacy_event'
  ]);

  const LIMITS = {
    minIntervalSeconds: 2,
    maxIntervalSeconds: 86400,
    maxReloadsPerCycle: 1000,
    maxPauseSeconds: 86400,
    maxPatternLength: 300,
    maxSelectorLength: 300,
    maxUrlLength: 2048,
    maxExpectedTextLength: 500,
    maxPresetNameLength: 60,
    maxPresetDescriptionLength: 200,
    maxPresetFileBytes: 256 * 1024,
    maxEventsPerSession: 2000,
    defaultEventsPerSession: 500,
    minEventsPerSession: 50,
    maxSessions: 30,
    maxPresets: 50,
    maxScreenshotsPerSession: 3,
    maxScreenshotDataUrlBytes: 2.5 * 1024 * 1024,
    maxScreenshotEntries: 20,
    screenshotThrottleMs: 10000,
    minSettleMs: 100,
    maxSettleMs: 5000,
    defaultSettleMs: 800,
    minBudgetMs: 0,
    maxBudgetMs: 60000,
    maxDescriptionLength: 500,
    maxDetailsJsonLength: 2000
  };

  const DEFAULT_SETTINGS = Object.freeze({
    bypassCache: false,
    showCountdown: true,
    defaultMode: 'refresh',
    screenshotOnFailure: false,
    notifyOnFailure: true,
    settleMs: LIMITS.defaultSettleMs,
    historyLimit: LIMITS.defaultEventsPerSession,
    floatingPanelEnabled: true,
    floatingPanelDefaultPosition: 'bottom-right',
    floatingPanelDefaultCollapsed: false,
    floatingPanelRetainSummary: true
  });

  const STOP_REASONS = Object.freeze({
    user: 'Stopped by user',
    tab_closed: 'Tab closed',
    tab_unavailable: 'Tab is no longer an HTTP/HTTPS page',
    failure_condition: 'Failure condition met',
    condition_met: 'Text condition met',
    reload_failed: 'Repeated reload failures',
    navigation_error: 'Navigation failed',
    browser_restart: 'Browser restarted',
    extension_updated: 'Extension updated',
    service_worker_reset: 'Monitoring state was lost',
    session_timeout: 'Session timeout',
    internal_error: 'Internal extension error'
  });

  const LIMITATIONS = Object.freeze([
    'Cross-origin iframe content and closed shadow DOM cannot be inspected by a content script.',
    'HTTP status, redirects and navigation failures are only recorded for main-frame navigations observed while a session is active. A page loaded before the session started reports UNKNOWN, never a fabricated 200. If Chrome does not expose a status (for example cached, browser-generated or some client-side navigations), the result is UNKNOWN.',
    'Page load metrics come from the Navigation Timing API and describe navigation/DOMContentLoaded/load milestones, not server response time or TTFB.',
    'Screenshots are opt-in, capture only the visible viewport of the active, focused tab, are stored locally in IndexedDB and are never uploaded. Reports do not embed screenshot images; they are available separately in the dashboard.',
    'Chrome may throttle timers in background tabs and suspend the service worker. Timers and chrome.alarms are used together, but intervals are targets rather than hard real-time guarantees.',
    'Text checks read visible document text. The extension does not store full page contents in its event log.',
    'URL checks observe the top-level document URL; hash changes are ignored by default and can be included by disabling "Ignore URL hash".',
    'Server redirects are reported from webRequest.onBeforeRedirect with the exposed status when available. Client-side redirects (JavaScript/meta refresh) have no redirect status in Chrome; they are only detected as URL changes when URL checking is enabled.'
  ]);

  // ---------------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------------

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toInteger(value, fallback = null) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.trunc(number);
  }

  function toNullableString(value, maxLength = 500) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!text) return null;
    return text.length > maxLength ? text.slice(0, maxLength) : text;
  }

  function toNullableNumber(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return clamp(number, min, max);
  }

  function toNullableHttpStatus(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 100 || number > 599) return null;
    return number;
  }

  function uuid() {
    try {
      if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch (_) { /* ignore */ }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function nowIso(now) {
    return new Date(typeof now === 'number' ? now : Date.now()).toISOString();
  }

  function isoOrNow(value) {
    if (typeof value === 'string') {
      const time = Date.parse(value);
      if (Number.isFinite(time)) return new Date(time).toISOString();
    }
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    return nowIso();
  }

  function stripControlCharacters(value) {
    return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').trim();
  }

  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    if (hours) return hours + 'h ' + minutes + 'm ' + rest + 's';
    if (minutes) return minutes + 'm ' + rest + 's';
    return rest + 's';
  }

  function formatSessionDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    return formatDuration(ms / 1000);
  }

  function formatMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s';
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatPercent(part, total) {
    if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return '—';
    return Math.round((part / total) * 1000) / 10 + '%';
  }

  function formatLocalDateTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-GB', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  }

  function formatLocalTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function modeLabel(mode) {
    return MODE_LABELS[mode] || 'Refresh';
  }

  function stopReasonLabel(reason) {
    return STOP_REASONS[reason] || toNullableString(reason, 200) || 'Stopped';
  }

  function severityForResult(result) {
    return RESULT_SEVERITY[result] || 'info';
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  function validateIntervalSeconds(value) {
    const number = Number(value);
    if (!Number.isInteger(number)) return { ok: false, error: 'Refresh interval must be a whole number of seconds.' };
    if (number < LIMITS.minIntervalSeconds) return { ok: false, error: 'Refresh interval must be at least 2 seconds.' };
    if (number > LIMITS.maxIntervalSeconds) return { ok: false, error: 'Refresh interval cannot exceed 24 hours (86,400 seconds).' };
    return { ok: true, value: number };
  }

  function validateCycleSettings(reloadsPerCycle, pauseSeconds) {
    const reloads = Number(reloadsPerCycle);
    const pause = Number(pauseSeconds);
    if (!Number.isInteger(reloads) || reloads < 1 || reloads > LIMITS.maxReloadsPerCycle) {
      return { ok: false, error: 'Reloads per cycle must be a whole number between 1 and 1,000.' };
    }
    if (!Number.isInteger(pause) || pause < 1 || pause > LIMITS.maxPauseSeconds) {
      return { ok: false, error: 'Pause between cycles must be a whole number between 1 and 86,400 seconds.' };
    }
    return { ok: true, value: { reloadsPerCycle: reloads, pauseSeconds: pause } };
  }

  function validateRegexPattern(pattern) {
    const text = toNullableString(pattern, LIMITS.maxPatternLength + 1);
    if (!text) return { ok: false, error: 'Enter a regular expression.' };
    if (text.length > LIMITS.maxPatternLength) return { ok: false, error: 'The regular expression is too long (maximum 300 characters).' };
    try {
      // Only the case-insensitive flag is used; user-supplied flags are impossible by design.
      new RegExp(text, 'i');
      return { ok: true, value: text };
    } catch (error) {
      return { ok: false, error: 'Invalid regular expression: ' + (error && error.message ? error.message : 'syntax error') };
    }
  }

  function validateUrl(value, { required = false } = {}) {
    const text = toNullableString(value, LIMITS.maxUrlLength);
    if (!text) {
      return required ? { ok: false, error: 'Enter an expected URL (http:// or https://).' } : { ok: true, value: '' };
    }
    try {
      const url = new URL(text);
      if (!/^https?:$/.test(url.protocol)) return { ok: false, error: 'Only HTTP and HTTPS URLs are supported.' };
      return { ok: true, value: url.href };
    } catch (_) {
      return { ok: false, error: 'Enter a valid absolute URL (http:// or https://).' };
    }
  }

  function validateSelectorShape(selector) {
    const text = toNullableString(selector, LIMITS.maxSelectorLength + 1);
    if (!text) return { ok: false, error: 'Enter a CSS selector.' };
    if (text.length > LIMITS.maxSelectorLength) return { ok: false, error: 'The CSS selector is too long (maximum 300 characters).' };
    if (/[\u0000-\u001F\u007F]/.test(text)) return { ok: false, error: 'The CSS selector contains control characters.' };
    return { ok: true, value: text };
  }

  function validateSelectorWithDom(documentRef, selector) {
    const shape = validateSelectorShape(selector);
    if (!shape.ok) return shape;
    if (!documentRef || typeof documentRef.querySelector !== 'function') {
      return { ok: false, error: 'CSS selectors can only be validated on a page document.' };
    }
    try {
      documentRef.querySelector(shape.value);
      return { ok: true, value: shape.value };
    } catch (error) {
      return { ok: false, error: 'Invalid CSS selector: ' + (error && error.message ? error.message : 'syntax error') };
    }
  }

  function normalizeTextCondition(value, fallback = 'appears') {
    const mapped = LEGACY_TEXT_CONDITIONS[value] || value;
    return TEXT_CONDITIONS.includes(mapped) ? mapped : fallback;
  }

  function normalizeDomCondition(value, fallback = 'appears') {
    return DOM_CONDITIONS.includes(value) ? value : fallback;
  }

  function normalizeMode(value, fallback = 'refresh') {
    return MODES.includes(value) ? value : fallback;
  }

  function defaultConfig(mode = 'refresh') {
    return {
      mode: normalizeMode(mode),
      intervalSeconds: 10,
      cycleMode: 'continuous',
      reloadsPerCycle: 5,
      pauseSeconds: 10,
      autoRefresh: normalizeMode(mode) !== 'monitor',
      bypassCache: false,
      text: { enabled: false, condition: 'appears', pattern: '', regex: false },
      dom: { enabled: false, selector: '', condition: 'appears', expectedText: '' },
      url: { enabled: normalizeMode(mode) !== 'refresh', expectedUrl: '', ignoreHash: true },
      http: { enabled: true },
      timing: { enabled: true, budgetMs: 5000 },
      settleMs: LIMITS.defaultSettleMs,
      notifyOnMatch: true,
      notifyOnFailure: true,
      stopOnMatch: normalizeMode(mode) === 'refresh',
      stopOnFailure: false,
      screenshotOnFailure: false
    };
  }

  /**
   * Normalizes untrusted input into a bounded config object. Invalid values
   * fall back to safe defaults; use validateConfig() when errors must be shown.
   */
  function normalizeConfig(raw) {
    const input = isPlainObject(raw) ? raw : {};
    const mode = normalizeMode(input.mode);
    const config = defaultConfig(mode);
    const interval = validateIntervalSeconds(input.intervalSeconds);
    if (interval.ok) config.intervalSeconds = interval.value;
    config.cycleMode = input.cycleMode === 'cycles' ? 'cycles' : 'continuous';
    const cycles = validateCycleSettings(input.reloadsPerCycle, input.pauseSeconds);
    if (cycles.ok) {
      config.reloadsPerCycle = cycles.value.reloadsPerCycle;
      config.pauseSeconds = cycles.value.pauseSeconds;
    }
    config.autoRefresh = mode === 'refresh' ? true : mode === 'monitor' ? false : input.autoRefresh !== false;
    config.bypassCache = Boolean(input.bypassCache);

    const text = isPlainObject(input.text) ? input.text : {};
    config.text.condition = normalizeTextCondition(text.condition);
    config.text.pattern = stripControlCharacters(toNullableString(text.pattern, LIMITS.maxPatternLength) || '');
    config.text.regex = Boolean(text.regex);
    config.text.enabled = mode === 'refresh'
      ? Boolean(config.text.pattern)
      : Boolean(text.enabled) && Boolean(config.text.pattern);

    const dom = isPlainObject(input.dom) ? input.dom : {};
    config.dom.selector = stripControlCharacters(toNullableString(dom.selector, LIMITS.maxSelectorLength) || '');
    config.dom.condition = normalizeDomCondition(dom.condition);
    config.dom.expectedText = stripControlCharacters(toNullableString(dom.expectedText, LIMITS.maxExpectedTextLength) || '');
    config.dom.enabled = mode !== 'refresh' && Boolean(dom.enabled) && Boolean(config.dom.selector);

    const url = isPlainObject(input.url) ? input.url : {};
    const expected = validateUrl(url.expectedUrl);
    config.url.expectedUrl = expected.ok ? expected.value : '';
    config.url.ignoreHash = url.ignoreHash !== false;
    config.url.enabled = mode !== 'refresh' && (isPlainObject(input.url) ? url.enabled !== false : true);

    config.http.enabled = mode === 'refresh' ? true : Boolean(isPlainObject(input.http) ? input.http.enabled !== false : true);
    const timing = isPlainObject(input.timing) ? input.timing : {};
    config.timing.enabled = mode === 'refresh' ? true : timing.enabled !== false;
    config.timing.budgetMs = clamp(toInteger(timing.budgetMs, 5000), LIMITS.minBudgetMs, LIMITS.maxBudgetMs);

    config.settleMs = clamp(toInteger(input.settleMs, LIMITS.defaultSettleMs), LIMITS.minSettleMs, LIMITS.maxSettleMs);
    config.notifyOnMatch = input.notifyOnMatch !== false;
    config.notifyOnFailure = input.notifyOnFailure !== false;
    config.stopOnMatch = input.stopOnMatch === undefined ? mode === 'refresh' : input.stopOnMatch !== false;
    config.stopOnFailure = Boolean(input.stopOnFailure);
    config.screenshotOnFailure = Boolean(input.screenshotOnFailure);
    return config;
  }

  /**
   * Strict validation used for session start, presets and imports.
   * Returns { ok, config, errors }.
   */
  function validateConfig(raw, { selectorValidator = null } = {}) {
    const input = isPlainObject(raw) ? raw : {};
    const errors = [];
    if (!MODES.includes(input.mode)) errors.push('Choose a valid mode (Refresh, Monitor or QA Session).');
    const mode = normalizeMode(input.mode);
    const config = normalizeConfig({ ...input, mode });

    if (mode === 'refresh' || (mode === 'qa' && config.autoRefresh)) {
      const interval = validateIntervalSeconds(input.intervalSeconds);
      if (!interval.ok) errors.push(interval.error);
    }
    if (config.cycleMode === 'cycles') {
      const cycles = validateCycleSettings(input.reloadsPerCycle, input.pauseSeconds);
      if (!cycles.ok) errors.push(cycles.error);
    }
    if (config.text.enabled || (isPlainObject(input.text) && input.text.enabled)) {
      if (!config.text.pattern) errors.push('Enter the text or regular expression to watch.');
      if (config.text.regex && config.text.pattern) {
        const regex = validateRegexPattern(config.text.pattern);
        if (!regex.ok) errors.push(regex.error);
      }
    }
    if (isPlainObject(input.dom) && input.dom.enabled) {
      if (mode === 'refresh') {
        errors.push('DOM watchers are available in Monitor and QA Session modes.');
      } else if (!config.dom.selector) {
        errors.push('Enter a CSS selector for the DOM watcher.');
      } else {
        const selector = selectorValidator
          ? selectorValidator(config.dom.selector)
          : validateSelectorShape(config.dom.selector);
        if (!selector.ok) errors.push(selector.error);
      }
    }
    if (isPlainObject(input.url) && input.url.enabled && input.url.expectedUrl) {
      const expected = validateUrl(input.url.expectedUrl, { required: true });
      if (!expected.ok) errors.push(expected.error);
    }
    const settle = Number(input.settleMs);
    if (input.settleMs !== undefined && (!Number.isFinite(settle) || settle < LIMITS.minSettleMs || settle > LIMITS.maxSettleMs)) {
      errors.push('Stabilization period must be between 100 and 5,000 ms.');
    }
    const budget = Number(config.timing.budgetMs);
    if (input.timing && input.timing.budgetMs !== undefined && (!Number.isFinite(budget) || budget < 0 || budget > LIMITS.maxBudgetMs)) {
      errors.push('Load budget must be between 0 and 60,000 ms (0 disables the warning).');
    }
    return { ok: errors.length === 0, config, errors };
  }

  function normalizeSettings(raw) {
    const input = isPlainObject(raw) ? raw : {};
    const history = toInteger(input.historyLimit, LIMITS.defaultEventsPerSession);
    return {
      bypassCache: Boolean(input.bypassCache),
      showCountdown: input.showCountdown !== false,
      defaultMode: normalizeMode(input.defaultMode),
      screenshotOnFailure: Boolean(input.screenshotOnFailure),
      notifyOnFailure: input.notifyOnFailure !== false,
      settleMs: clamp(toInteger(input.settleMs, LIMITS.defaultSettleMs), LIMITS.minSettleMs, LIMITS.maxSettleMs),
      historyLimit: clamp(history, LIMITS.minEventsPerSession, LIMITS.maxEventsPerSession),
      floatingPanelEnabled: input.floatingPanelEnabled !== false,
      floatingPanelDefaultPosition: PANEL_POSITIONS.includes(input.floatingPanelDefaultPosition)
        ? input.floatingPanelDefaultPosition
        : 'bottom-right',
      floatingPanelDefaultCollapsed: Boolean(input.floatingPanelDefaultCollapsed),
      floatingPanelRetainSummary: input.floatingPanelRetainSummary !== false
    };
  }

  function configForMode(mode, base) {
    const config = normalizeConfig({ ...(base || {}), mode });
    if (mode === 'refresh') {
      config.autoRefresh = true;
      config.dom.enabled = false;
      config.url.enabled = false;
    } else if (mode === 'monitor') {
      config.autoRefresh = false;
    }
    return config;
  }

  function configFromLegacy(legacy) {
    const input = isPlainObject(legacy) ? legacy : {};
    return normalizeConfig({
      mode: 'refresh',
      intervalSeconds: input.intervalSeconds,
      cycleMode: input.mode === 'cycles' ? 'cycles' : 'continuous',
      reloadsPerCycle: input.reloadsPerCycle,
      pauseSeconds: input.pauseSeconds,
      text: {
        enabled: Boolean(input.searchText),
        condition: normalizeTextCondition(input.searchCondition, 'appears'),
        pattern: input.searchText || '',
        regex: false
      },
      notifyOnMatch: input.notifyOnMatch !== false,
      stopOnMatch: input.stopOnMatch !== false,
      settleMs: LIMITS.defaultSettleMs
    });
  }

  function describeConfig(config) {
    const rows = [];
    rows.push(['Mode', modeLabel(config.mode)]);
    if (config.mode === 'refresh' || (config.mode === 'qa' && config.autoRefresh)) {
      const schedule = config.cycleMode === 'cycles'
        ? 'Cycle refresh — ' + config.reloadsPerCycle + ' reload(s), then pause ' + formatDuration(config.pauseSeconds)
        : 'Continuous refresh';
      rows.push(['Refresh', schedule + ' · every ' + formatDuration(config.intervalSeconds)]);
    } else {
      rows.push(['Refresh', 'No automatic reloads']);
    }
    rows.push(['Bypass cache', config.bypassCache ? 'Yes' : 'No']);
    rows.push(['Text check', config.text.enabled
      ? textConditionLabel(config.text.condition) + ' — ' + (config.text.regex ? 'regex /' : '"') + config.text.pattern + (config.text.regex ? '/i' : '"')
      : 'Disabled']);
    rows.push(['DOM check', config.dom.enabled
      ? domConditionLabel(config.dom.condition) + ' — ' + config.dom.selector + (config.dom.expectedText ? ' · expected text: ' + config.dom.expectedText : '')
      : 'Disabled']);
    rows.push(['URL check', config.url.enabled
      ? (config.url.expectedUrl ? 'Expected: ' + config.url.expectedUrl : 'Expected: URL at session start') + (config.url.ignoreHash ? ' (hash ignored)' : '')
      : 'Disabled']);
    rows.push(['HTTP / navigation', config.http.enabled ? 'Recorded' : 'Disabled']);
    rows.push(['Load timing', config.timing.enabled
      ? 'Recorded · budget ' + (config.timing.budgetMs > 0 ? config.timing.budgetMs + ' ms' : 'disabled')
      : 'Disabled']);
    rows.push(['Stabilization', config.settleMs + ' ms']);
    rows.push(['Notifications', [config.notifyOnMatch ? 'condition matched' : null, config.notifyOnFailure ? 'failures' : null].filter(Boolean).join(', ') || 'Disabled']);
    rows.push(['Stop conditions', [config.stopOnMatch ? 'condition matched' : null, config.stopOnFailure ? 'failure' : null].filter(Boolean).join(', ') || 'None']);
    rows.push(['Screenshots on failure', config.screenshotOnFailure ? 'Yes (active visible tab only)' : 'No']);
    return rows;
  }

  function textConditionLabel(condition) {
    return {
      appears: 'Text appears',
      absent: 'Text is absent',
      disappears: 'Text disappears',
      changes: 'Text changes'
    }[condition] || 'Text appears';
  }

  function domConditionLabel(condition) {
    return {
      appears: 'Element appears',
      disappears: 'Element disappears',
      textChanges: 'Element text changes'
    }[condition] || 'Element appears';
  }

  // ---------------------------------------------------------------------------
  // Event model
  // ---------------------------------------------------------------------------

  function sanitizeDetails(value, depth = 0) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value.length > 500 ? value.slice(0, 500) : value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value;
    if (depth >= 3) return '[nested value omitted]';
    if (Array.isArray(value)) {
      return value.slice(0, 20).map((item) => sanitizeDetails(item, depth + 1));
    }
    if (isPlainObject(value)) {
      const output = {};
      let keys = 0;
      for (const key of Object.keys(value)) {
        if (keys >= 30) break;
        if (!/^[A-Za-z0-9_.-]{1,60}$/.test(key)) continue;
        output[key] = sanitizeDetails(value[key], depth + 1);
        keys += 1;
      }
      return output;
    }
    return null;
  }

  function trimDetails(details) {
    const safe = sanitizeDetails(details);
    if (!safe) return null;
    let json;
    try { json = JSON.stringify(safe); } catch (_) { return null; }
    if (json.length <= LIMITS.maxDetailsJsonLength) return safe;
    return { truncated: true, note: 'Details were too large and were shortened.' };
  }

  function createEvent(input) {
    const source = isPlainObject(input) ? input : {};
    const event = {
      id: toNullableString(source.id, 80) || uuid(),
      timestamp: isoOrNow(source.timestamp),
      sessionId: toNullableString(source.sessionId, 80),
      tabId: source.tabId === null || source.tabId === undefined || source.tabId === '' || !Number.isInteger(Number(source.tabId))
        ? null
        : Number(source.tabId),
      eventType: EVENT_TYPES.includes(source.eventType) ? source.eventType : 'text_check',
      checkName: toNullableString(source.checkName, 80),
      result: RESULTS.includes(source.result) ? source.result : 'INFO',
      severity: null,
      url: toNullableString(source.url, LIMITS.maxUrlLength),
      expectedValue: toNullableString(source.expectedValue, 500),
      actualValue: toNullableString(source.actualValue, 500),
      httpStatus: toNullableHttpStatus(source.httpStatus),
      loadDurationMs: source.loadDurationMs === null || source.loadDurationMs === undefined || !Number.isFinite(Number(source.loadDurationMs)) || Number(source.loadDurationMs) < 0
        ? null
        : clamp(Number(source.loadDurationMs), 0, 600000),
      reason: toNullableString(source.reason, 500),
      details: trimDetails(source.details),
      description: ''
    };
    event.severity = RESULTS.includes(source.severity) ? source.severity : severityForResult(event.result);
    event.description = stripControlCharacters(toNullableString(source.description, 500) || '') ||
      describeEvent(event);
    event.isCheck = source.isCheck === undefined
      ? CHECK_EVENT_TYPES.includes(event.eventType)
      : Boolean(source.isCheck);
    return event;
  }

  function eventResultLabel(result) {
    return { PASS: 'PASS', FAIL: 'FAIL', WARN: 'WARN', UNKNOWN: 'UNKNOWN', INFO: 'INFO' }[result] || 'INFO';
  }

  function describeEvent(event) {
    const status = event.httpStatus ? 'HTTP ' + event.httpStatus : null;
    switch (event.eventType) {
      case 'session_start':
        return 'Session started — ' + modeLabel((event.details && event.details.mode) || 'refresh') + (event.url ? ' — ' + event.url : '');
      case 'session_stop':
        return 'Session stopped — ' + stopReasonLabel(event.reason);
      case 'session_resumed':
        return 'Session resumed after service worker restart.';
      case 'navigation':
        return 'Navigation completed — ' + event.result + (status ? ' — ' + status : ' — HTTP status unavailable');
      case 'http_status':
        if (event.httpStatus) return 'HTTP status — ' + event.result + ' — ' + status;
        return 'HTTP status — UNKNOWN — status unavailable';
      case 'page_load': {
        if (event.loadDurationMs !== null) {
          return 'Page load — ' + event.result + ' — ' + formatMs(event.loadDurationMs);
        }
        return 'Page load — ' + event.result + ' — timing unavailable';
      }
      case 'text_check':
        return 'Text condition — ' + event.result + ' — ' + (event.reason || event.actualValue || textConditionLabel(event.details && event.details.condition));
      case 'dom_check':
        return 'DOM element — ' + event.result + ' — ' + (event.reason || event.actualValue || 'check completed');
      case 'url_check':
        return 'URL validation — ' + event.result + ' — ' + (event.reason || event.actualValue || 'URL unchanged');
      case 'redirect':
        return 'Redirect — ' + event.result + ' — ' + (event.actualValue || event.reason || 'navigation redirected');
      case 'navigation_error':
        return 'Navigation failed — FAIL — ' + (event.reason || 'navigation error');
      case 'reload_requested':
        return 'Reload requested' + (event.details && event.details.phase === 'pause' ? ' (cycle pause completed)' : '') + '.';
      case 'reload_failed':
        return 'Reload failed — ' + (event.reason || 'Chrome could not reload the tab');
      case 'baseline':
        return 'Monitoring baseline captured — ' + (event.reason || 'initial state recorded');
      case 'screenshot':
        return 'Screenshot captured — ' + (event.actualValue || 'stored locally');
      case 'screenshot_skipped':
        return 'Screenshot skipped — ' + (event.reason || 'tab was not visible');
      case 'legacy_event':
        return event.description || (event.actualValue || 'Legacy event');
      case 'config':
        return 'Configuration updated.';
      default:
        return event.description || (event.eventType + ' — ' + event.result);
    }
  }

  function isCheckEvent(event) {
    return Boolean(event && event.isCheck);
  }

  function computeStats(events, session, now = Date.now()) {
    const list = Array.isArray(events) ? events : [];
    const checks = list.filter(isCheckEvent);
    const stats = {
      totalEvents: list.length,
      totalChecks: checks.length,
      passed: 0,
      failed: 0,
      warnings: 0,
      unknown: 0,
      info: 0,
      avgLoadDurationMs: null,
      loadSamples: 0,
      lastEventAt: null,
      lastEvent: null,
      lastCheck: null,
      lastResult: null,
      failedChecks: [],
      unknownMeasurements: [],
      sessionDurationMs: null
    };
    let loadSum = 0;
    for (const event of list) {
      if (!event) continue;
      const check = isCheckEvent(event);
      if (check) {
        if (event.result === 'PASS') stats.passed += 1;
        else if (event.result === 'FAIL') stats.failed += 1;
        else if (event.result === 'WARN') stats.warnings += 1;
        else if (event.result === 'UNKNOWN') stats.unknown += 1;
        else if (event.result === 'INFO') stats.info += 1;
        if (event.loadDurationMs !== null && Number.isFinite(event.loadDurationMs) && event.loadDurationMs >= 0) {
          loadSum += event.loadDurationMs;
          stats.loadSamples += 1;
        }
        if (event.result === 'FAIL') {
          stats.failedChecks.push({ id: event.id, timestamp: event.timestamp, description: event.description, reason: event.reason });
        }
        if (event.result === 'UNKNOWN') {
          stats.unknownMeasurements.push({ id: event.id, timestamp: event.timestamp, description: event.description, reason: event.reason });
        }
      }
      stats.lastEventAt = event.timestamp;
      stats.lastEvent = event;
      if (check) stats.lastCheck = event;
    }
    if (stats.loadSamples > 0) stats.avgLoadDurationMs = Math.round(loadSum / stats.loadSamples);
    if (stats.lastCheck) stats.lastResult = stats.lastCheck.result;
    if (session) {
      const start = Date.parse(session.startedAt);
      const end = session.endedAt ? Date.parse(session.endedAt) : now;
      if (Number.isFinite(start) && Number.isFinite(end)) stats.sessionDurationMs = Math.max(0, end - start);
    }
    return stats;
  }

  // ---------------------------------------------------------------------------
  // Scheduling and badge (v2.3 semantics preserved)
  // ---------------------------------------------------------------------------

  function configOf(state) {
    if (!state) return null;
    return state.config && typeof state.config === 'object' ? state.config : state;
  }

  function isReloadingMode(state) {
    const config = configOf(state);
    if (!config) return false;
    if (config.mode === 'monitor') return false;
    if (config.mode === 'refresh') return true;
    return config.autoRefresh !== false;
  }

  function advanceSchedule(state, now = Date.now()) {
    const config = configOf(state) || {};
    if (!isReloadingMode(state)) {
      return { phase: 'active', reloadsInCycle: state.reloadsInCycle || 0, nextActionAt: null };
    }
    const intervalMs = Math.max(LIMITS.minIntervalSeconds, Number(config.intervalSeconds) || 10) * 1000;
    if (state.phase === 'pause') {
      return {
        phase: 'active',
        reloadsInCycle: 1,
        nextActionAt: now + intervalMs
      };
    }
    const nextCount = (Number(state.reloadsInCycle) || 0) + 1;
    if (config.cycleMode === 'cycles' && nextCount >= config.reloadsPerCycle) {
      return {
        phase: 'pause',
        reloadsInCycle: nextCount,
        nextActionAt: now + Math.max(1, Number(config.pauseSeconds) || 10) * 1000
      };
    }
    return {
      phase: 'active',
      reloadsInCycle: nextCount,
      nextActionAt: now + intervalMs
    };
  }

  function badgeForState(state, settings = DEFAULT_SETTINGS, now = Date.now(), failureCount = 0) {
    const show = settings.showCountdown !== false;
    if (!show) return { text: '', color: null };
    if (!state) return { text: '', color: null };
    const config = configOf(state) || {};
    if (!isReloadingMode(state) || !Number.isFinite(Number(state.nextActionAt))) {
      if (failureCount > 0) return { text: failureCount > 9 ? '9+' : String(failureCount), color: '#c62828' };
      return { text: 'QA', color: '#f39224' };
    }
    const remaining = Math.max(0, Math.ceil((Number(state.nextActionAt) - now) / 1000));
    return {
      text: remaining > 999 ? '999+' : String(remaining),
      color: config.cycleMode === 'cycles' && state.phase === 'pause' ? '#16803c' : '#c62828'
    };
  }

  // ---------------------------------------------------------------------------
  // CSV / HTML / JSON reports
  // ---------------------------------------------------------------------------

  const CSV_COLUMNS = [
    ['timestamp', 'Timestamp'],
    ['sessionId', 'Session ID'],
    ['tabId', 'Tab ID'],
    ['eventType', 'Event type'],
    ['checkName', 'Check'],
    ['result', 'Result'],
    ['severity', 'Severity'],
    ['url', 'URL'],
    ['expectedValue', 'Expected'],
    ['actualValue', 'Actual'],
    ['httpStatus', 'HTTP status'],
    ['loadDurationMs', 'Load duration (ms)'],
    ['reason', 'Reason'],
    ['description', 'Description'],
    ['details', 'Details (JSON)']
  ];

  function csvString(value) {
    if (value === null || value === undefined) return '""';
    let text = String(value);
    // Prevent spreadsheet formula injection from page-derived values.
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function csvNumber(value) {
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? '' : String(Number(value));
  }

  function csvMetadataLine(field, value) {
    return '# ' + csvString(field) + ',' + csvString(value);
  }

  function buildCsvReport(session, events) {
    const lines = [];
    lines.push(csvMetadataLine('Report', PRODUCT + ' ' + VERSION));
    lines.push(csvMetadataLine('Session ID', session.id));
    lines.push(csvMetadataLine('Mode', modeLabel(session.mode)));
    lines.push(csvMetadataLine('Started', session.startedAt));
    lines.push(csvMetadataLine('Ended', session.endedAt || 'Active'));
    lines.push(csvMetadataLine('URL', session.url || ''));
    if (session.stopReason) lines.push(csvMetadataLine('Stop reason', stopReasonLabel(session.stopReason)));
    lines.push('#');
    lines.push(CSV_COLUMNS.map((column) => csvString(column[1])).join(','));
    for (const event of Array.isArray(events) ? events : []) {
      let details = '';
      try { details = event.details ? JSON.stringify(event.details) : ''; } catch (_) { details = ''; }
      lines.push([
        csvString(event.timestamp),
        csvString(event.sessionId),
        csvNumber(event.tabId),
        csvString(event.eventType),
        csvString(event.checkName),
        csvString(event.result),
        csvString(event.severity),
        csvString(event.url),
        csvString(event.expectedValue),
        csvString(event.actualValue),
        csvNumber(event.httpStatus),
        csvNumber(event.loadDurationMs),
        csvString(event.reason),
        csvString(event.description),
        csvString(details)
      ].join(','));
    }
    return lines.join('\r\n') + '\r\n';
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function reportData(session, events, stats, generatedAt) {
    return {
      schemaVersion: SCHEMA_VERSION,
      product: PRODUCT,
      version: VERSION,
      generatedAt: generatedAt || nowIso(),
      session: session || null,
      stats: stats || computeStats(events, session),
      events: Array.isArray(events) ? events : [],
      limitations: LIMITATIONS
    };
  }

  function buildJsonReport(session, events, stats, generatedAt) {
    return JSON.stringify(reportData(session, events, stats, generatedAt), null, 2);
  }

  function buildHtmlReport(session, events, stats, generatedAt) {
    const report = reportData(session, events, stats, generatedAt);
    const configRows = session && session.config ? describeConfig(session.config) : [];
    const eventRows = report.events.map((event) => {
      const details = event.details ? JSON.stringify(event.details) : '';
      return '<tr class="result-' + escapeHtml(event.result.toLowerCase()) + '">' +
        '<td class="time">' + escapeHtml(formatLocalTime(event.timestamp)) + '</td>' +
        '<td><span class="badge ' + escapeHtml(event.result.toLowerCase()) + '">' + escapeHtml(event.result) + '</span></td>' +
        '<td>' + escapeHtml(event.checkName || event.eventType) + '</td>' +
        '<td>' + escapeHtml(event.description) + '</td>' +
        '<td>' + escapeHtml(event.httpStatus === null ? '—' : event.httpStatus) + '</td>' +
        '<td>' + escapeHtml(event.loadDurationMs === null ? '—' : formatMs(event.loadDurationMs)) + '</td>' +
        '<td>' + escapeHtml(event.reason || '') + '</td>' +
        '<td class="details">' + escapeHtml(details) + '</td>' +
        '</tr>';
    }).join('\n');

    const failures = report.stats.failedChecks.length
      ? '<ul>' + report.stats.failedChecks.map((failure) =>
        '<li><strong>' + escapeHtml(formatLocalTime(failure.timestamp)) + '</strong> — ' +
        escapeHtml(failure.description) + '</li>').join('') + '</ul>'
      : '<p class="muted">No failed checks were recorded.</p>';

    const unknown = report.stats.unknownMeasurements.length
      ? '<ul>' + report.stats.unknownMeasurements.map((item) =>
        '<li><strong>' + escapeHtml(formatLocalTime(item.timestamp)) + '</strong> — ' +
        escapeHtml(item.description) + '</li>').join('') + '</ul>'
      : '<p class="muted">No unavailable measurements were recorded.</p>';

    const safeTitle = PRODUCT + ' — QA report — ' + (session ? session.id : 'session');
    return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<meta name="referrer" content="no-referrer">\n' +
      '<title>' + escapeHtml(safeTitle) + '</title>\n<style>\n' + REPORT_CSS + '</style>\n</head>\n<body>\n' +
      '<main class="report">\n' +
      '<header class="report-header"><div class="brand"><div class="logo">↻</div><div><h1>' + escapeHtml(PRODUCT) + '</h1>' +
      '<p>QA monitoring report · version ' + escapeHtml(VERSION) + '</p></div></div>' +
      '<div class="generated">Generated ' + escapeHtml(formatLocalDateTime(report.generatedAt)) + '</div></header>\n' +
      '<section class="summary-grid">' +
      summaryCard('Checks', report.stats.totalChecks) +
      summaryCard('Passed', report.stats.passed) +
      summaryCard('Failed', report.stats.failed) +
      summaryCard('Warnings', report.stats.warnings) +
      summaryCard('Unknown', report.stats.unknown) +
      summaryCard('Avg load', report.stats.avgLoadDurationMs === null ? '—' : formatMs(report.stats.avgLoadDurationMs)) +
      '</section>\n' +
      '<section class="panel"><h2>Session</h2><table class="meta">' +
      metaRow('Product', PRODUCT + ' ' + VERSION) +
      metaRow('Session ID', session ? session.id : '—') +
      metaRow('Mode', session ? modeLabel(session.mode) : '—') +
      metaRow('Started', session ? formatLocalDateTime(session.startedAt) : '—') +
      metaRow('Ended', session && session.endedAt ? formatLocalDateTime(session.endedAt) : 'Active / not ended') +
      metaRow('Duration', formatSessionDuration(report.stats.sessionDurationMs)) +
      metaRow('Tested URL', session ? session.url : '—') +
      metaRow('Stop reason', session && session.stopReason ? stopReasonLabel(session.stopReason) : '—') +
      '</table></section>\n' +
      '<section class="panel"><h2>Monitoring configuration</h2><table class="meta">' +
      (configRows.length ? configRows.map((row) => metaRow(row[0], row[1])).join('') : metaRow('Configuration', 'Unavailable')) +
      '</table></section>\n' +
      '<section class="panel"><h2>Failed checks</h2>' + failures + '</section>\n' +
      '<section class="panel"><h2>Unavailable measurements</h2>' + unknown + '</section>\n' +
      '<section class="panel"><h2>Event timeline</h2>' +
      '<div class="table-wrap"><table class="events"><thead><tr><th>Time</th><th>Result</th><th>Check</th><th>Description</th><th>HTTP</th><th>Load</th><th>Reason</th><th>Details</th></tr></thead><tbody>' +
      (eventRows || '<tr><td colspan="8" class="muted">No events were recorded.</td></tr>') +
      '</tbody></table></div></section>\n' +
      '<section class="panel"><h2>Known limitations</h2><ul>' +
      LIMITATIONS.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') +
      '</ul></section>\n' +
      '<footer>Generated locally by ' + escapeHtml(PRODUCT) + ' ' + escapeHtml(VERSION) + '. No data was uploaded. ' +
      '<a href="' + escapeHtml(WEBSITE) + '" rel="noreferrer">Odesoftami</a></footer>\n' +
      '</main>\n</body>\n</html>';
  }

  function summaryCard(label, value) {
    return '<div class="summary-card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(value)) + '</strong></div>';
  }

  function metaRow(label, value) {
    return '<tr><th>' + escapeHtml(label) + '</th><td>' + escapeHtml(value === null || value === undefined ? '—' : String(value)) + '</td></tr>';
  }

  const REPORT_CSS = [
    ':root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#202633;background:#f5f7fa}',
    '*{box-sizing:border-box}body{margin:0;padding:28px 16px}',
    '.report{max-width:1180px;margin:0 auto}',
    '.report-header{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:20px}',
    '.brand{display:flex;align-items:center;gap:12px}.logo{width:46px;height:46px;border-radius:12px;background:#f39224;color:#fff;display:grid;place-items:center;font-size:31px;line-height:1}',
    'h1{font-size:21px;margin:0}.brand p{margin:4px 0 0;color:#6b7482;font-size:12px}.generated{color:#6b7482;font-size:12px}',
    '.summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:16px}',
    '.summary-card{background:#fff;border:1px solid #e0e5ec;border-radius:12px;padding:14px}',
    '.summary-card span{display:block;color:#6b7482;font-size:11px;text-transform:uppercase;letter-spacing:.06em}',
    '.summary-card strong{display:block;font-size:24px;margin-top:5px}',
    '.panel{background:#fff;border:1px solid #e0e5ec;border-radius:14px;padding:18px;margin-bottom:14px}',
    'h2{font-size:15px;margin:0 0 12px}table{border-collapse:collapse;width:100%}',
    '.meta th{width:190px;text-align:left;font-size:12px;color:#596273;padding:7px 10px 7px 0;vertical-align:top}',
    '.meta td{font-size:12px;padding:7px 0;word-break:break-word}',
    '.table-wrap{overflow-x:auto}.events th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7482;border-bottom:1px solid #e5e9ef;padding:8px 7px;white-space:nowrap}',
    '.events td{font-size:11px;border-bottom:1px solid #f0f2f6;padding:8px 7px;vertical-align:top}',
    '.events td.details{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:#596273;max-width:260px;word-break:break-word}',
    '.badge{display:inline-block;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:700}',
    '.badge.pass{background:#e8f7ef;color:#147a48}.badge.fail{background:#fdecec;color:#b42318}',
    '.badge.warn{background:#fff5e5;color:#9a5b00}.badge.unknown{background:#eef1f5;color:#596273}.badge.info{background:#eef4ff;color:#2d5c9e}',
    '.muted{color:#7b8492;font-size:12px}ul{margin:0;padding-left:20px}li{font-size:12px;line-height:1.6;margin-bottom:4px}',
    'footer{text-align:center;color:#8a929e;font-size:11px;margin-top:22px}footer a{color:#b96a0b}',
    '@media print{body{background:#fff;padding:0}.panel{break-inside:avoid}.summary-grid{grid-template-columns:repeat(6,1fr)}.generated{font-size:10px}}'
  ].join('\n');

  function sanitizeFilename(name, fallback = 'odesoftami-report') {
    const text = String(name || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
    return (text || fallback).slice(0, 120);
  }

  function reportFilename(session, extension) {
    const started = session && session.startedAt ? session.startedAt.slice(0, 19).replace(/[:T]/g, '-') : 'session';
    const id = session && session.id ? session.id.slice(-8) : 'report';
    return sanitizeFilename('odesoftami-qa-' + started + '-' + id) + '.' + extension;
  }

  // ---------------------------------------------------------------------------
  // Presets
  // ---------------------------------------------------------------------------

  const BUILTIN_PRESETS = Object.freeze([
    {
      id: 'builtin-deployment',
      name: 'Deployment Monitor',
      description: 'Refresh on an interval, wait for a ready-state text, record load timings and stop when the page is ready.',
      mode: 'qa',
      builtin: true,
      config: {
        ...defaultConfig('qa'),
        intervalSeconds: 30,
        cycleMode: 'continuous',
        text: { enabled: true, condition: 'appears', pattern: 'READY', regex: false },
        timing: { enabled: true, budgetMs: 5000 },
        notifyOnMatch: true,
        stopOnMatch: true,
        notifyOnFailure: false,
        stopOnFailure: false,
        screenshotOnFailure: false
      }
    },
    {
      id: 'builtin-error-watch',
      name: 'Error Watch',
      description: 'Monitor for error text and an optional error element, notify and stop on the first failure.',
      mode: 'monitor',
      builtin: true,
      config: {
        ...defaultConfig('monitor'),
        intervalSeconds: 10,
        text: { enabled: true, condition: 'absent', pattern: 'Error', regex: false },
        dom: { enabled: true, selector: '.error-message', condition: 'appears', expectedText: '' },
        notifyOnFailure: true,
        stopOnFailure: true,
        screenshotOnFailure: true
      }
    },
    {
      id: 'builtin-url-check',
      name: 'URL / Redirect Check',
      description: 'Watch the top-level URL for unexpected changes and redirects, with HTTP status and load timing.',
      mode: 'monitor',
      builtin: true,
      config: {
        ...defaultConfig('monitor'),
        intervalSeconds: 10,
        url: { enabled: true, expectedUrl: '', ignoreHash: true },
        http: { enabled: true },
        timing: { enabled: true, budgetMs: 5000 },
        notifyOnFailure: true,
        stopOnFailure: false
      }
    },
    {
      id: 'builtin-custom-qa',
      name: 'Custom QA Session',
      description: 'A full QA session with refresh, checks, timings, reports and optional screenshots.',
      mode: 'qa',
      builtin: true,
      config: {
        ...defaultConfig('qa'),
        intervalSeconds: 60,
        cycleMode: 'continuous',
        url: { enabled: true, expectedUrl: '', ignoreHash: true },
        timing: { enabled: true, budgetMs: 5000 },
        notifyOnFailure: true,
        stopOnFailure: false,
        screenshotOnFailure: true
      }
    }
  ].map((preset) => ({
    ...preset,
    config: normalizeConfig({ ...preset.config, mode: preset.mode })
  })));

  function validatePreset(raw, { selectorValidator = null, existingNames = [] } = {}) {
    const input = isPlainObject(raw) ? raw : {};
    const errors = [];
    const name = stripControlCharacters(toNullableString(input.name, LIMITS.maxPresetNameLength + 1) || '');
    if (!name) errors.push('Preset name is required.');
    if (name.length > LIMITS.maxPresetNameLength) errors.push('Preset name must be 60 characters or fewer.');
    const description = stripControlCharacters(toNullableString(input.description, LIMITS.maxPresetDescriptionLength + 1) || '');
    if (description.length > LIMITS.maxPresetDescriptionLength) errors.push('Preset description must be 200 characters or fewer.');
    if (!input.config || !isPlainObject(input.config)) {
      errors.push('Preset configuration is missing.');
    }
    const mode = normalizeMode(input.mode || (isPlainObject(input.config) && input.config.mode));
    const configCheck = validateConfig({ ...(isPlainObject(input.config) ? input.config : {}), mode }, { selectorValidator });
    if (!configCheck.ok) errors.push(...configCheck.errors);
    if (input.mode && !MODES.includes(input.mode)) errors.push('Preset mode is invalid.');
    if (errors.length) return { ok: false, errors, config: configCheck.config };
    return {
      ok: true,
      errors: [],
      preset: {
        id: (() => {
          const requested = toNullableString(input.id, 80);
          return requested && !requested.startsWith('builtin-') ? requested : 'preset-' + uuid();
        })(),
        name: uniquePresetName(name, existingNames),
        description: description || null,
        mode,
        config: configCheck.config,
        builtin: false,
        createdAt: isoOrNow(input.createdAt),
        updatedAt: nowIso()
      }
    };
  }

  function uniquePresetName(name, existingNames) {
    const used = new Set((existingNames || []).map((value) => String(value).toLowerCase()));
    if (!used.has(name.toLowerCase())) return name;
    let counter = 2;
    let candidate = name + ' (2)';
    while (used.has(candidate.toLowerCase())) {
      counter += 1;
      candidate = name + ' (' + counter + ')';
    }
    return candidate;
  }

  function parsePresetImport(text) {
    if (typeof text !== 'string') return { ok: false, error: 'The import file is empty.' };
    if (text.length > LIMITS.maxPresetFileBytes) return { ok: false, error: 'The import file is too large (maximum 256 KB).' };
    let data;
    try { data = JSON.parse(text); } catch (error) {
      return { ok: false, error: 'Invalid JSON: ' + (error && error.message ? error.message : 'parse error') };
    }
    let candidates;
    if (Array.isArray(data)) candidates = data;
    else if (isPlainObject(data) && Array.isArray(data.presets)) candidates = data.presets;
    else if (isPlainObject(data) && (data.config || data.mode)) candidates = [data];
    else return { ok: false, error: 'Expected a preset object, an array of presets, or { "presets": [...] }.' };
    if (!candidates.length) return { ok: false, error: 'The import file does not contain any presets.' };
    if (candidates.length > LIMITS.maxPresets) return { ok: false, error: 'Too many presets in one file (maximum 50).' };
    return { ok: true, candidates };
  }

  function exportPresets(presets) {
    return JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      product: PRODUCT,
      version: VERSION,
      exportedAt: nowIso(),
      presets: (Array.isArray(presets) ? presets : []).map((preset) => ({
        name: preset.name,
        description: preset.description || '',
        mode: preset.mode,
        config: normalizeConfig(preset.config)
      }))
    }, null, 2);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  const api = {
    PRODUCT, SHORT_NAME, TAGLINE, AUTHOR, COPYRIGHT_YEAR, VERSION, SCHEMA_VERSION, WEBSITE,
    GITHUB_URL, WEBSITE_URL,
    MODES, MODE_LABELS, PANEL_POSITIONS, RESULTS, RESULT_SEVERITY, TEXT_CONDITIONS, DOM_CONDITIONS,
    EVENT_TYPES, CHECK_EVENT_TYPES, LIMITS, DEFAULT_SETTINGS, STOP_REASONS, LIMITATIONS,
    BUILTIN_PRESETS,
    isPlainObject, clamp, toInteger, toNullableString, toNullableNumber, toNullableHttpStatus,
    uuid, nowIso, isoOrNow, stripControlCharacters,
    formatDuration, formatSessionDuration, formatMs, formatBytes, formatPercent,
    formatLocalDateTime, formatLocalTime, modeLabel, stopReasonLabel, severityForResult,
    validateIntervalSeconds, validateCycleSettings, validateRegexPattern, validateUrl,
    validateSelectorShape, validateSelectorWithDom, normalizeTextCondition, normalizeMode,
    defaultConfig, normalizeConfig, validateConfig, normalizeSettings, configForMode,
    configFromLegacy, describeConfig, textConditionLabel, domConditionLabel,
    sanitizeDetails, createEvent, describeEvent, isCheckEvent, computeStats, eventResultLabel,
    configOf, isReloadingMode, advanceSchedule, badgeForState,
    buildCsvReport, buildJsonReport, buildHtmlReport, reportData, escapeHtml, csvString,
    csvNumber, sanitizeFilename, reportFilename,
    validatePreset, parsePresetImport, exportPresets, uniquePresetName
  };

  root.OdesCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
