'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../lib/core.js');
const { createMockChrome } = require('./mock-chrome.js');
const { createEngine } = require('../../lib/engine.js');

const silent = { error() {}, warn() {}, log() {} };
const POPUP_SENDER = { url: 'chrome-extension://test-extension-id/popup.html' };
const contentSender = (tabId = 1, url = 'http://example.test/') => ({ tab: { id: tabId, url }, url });

function fakeScreenshots() {
  const items = new Map();
  let counter = 0;
  return {
    items,
    put: async (record) => {
      counter += 1;
      const entry = {
        ...record,
        id: record.id || 'shot-' + counter,
        bytes: Math.ceil(record.dataUrl.length * 0.75)
      };
      items.set(entry.id, entry);
      return { ...entry, dataUrl: undefined };
    },
    listBySession: async (sessionId) => [...items.values()].filter((item) => item.sessionId === sessionId),
    getById: async (id) => items.get(id) || null,
    deleteById: async (id) => items.delete(id),
    deleteBySession: async (sessionId) => {
      for (const [id, item] of [...items.entries()]) if (item.sessionId === sessionId) items.delete(id);
    },
    usage: async () => ({ count: items.size, bytes: [...items.values()].reduce((sum, item) => sum + item.bytes, 0), maxEntries: 20, maxBytes: 40 * 1024 * 1024 })
  };
}

function setup(options = {}) {
  const mock = createMockChrome(options.mock || {});
  mock.addTab({ id: 1, url: 'http://example.test/', title: 'Example page' });
  let clock = Date.parse('2026-01-01T00:00:00.000Z');
  const screenshots = fakeScreenshots();
  const engine = createEngine({
    chrome: mock.chrome,
    now: () => clock,
    logger: silent,
    screenshots
  });
  return {
    mock,
    engine,
    screenshots,
    now: () => clock,
    advance(ms) { clock += ms; }
  };
}

function refreshConfig(overrides = {}) {
  return {
    mode: 'refresh',
    intervalSeconds: 2,
    cycleMode: 'continuous',
    reloadsPerCycle: 5,
    pauseSeconds: 10,
    autoRefresh: true,
    ...overrides
  };
}

function monitorConfig(overrides = {}) {
  return {
    mode: 'monitor',
    intervalSeconds: 10,
    autoRefresh: false,
    text: { enabled: false, condition: 'appears', pattern: '', regex: false },
    dom: { enabled: false, selector: '', condition: 'appears', expectedText: '' },
    url: { enabled: false, expectedUrl: '', ignoreHash: true },
    http: { enabled: true },
    timing: { enabled: true, budgetMs: 5000 },
    ...overrides
  };
}

async function start(engine, config, tabId = 1) {
  return engine.handleMessage({ type: 'START_SESSION', tabId, config }, POPUP_SENDER);
}

function sessionRecord(mock, sessionId) {
  return (mock.storage.local.store.qaSessions || {})[sessionId] || null;
}

function eventsFor(mock, sessionId) {
  return mock.storage.local.store['qaEvents:' + sessionId] || [];
}

function lastEvent(mock, sessionId) {
  const events = eventsFor(mock, sessionId);
  return events[events.length - 1] || null;
}

test('start creates a refresh session, alarm and honest UNKNOWN HTTP status', async () => {
  const { mock, engine } = setup();
  const response = await start(engine, refreshConfig());
  assert.equal(response.ok, true);
  assert.equal(response.state.mode, 'refresh');
  assert.equal(response.state.nextActionAt, Date.parse('2026-01-01T00:00:02.000Z'));
  assert.equal(mock.alarms.has('odesoftami:watchdog'), true);
  assert.equal(mock.badges.text[1], '2');

  const session = sessionRecord(mock, response.session.id);
  assert.equal(session.status, 'active');
  const events = eventsFor(mock, session.id);
  assert.equal(events.length, 2);
  assert.equal(events[0].eventType, 'session_start');
  assert.equal(events[1].eventType, 'http_status');
  assert.equal(events[1].result, 'UNKNOWN');
  assert.equal(events[1].httpStatus, null);
  assert.match(events[1].reason, /already loaded/);

  const state = await engine.getState(1);
  assert.equal(state.stats.totalChecks, 1);
});

test('start validation rejects fast intervals, restricted tabs and duplicate sessions', async () => {
  const { mock, engine } = setup();
  mock.addTab({ id: 2, url: 'chrome://extensions/' });
  const fast = await start(engine, refreshConfig({ intervalSeconds: 1 }));
  assert.equal(fast.ok, false);
  assert.match(fast.error, /at least 2 seconds/);

  const restricted = await start(engine, refreshConfig(), 2);
  assert.equal(restricted.ok, false);
  assert.match(restricted.error, /HTTP or HTTPS/);

  const first = await start(engine, refreshConfig());
  assert.equal(first.ok, true);
  const second = await start(engine, refreshConfig());
  assert.equal(second.ok, false);
  assert.match(second.error, /already active/);
});

