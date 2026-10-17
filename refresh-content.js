/*
 * Odesoftami QA Monitor — content monitor (v3.1.0)
 *
 * Runs in the extension's isolated world on HTTP/HTTPS pages. It only starts
 * work after the service worker sends a session state; pages without an
 * active session produce no messages, observers or timers.
 *
 * Text is read from visible document text. Full page text is never sent to
 * the service worker or stored; only snippets/results and lengths are sent.
 */
(() => {
  'use strict';
  if (window.__odesoftamiAutoRefreshInstalled) return;
  window.__odesoftamiAutoRefreshInstalled = true;

  const MAX_TEXT_LENGTH = 500000;
  const MAX_DOM_TEXT_LENGTH = 20000;
  const URL_POLL_MS = 1000;
  const BADGE_TICK_MS = 1000;
  const EVALUATION_THROTTLE_MS = 3000;
  const MAX_BASELINE_WAIT_MS = 10000;
  const LOAD_TIMEOUT_MS = 20000;

  let active = null;
  let settings = { settleMs: 800 };
  let observer = null;
  let baseline = null;
  let baselineStartedAt = 0;
  let legacyTextMatched = false;
  let lastSentSignature = '';
  let lastSentAt = 0;
  let lastEvaluationAt = 0;
  let lastUrl = location.href;
  let lastUrlComparable = location.href;
  let urlCheckDue = false;
  let loadTimingSent = false;
  let domReadyHandled = false;
  let invalid = { text: false, dom: false };
  let sentErrors = new Set();
  let regexCache = { pattern: '', regex: null, valid: true };
  let timers = {
    reload: null,
    badge: null,
    urlPoll: null,
    settle: null,
    baseline: null,
    retry: null,
    loadTimeout: null
  };

  function config() {
    return active && active.config ? active.config : null;
  }

  function isActive() {
    return Boolean(active && active.sessionId);
  }

  function clearTimer(name) {
    if (timers[name] !== null && timers[name] !== undefined) {
      clearTimeout(timers[name]);
      timers[name] = null;
    }
  }

  function clearTimers() {
    for (const name of Object.keys(timers)) clearTimer(name);
  }

  function stopObserver() {
    if (observer) {
      try { observer.disconnect(); } catch (_) { /* ignore */ }
      observer = null;
    }
  }

  function panelApi() {
    return typeof window.OdesoftamiFloatingPanel === 'object' && window.OdesoftamiFloatingPanel
      ? window.OdesoftamiFloatingPanel
      : null;
  }

  function syncPanel(state) {
    const api = panelApi();
    if (!api) return;
    try {
      if (!state || state.mode === 'refresh' || settings.floatingPanelEnabled === false) {
        api.destroy();
        return;
      }
      api.show({
        enabled: true,
        mode: state.mode,
        sessionId: state.sessionId,
        settings
      });
    } catch (error) {
      // A panel failure must never break monitoring.
      try { console.warn('[Odesoftami] Floating panel failed:', error); } catch (_) { /* ignore */ }
    }
  }

  function cleanup(options = {}) {
    const keepPanel = Boolean(options.keepPanel);
    if (!keepPanel) {
      const api = panelApi();
      if (api) {
        try { api.destroy(); } catch (_) { /* ignore */ }
      }
    }
    active = null;
    baseline = null;
    baselineStartedAt = 0;
    legacyTextMatched = false;
    lastSentSignature = '';
    lastSentAt = 0;
    lastEvaluationAt = 0;
    invalid = { text: false, dom: false };
    sentErrors = new Set();
    regexCache = { pattern: '', regex: null, valid: true };
    clearTimers();
    stopObserver();
  }

  function send(message) {
    return chrome.runtime.sendMessage(message);
  }

  function sendSafe(message) {
    return send(message).catch((error) => {
      if (/Extension context invalidated|message port closed|Receiving end does not exist/i.test(String(error && error.message))) {
        cleanup();
      }
      return null;
    });
  }

  function reportContentError(scope, code, message) {
    const key = scope + ':' + code;
    if (sentErrors.has(key)) return;
    sentErrors.add(key);
    sendSafe({
      type: 'CONTENT_ERROR',
      scope,
      code,
      message,
      url: location.href
    });
  }

  // -------------------------------------------------------------------------
  // Text and DOM helpers
  // -------------------------------------------------------------------------

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getPageText() {
    let text = '';
    try {
      const body = document.body;
      text = body ? (body.innerText || body.textContent || '') : (document.documentElement?.innerText || document.documentElement?.textContent || '');
    } catch (_) {
      try { text = document.documentElement?.textContent || ''; } catch (_) { text = ''; }
    }
    const normalized = normalizeText(text);
    return normalized.length > MAX_TEXT_LENGTH ? normalized.slice(0, MAX_TEXT_LENGTH) : normalized;
  }

  function parseRegex(pattern) {
    if (regexCache.pattern === pattern) return regexCache;
    try {
      regexCache = { pattern, regex: new RegExp(pattern, 'i'), valid: true };
    } catch (error) {
      regexCache = { pattern, regex: null, valid: false };
    }
    return regexCache;
  }

  function testText(text) {
    const textConfig = config().text;
    const pattern = normalizeText(textConfig.pattern);
    if (!pattern) return false;
    if (textConfig.regex) {
      const parsed = parseRegex(pattern);
      if (!parsed.valid) {
        if (!invalid.text) {
          invalid.text = true;
          reportContentError('text', 'invalid_regex', 'The configured regular expression is invalid and cannot be evaluated.');
        }
        return false;
      }
      try {
        return parsed.regex.test(text);
      } catch (_) {
        return false;
      }
    }
    return text.toLocaleLowerCase().includes(pattern.toLocaleLowerCase());
  }

  function getDomElement() {
    const domConfig = config().dom;
    if (!domConfig.enabled || invalid.dom) return null;
    try {
      return document.querySelector(domConfig.selector);
    } catch (_) {
      invalid.dom = true;
      reportContentError('dom', 'invalid_selector', 'The configured CSS selector is invalid and cannot be evaluated.');
      return null;
    }
  }

  function elementText(element) {
    let text = '';
    try {
      text = element.innerText || element.textContent || '';
    } catch (_) {
      text = element.textContent || '';
    }
    const normalized = normalizeText(text);
    return normalized.length > MAX_DOM_TEXT_LENGTH ? normalized.slice(0, MAX_DOM_TEXT_LENGTH) : normalized;
  }

  function stripHash(url) {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      return parsed.href;
    } catch (_) {
      return String(url);
    }
  }

  function urlsMatch(current, expected, ignoreHash) {
    if (!current || !expected) return false;
    if (ignoreHash) return stripHash(current) === stripHash(expected);
    return current === expected;
  }

  // -------------------------------------------------------------------------
  // Baseline
  // -------------------------------------------------------------------------

  function scheduleBaseline() {
    if (!isActive() || baseline) return;
    if (!domReadyHandled && document.readyState === 'loading') return;
    clearTimer('baseline');
    const cfg = config();
    const settle = Math.max(150, Number(cfg.settleMs) || 800);
    const elapsed = baselineStartedAt ? Date.now() - baselineStartedAt : 0;
    const delay = elapsed > MAX_BASELINE_WAIT_MS ? 150 : settle;
    if (!baselineStartedAt) baselineStartedAt = Date.now();
    timers.baseline = setTimeout(() => {
      timers.baseline = null;
      captureBaseline();
    }, delay);
  }

  function captureBaseline() {
    if (!isActive()) return;
    const cfg = config();
    const pageText = cfg.text.enabled ? getPageText() : '';
    const textFound = cfg.text.enabled ? testText(pageText) : false;
    let domPresent = null;
    let domText = null;
    if (cfg.dom.enabled && !invalid.dom) {
      const element = getDomElement();
      domPresent = Boolean(element);
      if (element) domText = elementText(element);
    }
    baseline = {
      at: Date.now(),
      url: location.href,
      text: cfg.text.enabled ? pageText : null,
      found: cfg.text.enabled ? textFound : false,
      domPresent,
      domText
    };
    baselineStartedAt = 0;
    lastUrl = location.href;
    lastUrlComparable = cfg.url.ignoreHash ? stripHash(location.href) : location.href;
    urlCheckDue = cfg.url.enabled;
    sendSafe({
      type: 'MONITOR_BASELINE',
      url: location.href,
      found: textFound,
      textLength: pageText.length,
      domPresent,
      domTextLength: domText === null ? null : domText.length,
      readyState: document.readyState
    });
    evaluateChecks(true);
  }

  // -------------------------------------------------------------------------
  // Checks
  // -------------------------------------------------------------------------

  function textCheck(pageText) {
    const cfg = config().text;
    const found = testText(pageText);
    const condition = cfg.condition;
    let result = 'WARN';
    let reason = '';
    let actual = found ? 'Text found' : 'Text not found';
    if (condition === 'appears') {
      if (found) {
        result = 'PASS';
        reason = 'Expected text found.';
        actual = 'Text found';
      } else {
        result = 'WARN';
        reason = 'Expected text has not appeared yet.';
        actual = 'Text not found';
      }
    } else if (condition === 'absent') {
      if (!found) {
        result = 'PASS';
        reason = 'Text is absent as expected.';
        actual = 'Text not found';
      } else {
        result = 'FAIL';
        reason = 'Text was expected to be absent but was found.';
        actual = 'Text found';
      }
    } else if (condition === 'disappears') {
      if (!baseline || !baseline.found) {
        result = 'UNKNOWN';
        reason = 'Text was not present at baseline; disappearance cannot be evaluated.';
      } else if (found) {
        result = 'WARN';
        reason = 'Text is still present.';
        actual = 'Text found';
      } else {
        result = 'PASS';
        reason = 'Text disappeared after being present.';
        actual = 'Text not found';
      }
    } else if (condition === 'changes') {
      if (!baseline || baseline.text === null) {
        result = 'UNKNOWN';
        reason = 'No text baseline is available for a change comparison.';
      } else if (pageText !== baseline.text) {
        result = 'PASS';
        reason = 'Page text changed compared with the baseline.';
        actual = 'Text changed';
      } else {
        result = 'WARN';
        reason = 'No text change has been observed yet.';
        actual = 'Text unchanged';
      }
    }
    return {
      type: 'text',
      result,
      matched: result === 'PASS',
      expected: cfg.regex ? 'regex /' + cfg.pattern + '/i' : cfg.pattern,
      actual,
      reason,
      description: 'Text condition — ' + result + ' — ' + reason,
      url: location.href,
      details: {
        condition,
        regex: Boolean(cfg.regex),
        textFound: found,
        textLength: pageText.length,
        baselineFound: baseline ? baseline.found : null
      }
    };
  }

  function domCheck() {
    const cfg = config().dom;
    if (!cfg.enabled || invalid.dom) return null;
    const element = getDomElement();
    const present = Boolean(element);
    const currentText = element ? elementText(element) : null;
    const condition = cfg.condition;
    let result = 'WARN';
    let reason = '';
    let actual = present ? 'Element found' : 'Element not found';
    if (cfg.expectedText) {
      if (!present) {
        result = 'FAIL';
        reason = 'Selector not found; the expected element text cannot be verified.';
        actual = 'Element not found';
      } else if (currentText !== null && currentText.toLocaleLowerCase().includes(normalizeText(cfg.expectedText).toLocaleLowerCase())) {
        result = 'PASS';
        reason = 'Expected text found inside the element.';
        actual = 'Expected text found';
      } else {
        result = 'FAIL';
        reason = 'The element does not contain the expected text.';
        actual = 'Expected text not found';
      }
    } else if (condition === 'appears') {
      if (present) {
        result = 'PASS';
        reason = 'Element found.';
        actual = 'Element found';
      } else {
        result = 'WARN';
        reason = 'Element has not appeared yet.';
        actual = 'Element not found';
      }
    } else if (condition === 'disappears') {
      if (!baseline || !baseline.domPresent) {
        result = 'UNKNOWN';
        reason = 'Element was not present at baseline; disappearance cannot be evaluated.';
      } else if (present) {
        result = 'WARN';
        reason = 'Element is still present.';
        actual = 'Element found';
      } else {
        result = 'PASS';
        reason = 'Element disappeared after being present.';
        actual = 'Element not found';
      }
    } else if (condition === 'textChanges') {
      if (!present) {
        result = 'FAIL';
        reason = 'Selector not found.';
        actual = 'Element not found';
      } else if (!baseline || baseline.domText === null) {
        result = 'PASS';
        reason = 'Element appeared; no previous element text baseline was available.';
        actual = 'Element appeared';
      } else if (currentText !== baseline.domText) {
        result = 'PASS';
        reason = 'Element text changed compared with the baseline.';
        actual = 'Element text changed';
      } else {
        result = 'WARN';
        reason = 'Element text has not changed yet.';
        actual = 'Element text unchanged';
      }
    }
    return {
      type: 'dom',
      result,
      matched: result === 'PASS',
      expected: cfg.expectedText ? 'Element text contains "' + cfg.expectedText + '"' : cfg.selector,
      actual,
      reason,
      description: 'DOM element — ' + result + ' — ' + reason,
      url: location.href,
      details: {
        condition,
        selectorLength: cfg.selector.length,
        elementPresent: present,
        elementTextLength: currentText === null ? null : currentText.length,
        hasExpectedText: Boolean(cfg.expectedText)
      }
    };
  }

  function urlCheck() {
    const cfg = config().url;
    const expected = cfg.expectedUrl || active.expectedUrl || (baseline && baseline.url) || location.href;
    const current = location.href;
    const matches = urlsMatch(current, expected, cfg.ignoreHash);
    return {
      type: 'url',
      result: matches ? 'PASS' : 'FAIL',
      matched: matches,
      expected,
      actual: current,
      reason: matches ? 'Top-level URL matches the expectation.' : 'The top-level URL changed unexpectedly.',
      description: 'URL validation — ' + (matches ? 'PASS — URL unchanged' : 'FAIL — unexpected URL change'),
      url: current,
      details: {
        ignoreHash: Boolean(cfg.ignoreHash),
        expected,
        current,
        source: 'content'
      }
    };
  }

  function buildChecks() {
    const cfg = config();
    if (!cfg) return [];
    const checks = [];
    if (cfg.text.enabled && !invalid.text) {
      const pageText = getPageText();
      checks.push(textCheck(pageText));
    }
    if (cfg.dom.enabled && !invalid.dom) {
      const dom = domCheck();
      if (dom) checks.push(dom);
    }
    if (cfg.url.enabled && urlCheckDue) {
      checks.push(urlCheck());
      urlCheckDue = false;
    }
    return checks;
  }

  function signatureOf(checks) {
    return checks.map((check) => check.type + '|' + check.result + '|' + check.actual + '|' + check.reason).join('||');
  }

  function evaluateChecks(force) {
    if (!isActive() || !baseline) return;
    if (document.readyState === 'loading') return;
    lastEvaluationAt = Date.now();
    const cfg = config();
    let checks = buildChecks();
    if (!checks.length) return;
    // In v2.3-compatible Refresh mode only the text condition is used and it
    // is reported on the false -> true transition, matching the old behavior.
    if (active.mode === 'refresh') {
      const text = checks.find((check) => check.type === 'text');
      if (!text) return;
      if (text.matched) {
        if (!legacyTextMatched) {
          legacyTextMatched = true;
          sendChecks([text], true);
        }
      } else {
        legacyTextMatched = false;
      }
      return;
    }
    const signature = signatureOf(checks);
    if (!force && signature === lastSentSignature && Date.now() - lastSentAt < EVALUATION_THROTTLE_MS) {
      return;
    }
    lastSentSignature = signature;
    lastSentAt = Date.now();
    sendChecks(checks, force);
  }

  function sendChecks(checks, force) {
    if (!isActive()) return;
    sendSafe({
      type: 'CHECK_RESULT',
      url: location.href,
      checks
    }).then((response) => {
      if (!response) return;
      if (response.ignored || (response.ok === false && /no active session/i.test(String(response.error || '')))) {
        cleanup();
      }
    }).catch(() => { /* handled by sendSafe */ });
  }

  function scheduleEvaluation() {
    if (!isActive()) return;
    if (!baseline) {
      scheduleBaseline();
      return;
    }
    clearTimer('settle');
    const delay = Math.max(150, Number(config().settleMs) || 800);
    timers.settle = setTimeout(() => {
      timers.settle = null;
      evaluateChecks(false);
    }, delay);
  }

  // -------------------------------------------------------------------------
  // Navigation, SPA URL changes, load timing
  // -------------------------------------------------------------------------

  function checkUrlChange() {
    if (!isActive()) return;
    const cfg = config();
    const comparable = cfg.url.ignoreHash ? stripHash(location.href) : location.href;
    if (comparable === lastUrlComparable) return;
    lastUrlComparable = comparable;
    lastUrl = location.href;
    baseline = null;
    baselineStartedAt = Date.now();
    urlCheckDue = Boolean(cfg.url.enabled);
    legacyTextMatched = false;
    lastSentSignature = '';
    scheduleBaseline();
  }

  function collectLoadTiming(final) {
    if (!isActive()) return;
    const cfg = config();
    if (!cfg.timing.enabled || loadTimingSent) return;
    let navigation = null;
    try {
      if (performance && typeof performance.getEntriesByType === 'function') {
        navigation = performance.getEntriesByType('navigation')[0] || null;
      }
    } catch (_) { navigation = null; }
    if (!navigation) {
      loadTimingSent = true;
      clearTimer('loadTimeout');
      sendSafe({
        type: 'LOAD_TIMING',
        url: location.href,
        state: 'unavailable',
        readyState: document.readyState,
        navigationStart: null,
        domContentLoadedMs: null,
        loadEventMs: null,
        durationMs: null
      });
      return;
    }
    const dcl = Number(navigation.domContentLoadedEventEnd) > 0 ? Math.round(navigation.domContentLoadedEventEnd) : null;
    const load = Number(navigation.loadEventEnd) > 0 ? Math.round(navigation.loadEventEnd) : null;
    const duration = load === null ? null : Math.round(Number(navigation.duration) > 0 ? navigation.duration : load);
    const navigationStart = Math.round((Number(performance.timeOrigin) || (Date.now() - Number(navigation.startTime || 0))) + Number(navigation.startTime || 0));
    loadTimingSent = true;
    clearTimer('loadTimeout');
    sendSafe({
      type: 'LOAD_TIMING',
      url: location.href,
      state: load === null ? 'incomplete' : 'complete',
      readyState: document.readyState,
      navigationStart,
      domContentLoadedMs: dcl,
      loadEventMs: load,
      durationMs: duration
    });
  }

  function scheduleLoadTimeout() {
    clearTimer('loadTimeout');
    timers.loadTimeout = setTimeout(() => {
      timers.loadTimeout = null;
      if (!loadTimingSent) collectLoadTiming(false);
    }, LOAD_TIMEOUT_MS);
  }

  function onLoad() {
    if (!isActive()) return;
    collectLoadTiming(true);
  }

  function onDomReady() {
    if (!isActive()) return;
    domReadyHandled = true;
    scheduleBaseline();
    scheduleLoadTimeout();
    if (document.readyState === 'complete') onLoad();
  }

  // -------------------------------------------------------------------------
  // Timers: refresh and badge
  // -------------------------------------------------------------------------

  function scheduleReload() {
    clearTimer('reload');
    clearTimer('retry');
    if (!isActive()) return;
    if (!active.isReloading || !Number.isFinite(Number(active.nextActionAt))) return;
    const delay = Math.max(0, Number(active.nextActionAt) - Date.now());
    timers.reload = setTimeout(async () => {
      timers.reload = null;
      if (!isActive()) return;
      const response = await sendSafe({ type: 'REFRESH_DUE' });
      if (!response) {
        timers.retry = setTimeout(requestState, 3000);
        return;
      }
      if (response.ok === false) {
        if (/no active session/i.test(String(response.error || ''))) {
          cleanup();
          return;
        }
        if (Number.isFinite(Number(response.nextActionAt))) {
          active.nextActionAt = Number(response.nextActionAt);
          scheduleReload();
          return;
        }
        timers.retry = setTimeout(requestState, 2500);
        return;
      }
      // The service worker requested a reload. If the page survives (for
      // example because a beforeunload dialog blocked it), re-sync shortly.
      timers.retry = setTimeout(requestState, 3000);
    }, delay);
  }

  function startBadgeTick() {
    clearTimer('badge');
    if (!isActive() || !active.isReloading) return;
    timers.badge = setInterval(() => {
      if (!isActive()) return;
      sendSafe({ type: 'BADGE_TICK' });
    }, BADGE_TICK_MS);
  }

  function startUrlPoll() {
    clearTimer('urlPoll');
    if (!isActive()) return;
    const cfg = config();
    if (!cfg.url.enabled && !cfg.text.enabled && !cfg.dom.enabled) return;
    timers.urlPoll = setInterval(checkUrlChange, URL_POLL_MS);
  }

  // -------------------------------------------------------------------------
  // Observer and lifecycle
  // -------------------------------------------------------------------------

  function startObserver() {
    stopObserver();
    if (!isActive()) return;
    const cfg = config();
    if (!cfg.text.enabled && !cfg.dom.enabled) return;
    const target = document.documentElement;
    if (!target) {
      document.addEventListener('DOMContentLoaded', startObserver, { once: true });
      return;
    }
    observer = new MutationObserver(() => {
      if (!isActive()) return;
      if (!baseline) {
        scheduleBaseline();
        return;
      }
      scheduleEvaluation();
    });
    try {
      observer.observe(target, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']
      });
    } catch (error) {
      reportContentError('text', 'observer_failed', 'The DOM observer could not start: ' + (error && error.message ? error.message : 'unknown error'));
    }
  }

  function startMonitoring() {
    domReadyHandled = document.readyState !== 'loading';
    baseline = null;
    baselineStartedAt = 0;
    legacyTextMatched = false;
    lastSentSignature = '';
    lastSentAt = 0;
    loadTimingSent = false;
    invalid = { text: false, dom: false };
    sentErrors = new Set();
    lastUrl = location.href;
    lastUrlComparable = config().url.ignoreHash ? stripHash(location.href) : location.href;
    urlCheckDue = Boolean(config().url.enabled);
    startObserver();
    startUrlPoll();
    startBadgeTick();
    scheduleReload();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onDomReady, { once: true });
    } else {
      onDomReady();
      if (document.readyState === 'complete') onLoad();
    }
    if (document.readyState !== 'complete') {
      window.addEventListener('load', onLoad, { once: true });
    }
  }

  function applyState(state, incomingSettings) {
    if (incomingSettings) settings = { ...settings, ...incomingSettings };
    if (!state || !state.sessionId) {
      cleanup();
      return;
    }
    const isNew = !active || active.sessionId !== state.sessionId;
    const configChanged = !active || JSON.stringify(active.config) !== JSON.stringify(state.config);
    active = state;
    if (isNew || configChanged) {
      clearTimers();
      stopObserver();
      startMonitoring();
    } else {
      scheduleReload();
      startBadgeTick();
      startUrlPoll();
      if (!observer && (config().text.enabled || config().dom.enabled)) startObserver();
    }
    syncPanel(state);
  }

  async function requestState() {
    const response = await sendSafe({ type: 'CONTENT_READY', url: location.href, readyState: document.readyState });
    if (!response || response.state === undefined) return;
    if (!response.state) {
      cleanup();
      return;
    }
    applyState(response.state, response.settings);
  }

  function onPageShow(event) {
    if (!isActive()) return;
    if (event && event.persisted) {
      // The page was restored from the back/forward cache; timers were frozen.
      scheduleReload();
      startBadgeTick();
      startUrlPoll();
      scheduleEvaluation();
    }
    requestState();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.type !== 'string') return false;
    if (message.type === 'STOP_CONTENT_REFRESH') {
      const retain = settings.floatingPanelRetainSummary !== false;
      const api = panelApi();
      if (api) {
        try {
          Promise.resolve(api.finalize({ retain })).catch(() => {});
        } catch (_) { /* ignore */ }
      }
      cleanup({ keepPanel: retain });
      return false;
    }
    if (message.type === 'SYNC_CONTENT_REFRESH' || message.type === 'START_CONTENT_REFRESH') {
      requestState();
      return false;
    }
    return false;
  });

  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('popstate', () => {
    checkUrlChange();
    scheduleEvaluation();
  });
  window.addEventListener('hashchange', () => {
    checkUrlChange();
    scheduleEvaluation();
  });

  // No work is performed on page load until the service worker sends a state.
})();