test('content scripts cannot start sessions', async () => {
  const { engine } = setup();
  const response = await engine.handleMessage(
    { type: 'START_SESSION', tabId: 1, config: refreshConfig() },
    contentSender(1)
  );
  assert.equal(response.ok, false);
  assert.match(response.error, /not allowed from a content script/);
});

test('stop records a stop reason, clears the badge and watchdog', async () => {
  const { mock, engine } = setup();
  const started = await start(engine, refreshConfig());
  await engine.handleMessage({ type: 'STOP_SESSION', tabId: 1, reason: 'user' }, POPUP_SENDER);
  const session = sessionRecord(mock, started.session.id);
  assert.equal(session.status, 'stopped');
  assert.equal(session.stopReason, 'user');
  assert.equal(mock.alarms.has('odesoftami:watchdog'), false);
  assert.equal(mock.badges.text[1], '');
  const stop = lastEvent(mock, session.id);
  assert.equal(stop.eventType, 'session_stop');
  assert.match(stop.description, /Stopped by user/);
  const state = await engine.getState(1);
  assert.equal(state.state, null);
  assert.equal(state.session.status, 'stopped');
});

test('cycle refresh advances active, pause and active phases exactly once per due time', async () => {
  const { mock, engine, advance } = setup();
  const started = await start(engine, refreshConfig({ intervalSeconds: 2, cycleMode: 'cycles', reloadsPerCycle: 2, pauseSeconds: 5 }));
  assert.equal(started.ok, true);

  advance(2000);
  let response = await engine.handleMessage({ type: 'REFRESH_DUE' }, contentSender(1));
  assert.equal(response.ok, true);
  assert.equal(mock.reloadCalls.length, 1);
  let state = (await engine.getState(1)).state;
  assert.equal(state.phase, 'active');
  assert.equal(state.reloadsInCycle, 1);
  assert.equal(state.nextActionAt, Date.parse('2026-01-01T00:00:04.000Z'));

  advance(2000);
  response = await engine.handleMessage({ type: 'REFRESH_DUE' }, contentSender(1));
  assert.equal(response.ok, true);
  assert.equal(mock.reloadCalls.length, 2);
  state = (await engine.getState(1)).state;
  assert.equal(state.phase, 'pause');
  assert.equal(state.reloadsInCycle, 2);
  assert.equal(state.nextActionAt, Date.parse('2026-01-01T00:00:09.000Z'));

  advance(5000);
  response = await engine.handleMessage({ type: 'REFRESH_DUE' }, contentSender(1));
  assert.equal(response.ok, true);
  assert.equal(mock.reloadCalls.length, 3);
  state = (await engine.getState(1)).state;
  assert.equal(state.phase, 'active');
  assert.equal(state.reloadsInCycle, 1);
  assert.equal(state.nextActionAt, Date.parse('2026-01-01T00:00:11.000Z'));
});

test('refresh due requests are not executed early or twice', async () => {
  const { mock, engine, advance } = setup();
  await start(engine, refreshConfig());
  advance(1000);
  const early = await engine.handleMessage({ type: 'REFRESH_DUE' }, contentSender(1));
  assert.equal(early.ok, false);
  assert.equal(mock.reloadCalls.length, 0);

  advance(1000);
  const first = await engine.handleMessage({ type: 'REFRESH_DUE' }, contentSender(1));
  assert.equal(first.ok, true);
  const second = await engine.handleMessage({ type: 'REFRESH_DUE' }, contentSender(1));
  assert.equal(second.ok, false);
  assert.equal(mock.reloadCalls.length, 1);
});

test('monitor mode never reloads and exposes a QA badge', async () => {
  const { mock, engine } = setup();
  const started = await start(engine, monitorConfig());
  assert.equal(started.ok, true);
  assert.equal(started.state.isReloading, false);
  assert.equal(started.state.nextActionAt, null);
  assert.equal(mock.alarms.has('odesoftami:watchdog'), false);
  assert.equal(mock.badges.text[1], 'QA');
  const due = await engine.handleMessage({ type: 'REFRESH_DUE' }, contentSender(1));
  assert.equal(due.ok, false);
  assert.equal(mock.reloadCalls.length, 0);
});

test('navigation handlers record 200, 404, 500, redirects and failures honestly', async () => {
  const { mock, engine, advance } = setup();
  const config = monitorConfig({
    url: { enabled: true, expectedUrl: 'http://example.test/ok', ignoreHash: true },
    stopOnFailure: false
  });
  const started = await start(engine, config);
  const sessionId = started.session.id;
  const base = {
    tabId: 1, frameId: 0, url: 'http://example.test/ok', transitionType: 'typed',
    transitionQualifiers: [], timeStamp: Date.parse('2026-01-01T00:00:01.000Z')
  };

  await engine.handleBeforeNavigate(base);
  await engine.handleCompleted({ ...base, statusCode: 200, fromCache: false });
  let events = eventsFor(mock, sessionId);
  let nav = events.filter((event) => event.eventType === 'navigation').pop();
  assert.equal(nav.result, 'PASS');
  assert.equal(nav.httpStatus, 200);
  assert.equal(nav.description.includes('HTTP 200'), true);

  advance(3000);
  await engine.handleBeforeNavigate({ ...base, url: 'http://example.test/missing' });
  await engine.handleCompleted({ ...base, url: 'http://example.test/missing', statusCode: 404 });
  advance(3000);
  await engine.handleBeforeNavigate({ ...base, url: 'http://example.test/error' });
  await engine.handleCompleted({ ...base, url: 'http://example.test/error', statusCode: 500 });
  events = eventsFor(mock, sessionId);
  nav = events.filter((event) => event.eventType === 'navigation' && event.httpStatus === 404).pop();
  assert.equal(nav.result, 'FAIL');
  const urlFail = events.filter((event) => event.eventType === 'url_check' && event.result === 'FAIL').pop();
  assert.ok(urlFail);
  assert.equal(urlFail.expectedValue, 'http://example.test/ok');
  nav = events.filter((event) => event.eventType === 'navigation' && event.httpStatus === 500).pop();
  assert.equal(nav.result, 'FAIL');

  advance(3000);
  await engine.handleBeforeRedirect({
    tabId: 1, frameId: 0, url: 'http://example.test/ok',
    redirectUrl: 'http://example.test/elsewhere', statusCode: 302,
    timeStamp: Date.parse('2026-01-01T00:00:10.000Z')
  });
  events = eventsFor(mock, sessionId);
  const redirect = events.filter((event) => event.eventType === 'redirect').pop();
  assert.ok(redirect);
  assert.equal(redirect.result, 'WARN');
  assert.equal(redirect.actualValue, 'http://example.test/elsewhere');

  advance(3000);
  await engine.handleErrorOccurred({
    tabId: 1, frameId: 0, url: 'http://example.test/ok',
    error: 'net::ERR_CONNECTION_REFUSED', timeStamp: Date.parse('2026-01-01T00:00:13.000Z')
  });
  events = eventsFor(mock, sessionId);
  const failure = events.filter((event) => event.eventType === 'navigation_error').pop();
  assert.equal(failure.result, 'FAIL');
  assert.match(failure.reason, /ERR_CONNECTION_REFUSED/);

  advance(3000);
  await engine.handleCompleted({ ...base, url: 'http://example.test/ok', statusCode: 0 });
  events = eventsFor(mock, sessionId);
  nav = events.filter((event) => event.eventType === 'navigation' && event.httpStatus === null).pop();
  assert.equal(nav.result, 'UNKNOWN');
});

test('HTTP status events are associated with the correct tab and stop after the session stops', async () => {
  const { mock, engine } = setup();
  mock.addTab({ id: 2, url: 'http://example.test/two', title: 'Two' });
  const first = await start(engine, monitorConfig({ url: { enabled: false }, http: { enabled: true } }));
  const second = await start(engine, monitorConfig({ url: { enabled: false }, http: { enabled: true } }), 2);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  await engine.handleCompleted({
    tabId: 2, frameId: 0, url: 'http://example.test/two/missing', statusCode: 404,
    timeStamp: Date.parse('2026-01-01T00:00:02.000Z'), type: 'main_frame'
  });
  const firstEvents = eventsFor(mock, first.session.id);
  const secondEvents = eventsFor(mock, second.session.id);
  assert.equal(firstEvents.some((event) => event.eventType === 'navigation' && event.httpStatus === 404), false);
  assert.equal(secondEvents.some((event) => event.eventType === 'navigation' && event.httpStatus === 404), true);
  assert.ok(secondEvents.every((event) => event.tabId === 2));

  await engine.handleMessage({ type: 'STOP_SESSION', tabId: 2, reason: 'user' }, POPUP_SENDER);
  const countAfterStop = eventsFor(mock, second.session.id).length;
  await engine.handleCompleted({
    tabId: 2, frameId: 0, url: 'http://example.test/two/error', statusCode: 500,
    timeStamp: Date.parse('2026-01-01T00:00:03.000Z'), type: 'main_frame'
  });
  assert.equal(eventsFor(mock, second.session.id).length, countAfterStop, 'events were collected after stop');
  assert.equal(eventsFor(mock, second.session.id).some((event) => event.httpStatus === 500), false);
});

test('concurrent baseline and watcher results are not lost', async () => {
  const { mock, engine } = setup();
  const started = await start(engine, monitorConfig({
    text: { enabled: true, condition: 'appears', pattern: 'READY' },
    dom: { enabled: true, selector: '???', condition: 'appears', expectedText: '' },
    url: { enabled: false }, timing: { enabled: false }
  }));
  const sender = contentSender(1);
  await Promise.all([
    engine.handleMessage({ type: 'MONITOR_BASELINE', url: 'http://example.test/', found: true, textLength: 5, domPresent: false, domTextLength: 0, readyState: 'complete' }, sender),
    engine.handleMessage({
      type: 'CHECK_RESULT',
      checks: [{ type: 'dom', result: 'FAIL', matched: false, actual: 'Monitoring failed', reason: 'The configured CSS selector is invalid.', description: 'DOM element — FAIL — invalid selector' }]
    }, sender)
  ]);
  const events = eventsFor(mock, started.session.id);
  assert.ok(events.some((event) => event.eventType === 'baseline'), 'baseline event was lost');
  assert.ok(events.some((event) => event.eventType === 'dom_check' && event.result === 'FAIL'), 'watcher event was lost');
});

test('redirect event exposes the redirect status when webRequest provides it', async () => {
  const { mock, engine } = setup();
  const started = await start(engine, monitorConfig({
    url: { enabled: true, expectedUrl: 'http://example.test/ok', ignoreHash: true }
  }));
  await engine.handleBeforeRedirect({
    tabId: 1, frameId: 0, type: 'main_frame', url: 'http://example.test/ok',
    redirectUrl: 'http://example.test/new', statusCode: 302,
    timeStamp: Date.parse('2026-01-01T00:00:02.000Z')
  });
  const redirect = eventsFor(mock, started.session.id).find((event) => event.eventType === 'redirect');
  assert.ok(redirect);
  assert.equal(redirect.httpStatus, 302);
  assert.equal(redirect.result, 'WARN');
  assert.equal(redirect.actualValue, 'http://example.test/new');
});

test('a missing HTTP status is recorded as UNKNOWN, never as 200', async () => {
  const { mock, engine } = setup();
  const started = await start(engine, monitorConfig({ url: { enabled: false }, http: { enabled: true } }));
  await engine.handleCompleted({
    tabId: 1, frameId: 0, type: 'main_frame', url: 'http://example.test/unknown',
    timeStamp: Date.parse('2026-01-01T00:00:02.000Z')
  });
  const nav = eventsFor(mock, started.session.id).find((event) => event.eventType === 'navigation');
  assert.ok(nav);
  assert.equal(nav.result, 'UNKNOWN');
  assert.equal(nav.httpStatus, null);
  assert.match(nav.reason, /did not expose|unavailable/i);
});

test('configured stop-on-failure stops the session after a 404', async () => {
  const { mock, engine } = setup();
  const started = await start(engine, monitorConfig({ stopOnFailure: true, http: { enabled: true } }));
  await engine.handleCompleted({
    tabId: 1, frameId: 0, url: 'http://example.test/gone', statusCode: 404,
    timeStamp: Date.parse('2026-01-01T00:00:02.000Z'), transitionQualifiers: [], transitionType: 'typed'
  });
  const session = sessionRecord(mock, started.session.id);
  assert.equal(session.status, 'stopped');
  assert.equal(session.stopReason, 'failure_condition');
  assert.equal(lastEvent(mock, session.id).eventType, 'session_stop');
});

test('text checks are deduplicated, notified on transitions and can stop the session', async () => {
  const { mock, engine, advance } = setup();
  const started = await start(engine, monitorConfig({
    text: { enabled: true, condition: 'absent', pattern: 'Error', regex: false },
    notifyOnFailure: true,
    stopOnFailure: false,
    notifyOnMatch: true
  }));
  const sessionId = started.session.id;
  const sender = contentSender(1);
  const pass = {
    type: 'CHECK_RESULT',
    checks: [{
      type: 'text', result: 'PASS', matched: true, actual: 'Text not found',
      reason: 'Text is absent as expected.', description: 'Text condition — PASS — text absent',
      url: 'http://example.test/'
    }]
  };
  await engine.handleMessage(pass, sender);
  await engine.handleMessage(pass, sender);
  let events = eventsFor(mock, sessionId).filter((event) => event.eventType === 'text_check');
  assert.equal(events.length, 1, 'identical evaluation inside the dedupe window is ignored');
  assert.equal(mock.notifications.length, 1, 'matched transition notifies once');

  advance(60000);
  await engine.handleMessage(pass, sender);
  assert.equal(mock.notifications.length, 1, 'unchanged matched condition does not notify again');

  advance(60000);
  await engine.handleMessage({
    type: 'CHECK_RESULT',
    checks: [{
      type: 'text', result: 'FAIL', matched: false, actual: 'Text found',
      reason: 'Text was expected to be absent but was found.', description: 'Text condition — FAIL — error visible',
      url: 'http://example.test/'
    }]
  }, sender);
  events = eventsFor(mock, sessionId).filter((event) => event.eventType === 'text_check');
  assert.equal(events[events.length - 1].result, 'FAIL');
  assert.equal(mock.notifications.length, 2, 'failure transition notifies');

  advance(10000);
  await engine.handleMessage({
    type: 'CHECK_RESULT',
    checks: [{
      type: 'text', result: 'FAIL', matched: false, actual: 'Text found',
      reason: 'Text was expected to be absent but was found.', description: 'Text condition — FAIL — error visible',
      url: 'http://example.test/'
    }]
  }, sender);
  assert.equal(mock.notifications.length, 2, 'unchanged failure does not notify again');
});

test('stopOnMatch and notifyOnMatch apply only to the text condition', async () => {
  const { mock, engine } = setup();
  const started = await start(engine, monitorConfig({
    url: { enabled: true, expectedUrl: 'http://example.test/', ignoreHash: true },
    notifyOnMatch: true,
    stopOnMatch: true,
    stopOnFailure: false
  }));
  await engine.handleMessage({
    type: 'CHECK_RESULT',
    checks: [{
      type: 'url', result: 'PASS', matched: true, actual: 'http://example.test/',
      reason: 'URL matches', description: 'URL validation — PASS'
    }]
  }, contentSender(1));
  assert.equal(sessionRecord(mock, started.session.id).status, 'active', 'URL PASS must not stop the session');
  assert.equal(mock.notifications.length, 0, 'URL PASS must not notify as a text match');

  await engine.handleMessage({
    type: 'CHECK_RESULT',
    checks: [{
      type: 'text', result: 'PASS', matched: true, actual: 'Text found',
      reason: 'Expected text found', description: 'Text condition — PASS'
    }]
  }, contentSender(1));
  const session = sessionRecord(mock, started.session.id);
  assert.equal(session.status, 'stopped');
  assert.equal(session.stopReason, 'condition_met');
  assert.equal(mock.notifications.length, 1);
});

test('stopOnFailure ends a monitor session on a failed DOM check', async () => {
  const { mock, engine } = setup();
  const started = await start(engine, monitorConfig({
    dom: { enabled: true, selector: '.status', condition: 'appears', expectedText: '' },
    stopOnFailure: true
  }));
  await engine.handleMessage({
    type: 'CHECK_RESULT',
    checks: [{
      type: 'dom', result: 'FAIL', matched: false, actual: 'Element not found',
      reason: 'Selector not found.', description: 'DOM element — FAIL — selector not found',
      url: 'http://example.test/'
    }]
  }, contentSender(1));
  const session = sessionRecord(mock, started.session.id);
  assert.equal(session.status, 'stopped');
  assert.equal(session.stopReason, 'failure_condition');
  assert.ok(eventsFor(mock, session.id).some((event) => event.eventType === 'screenshot_skipped') === false);
});

test('load timing distinguishes PASS, WARN, UNKNOWN and historical data', async () => {
  const { mock, engine, advance } = setup();
  const started = await start(engine, monitorConfig({ url: { enabled: false }, timing: { enabled: true, budgetMs: 5000 } }));
  const sessionId = started.session.id;
  const base = {
    type: 'LOAD_TIMING', url: 'http://example.test/', state: 'complete', readyState: 'complete',
    navigationStart: Date.parse('2026-01-01T00:00:00.500Z')
  };
  await engine.handleMessage({ ...base, durationMs: 820, domContentLoadedMs: 200, loadEventMs: 820 }, contentSender(1));
  let loads = eventsFor(mock, sessionId).filter((event) => event.eventType === 'page_load');
  assert.equal(loads.pop().result, 'PASS');

  advance(2000);
  await engine.handleMessage({ ...base, navigationStart: Date.parse('2026-01-01T00:00:02.500Z'), durationMs: 6200, domContentLoadedMs: 500, loadEventMs: 6200 }, contentSender(1));
  loads = eventsFor(mock, sessionId).filter((event) => event.eventType === 'page_load');
  assert.equal(loads.pop().result, 'WARN');

  advance(2000);
  await engine.handleMessage({ ...base, navigationStart: Date.parse('2026-01-01T00:00:04.500Z'), durationMs: null, domContentLoadedMs: null, loadEventMs: null, state: 'unavailable', readyState: 'loading' }, contentSender(1));
  loads = eventsFor(mock, sessionId).filter((event) => event.eventType === 'page_load');
  assert.equal(loads.pop().result, 'UNKNOWN');

  advance(2000);
  await engine.handleMessage({ ...base, navigationStart: Date.parse('2025-12-31T23:59:00.000Z'), durationMs: 900, domContentLoadedMs: 100, loadEventMs: 900 }, contentSender(1));
  loads = eventsFor(mock, sessionId).filter((event) => event.eventType === 'page_load');
  const historical = loads.pop();
  assert.equal(historical.result, 'UNKNOWN');
  assert.match(historical.reason, /before the session started/);
  assert.equal(historical.loadDurationMs, null, 'historical timing must not be averaged as a session measurement');
});

test('watchdog skips long missed windows and then resumes the schedule', async () => {
  const { mock, engine, advance, now } = setup();
  await start(engine, refreshConfig());
  advance(200000);
  await engine.handleWatchdog();
  assert.equal(mock.reloadCalls.length, 0, 'watchdog must not fire a reload storm after a long gap');
  const events = eventsFor(mock, Object.keys(mock.storage.local.store.qaSessions)[0]);
  assert.ok(events.some((event) => event.eventType === 'reload_failed' && event.result === 'WARN'));
  const state = (await engine.getState(1)).state;
  assert.ok(state.nextActionAt > now());
  advance(2000);
  await engine.handleWatchdog();
  assert.equal(mock.reloadCalls.length, 1);
});

test('content script injection recovers when the tab has no content listener', async () => {
  const { mock, engine } = setup({ mock: { messageError: 'Could not establish connection. Receiving end does not exist.' } });
  const started = await start(engine, monitorConfig({ url: { enabled: false } }));
  assert.equal(started.ok, true);
  assert.ok(mock.scriptCalls.length >= 1, 'scripting.executeScript was not used as a fallback');
  assert.equal(mock.scriptCalls[0].files[0], 'refresh-content.js');
  assert.equal((await engine.getState(1)).state.status, 'active');
});

test('closing a tab finalizes the session with tab_closed', async () => {
  const { mock, engine } = setup();
  const started = await start(engine, refreshConfig());
  await engine.handleTabRemoved(1);
  const session = sessionRecord(mock, started.session.id);
  assert.equal(session.status, 'stopped');
  assert.equal(session.stopReason, 'tab_closed');
  assert.equal(mock.alarms.has('odesoftami:watchdog'), false);
});

test('service worker suspension keeps the active session; lost runtime state finalizes it', async () => {
  const { mock, engine } = setup();
  const started = await start(engine, refreshConfig());
  const engine2 = createEngine({ chrome: mock.chrome, now: () => Date.parse('2026-01-01T00:00:01.000Z'), logger: silent, screenshots: fakeScreenshots() });
  const state = await engine2.getState(1);
  assert.equal(state.state.sessionId, started.session.id);
  assert.equal(state.session.status, 'active');

  await mock.storage.session.clear();
  const engine3 = createEngine({ chrome: mock.chrome, now: () => Date.parse('2026-01-01T00:00:02.000Z'), logger: silent, screenshots: fakeScreenshots() });
  const sessions = await engine3.getSessions();
  const session = sessions.sessions.find((item) => item.id === started.session.id);
  assert.equal(session.status, 'stopped');
  assert.equal(session.stopReason, 'service_worker_reset');
});

test('bounded history trims old events and records dropped counts', async () => {
  const { mock, engine, advance } = setup();
  await engine.saveSettings({ historyLimit: 50 });
  const started = await start(engine, monitorConfig({ text: { enabled: true, condition: 'absent', pattern: 'Error' }, url: { enabled: false } }));
  const sessionId = started.session.id;
  for (let i = 0; i < 70; i += 1) {
    advance(3000);
    await engine.handleMessage({
      type: 'CHECK_RESULT',
      checks: [{
        type: 'text', result: 'PASS', matched: true, actual: 'Text not found',
        reason: 'Text is absent as expected.', description: 'Text condition — PASS',
        url: 'http://example.test/'
      }]
    }, contentSender(1));
  }
  const events = eventsFor(mock, sessionId);
  assert.equal(events.length, 50);
  assert.equal(sessionRecord(mock, sessionId).eventCount, 50);
  assert.ok(sessionRecord(mock, sessionId).droppedEvents > 0);
});

test('quota errors are caught and surfaced instead of crashing monitoring', async () => {
  const { mock, engine } = setup({ mock: { quotaBytes: 2500 } });
  const started = await start(engine, monitorConfig({ url: { enabled: false } }));
  assert.equal(started.ok, true);
  await engine.handleMessage({
    type: 'CHECK_RESULT',
    checks: [{ type: 'text', result: 'PASS', matched: true, actual: 'found', reason: 'ok', description: 'Text condition — PASS' }]
  }, contentSender(1));
  const diagnostics = await engine.getDiagnostics();
  assert.ok(diagnostics.storageWarning);
  assert.match(diagnostics.storageWarning, /storage is full|Local storage/i);
});

test('v2.3 legacy logs are migrated into a bounded imported session', async () => {
  const { mock, engine } = setup();
  mock.storage.local.store.qaLogs = {
    5: [
      { time: '2026-01-01T00:00:00.000Z', event: 'Monitoring started', url: 'https://legacy.test/', title: 'Legacy' },
      { time: '2026-01-01T00:00:05.000Z', event: 'Reload requested', url: 'https://legacy.test/', phase: 'active' }
    ]
  };
  const engine2 = createEngine({ chrome: mock.chrome, now: () => Date.parse('2026-01-02T00:00:00.000Z'), logger: silent, screenshots: fakeScreenshots() });
  const response = await engine2.getSessions();
  const imported = response.sessions.find((session) => session.id === 'legacy-v2.3.0');
  assert.ok(imported);
  assert.equal(imported.importedFrom, '2.3.0');
  assert.equal(imported.status, 'stopped');
  const events = eventsFor(mock, 'legacy-v2.3.0');
  assert.equal(events.length, 2);
  assert.equal(events[0].eventType, 'legacy_event');
  assert.equal(mock.storage.local.store.qaLogsV2Backup['5'].length, 2);
  assert.equal(mock.storage.local.store.qaLogs, undefined);
});

test('preset CRUD and import validation are bounded and safe', async () => {
  const { engine } = setup();
  const save = await engine.handleMessage({
    type: 'SAVE_PRESET',
    preset: {
      name: 'Smoke check', description: 'QA smoke', mode: 'qa',
      config: { mode: 'qa', intervalSeconds: 30, url: { enabled: true, expectedUrl: 'https://example.com/' } }
    }
  }, POPUP_SENDER);
  assert.equal(save.ok, true);
  const presetId = save.preset.id;
  let presets = await engine.handleMessage({ type: 'GET_PRESETS' }, POPUP_SENDER);
  assert.equal(presets.presets.length, 1);
  assert.equal(presets.builtins.length, 4);

  const update = await engine.handleMessage({
    type: 'SAVE_PRESET',
    preset: { id: presetId, name: 'Smoke check renamed', mode: 'qa', config: { mode: 'qa', intervalSeconds: 45 } }
  }, POPUP_SENDER);
  assert.equal(update.ok, true);
  assert.equal(update.preset.id, presetId);
  assert.equal(update.preset.name, 'Smoke check renamed');

  const invalidImport = await engine.handleMessage({
    type: 'IMPORT_PRESETS',
    json: JSON.stringify({ presets: [
      { name: 'Good', mode: 'monitor', config: { mode: 'monitor' } },
      { name: 'Bad', mode: 'refresh', config: { mode: 'refresh', intervalSeconds: 1 } },
      { name: 'Bad regex', mode: 'monitor', config: { mode: 'monitor', text: { enabled: true, pattern: 'x(', regex: true } } }
    ] })
  }, POPUP_SENDER);
  assert.equal(invalidImport.ok, true);
  assert.equal(invalidImport.imported, 1);
  assert.equal(invalidImport.errors.length, 2);

  const deleted = await engine.handleMessage({ type: 'DELETE_PRESET', id: presetId }, POPUP_SENDER);
  assert.equal(deleted.ok, true);
  presets = await engine.handleMessage({ type: 'GET_PRESETS' }, POPUP_SENDER);
  assert.equal(presets.presets.length, 1);
});

test('opt-in screenshots are stored locally and skipped for background tabs', async () => {
  const { mock, engine, screenshots, advance } = setup({ mock: { captureDataUrl: 'data:image/jpeg;base64,AAAA' } });
  const started = await start(engine, monitorConfig({
    text: { enabled: true, condition: 'absent', pattern: 'Error' },
    screenshotOnFailure: true,
    url: { enabled: false }
  }));
  await engine.handleMessage({
    type: 'CHECK_RESULT',
    checks: [{ type: 'text', result: 'FAIL', matched: false, actual: 'Text found', reason: 'Error found', description: 'Text condition — FAIL' }]
  }, contentSender(1));
  assert.equal(screenshots.items.size, 1);
  assert.equal(sessionRecord(mock, started.session.id).screenshotCount, 1);
  assert.ok(eventsFor(mock, started.session.id).some((event) => event.eventType === 'screenshot'));

  mock.tabs.get = async () => ({ id: 1, url: 'http://example.test/', active: false, windowId: 1 });
  advance(20000);
  await engine.handleMessage({
    type: 'CHECK_RESULT',
    checks: [{ type: 'text', result: 'FAIL', matched: false, actual: 'Text found', reason: 'Error found', description: 'Text condition — FAIL' }]
  }, contentSender(1));
  const skipped = eventsFor(mock, started.session.id).filter((event) => event.eventType === 'screenshot_skipped').pop();
  assert.ok(skipped);
  assert.match(skipped.reason, /not active/);
});

test('floating panel data matches the existing session and survives stop', async () => {
  const { mock, engine } = setup();
  const started = await start(engine, monitorConfig({
    text: { enabled: true, condition: 'absent', pattern: 'Error' },
    url: { enabled: false }, timing: { enabled: true, budgetMs: 5000 }
  }));
  const sender = contentSender(1);
  await engine.handleMessage({
    type: 'CHECK_RESULT',
    checks: [{ type: 'text', result: 'FAIL', matched: false, actual: 'Text found', reason: 'Error found', description: 'Text condition — FAIL' }]
  }, sender);
  const live = await engine.handleMessage({ type: 'GET_PANEL_DATA' }, sender);
  assert.equal(live.ok, true);
  assert.equal(live.panel.sessionId, started.session.id);
  assert.equal(live.panel.active, true);
  assert.equal(live.panel.counts.fail, 1);
  assert.equal(live.panel.counts.pass, 0);

  const saved = await engine.handleMessage({
    type: 'SAVE_PANEL_PREFS', position: { x: 321, y: 123 }, collapsed: true
  }, sender);
  assert.equal(saved.ok, true);
  const withPrefs = await engine.handleMessage({ type: 'GET_PANEL_DATA' }, sender);
  assert.deepEqual(withPrefs.prefs.position, { x: 321, y: 123 });
  assert.equal(withPrefs.prefs.collapsed, true);

  await engine.handleMessage({ type: 'PANEL_STOP_SESSION' }, sender);
  const final = await engine.handleMessage({ type: 'GET_PANEL_DATA' }, sender);
  assert.equal(final.panel.active, false);
  assert.equal(final.panel.status, 'stopped');
  assert.equal(final.panel.stopReason, 'user');
  assert.equal(final.panel.counts.fail, 1);
});

test('opening the dashboard from the panel does not create a session', async () => {
  const { mock, engine } = setup();
  await start(engine, monitorConfig({ url: { enabled: false } }));
  const before = (await engine.getSessions()).sessions.length;
  const response = await engine.handleMessage({ type: 'OPEN_DASHBOARD' }, contentSender(1));
  assert.equal(response.ok, true);
  assert.equal(mock.createCalls.length, 1);
  assert.match(mock.createCalls[0].url, /dashboard\.html\?session=/);
  assert.equal((await engine.getSessions()).sessions.length, before);
});

test('clear history preserves screenshots and active sessions', async () => {
  const { mock, engine, screenshots } = setup();
  const active = await start(engine, monitorConfig({ url: { enabled: false } }));
  await screenshots.put({
    sessionId: active.session.id,
    timestamp: '2026-01-01T00:00:01.000Z',
    url: 'http://example.test/',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo='
  });
  const first = sessionRecord(mock, active.session.id);
  assert.ok(first);
  await engine.handleMessage({ type: 'CLEAR_HISTORY' }, POPUP_SENDER);
  assert.ok(sessionRecord(mock, active.session.id), 'active session was removed');
  assert.equal((await screenshots.listBySession(active.session.id)).length, 1, 'screenshots were deleted by history clear');
  assert.ok((await engine.getSessions()).sessions.some((session) => session.id === active.session.id));
});

test('session deletion and history clearing preserve active sessions', async () => {
  const { mock, engine } = setup();
  const first = await start(engine, refreshConfig());
  await engine.handleMessage({ type: 'STOP_SESSION', tabId: 1, reason: 'user' }, POPUP_SENDER);
  await engine.handleMessage({ type: 'DELETE_SESSION', sessionId: first.session.id }, POPUP_SENDER);
  assert.equal(sessionRecord(mock, first.session.id), null);
  assert.equal(eventsFor(mock, first.session.id).length, 0);

  const second = await start(engine, refreshConfig());
  mock.addTab({ id: 3, url: 'http://example.test/3' });
  const third = await start(engine, refreshConfig(), 3);
  const cleared = await engine.handleMessage({ type: 'CLEAR_HISTORY' }, POPUP_SENDER);
  assert.equal(cleared.ok, true);
  assert.ok(sessionRecord(mock, second.session.id));
  assert.ok(sessionRecord(mock, third.session.id));
});

test('installed update stops active sessions with a clear reason', async () => {
  const { mock, engine } = setup();
  const started = await start(engine, refreshConfig());
  await engine.handleInstalled({ reason: 'update' });
  const session = sessionRecord(mock, started.session.id);
  assert.equal(session.status, 'stopped');
  assert.equal(session.stopReason, 'extension_updated');
});

test('legacy GET_QA_LOGS returns a v2.3-shaped event list', async () => {
  const { engine } = setup();
  const started = await start(engine, monitorConfig({ url: { enabled: false } }));
  await engine.handleMessage({
    type: 'CHECK_RESULT',
    checks: [{ type: 'text', result: 'PASS', matched: true, actual: 'found', reason: 'ok', description: 'Text condition — PASS' }]
  }, contentSender(1));
  const response = await engine.handleMessage({ type: 'GET_QA_LOGS', tabId: 1 }, POPUP_SENDER);
  assert.equal(response.ok, true);
  assert.ok(response.logs.length >= 2);
  const entry = response.logs.find((item) => item.type === 'text_check');
  assert.ok(entry);
  assert.equal(entry.event, 'Text condition — PASS');
  assert.ok(entry.time);
  assert.equal(started.session.id, entry.sessionId === undefined ? started.session.id : entry.sessionId);
});

test('two tabs can run independent sessions', async () => {
  const { mock, engine } = setup();
  mock.addTab({ id: 2, url: 'http://example.test/two' });
  const first = await start(engine, refreshConfig());
  const second = await start(engine, refreshConfig(), 2);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const sessions = await engine.getSessions();
  assert.equal(sessions.activeTabIds.length, 2);
  await engine.stopAllSessions('user');
  assert.equal((await engine.getSessions()).activeTabIds.length, 0);
});
