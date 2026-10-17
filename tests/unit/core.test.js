'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../lib/core.js');

const baseConfig = (overrides = {}) => ({
  mode: 'refresh',
  intervalSeconds: 5,
  cycleMode: 'continuous',
  reloadsPerCycle: 5,
  pauseSeconds: 10,
  ...overrides
});

test('interval validation enforces 2 seconds and 24 hours', () => {
  assert.equal(core.validateIntervalSeconds(1).ok, false);
  assert.equal(core.validateIntervalSeconds(2).ok, true);
  assert.equal(core.validateIntervalSeconds(86400).ok, true);
  assert.equal(core.validateIntervalSeconds(86401).ok, false);
  assert.equal(core.validateIntervalSeconds(2.5).ok, false);
  assert.equal(core.validateIntervalSeconds('10').value, 10);
});

test('cycle validation enforces bounds', () => {
  assert.equal(core.validateCycleSettings(1, 1).ok, true);
  assert.equal(core.validateCycleSettings(0, 1).ok, false);
  assert.equal(core.validateCycleSettings(1000, 86400).ok, true);
  assert.equal(core.validateCycleSettings(1001, 1).ok, false);
  assert.equal(core.validateCycleSettings(5, 0).ok, false);
});

test('regex validation catches invalid patterns safely', () => {
  assert.equal(core.validateRegexPattern('READY').ok, true);
  assert.equal(core.validateRegexPattern('READY(\\d+)').ok, true);
  const invalid = core.validateRegexPattern('READY(');
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /Invalid regular expression/);
});

test('selector validation separates syntax errors from a missing element', () => {
  assert.equal(core.validateSelectorShape('.status-message').ok, true);
  assert.equal(core.validateSelectorShape('   ').ok, false);
  assert.equal(core.validateSelectorWithDom({ querySelector: () => null }, '.missing').ok, true);
  const bad = core.validateSelectorWithDom({ querySelector: () => { throw new Error('invalid'); } }, '???');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Invalid CSS selector/);
});

test('strict config validation rejects unsafe or inconsistent settings', () => {
  const ok = core.validateConfig(baseConfig());
  assert.equal(ok.ok, true);
  assert.equal(ok.config.text.enabled, false);

  const tooFast = core.validateConfig(baseConfig({ intervalSeconds: 1 }));
  assert.equal(tooFast.ok, false);
  assert.match(tooFast.errors.join(' '), /at least 2 seconds/);

  const domInRefresh = core.validateConfig(baseConfig({ dom: { enabled: true, selector: '.x' } }));
  assert.equal(domInRefresh.ok, false);
  assert.match(domInRefresh.errors.join(' '), /Monitor and QA/);

  const monitorNoInterval = core.validateConfig({ mode: 'monitor', intervalSeconds: 1 });
  assert.equal(monitorNoInterval.ok, true);

  const qaNoRefresh = core.validateConfig({ mode: 'qa', autoRefresh: false, intervalSeconds: 1 });
  assert.equal(qaNoRefresh.ok, true);

  const badRegex = core.validateConfig(baseConfig({
    text: { enabled: true, condition: 'appears', pattern: 'x(', regex: true }
  }));
  assert.equal(badRegex.ok, false);

  const badUrl = core.validateConfig({ mode: 'monitor', url: { enabled: true, expectedUrl: 'javascript:alert(1)' } });
  assert.equal(badUrl.ok, false);

  const badSettle = core.validateConfig(baseConfig({ settleMs: 50 }));
  assert.equal(badSettle.ok, false);
});

test('floating panel settings are normalized with safe defaults', () => {
  const defaults = core.normalizeSettings({});
  assert.equal(defaults.floatingPanelEnabled, true);
  assert.equal(defaults.floatingPanelDefaultPosition, 'bottom-right');
  assert.equal(defaults.floatingPanelDefaultCollapsed, false);
  assert.equal(defaults.floatingPanelRetainSummary, true);
  const custom = core.normalizeSettings({
    floatingPanelEnabled: false,
    floatingPanelDefaultPosition: 'top-left',
    floatingPanelDefaultCollapsed: true,
    floatingPanelRetainSummary: false
  });
  assert.equal(custom.floatingPanelEnabled, false);
  assert.equal(custom.floatingPanelDefaultPosition, 'top-left');
  assert.equal(custom.floatingPanelDefaultCollapsed, true);
  assert.equal(custom.floatingPanelRetainSummary, false);
  const invalid = core.normalizeSettings({ floatingPanelDefaultPosition: 'middle' });
  assert.equal(invalid.floatingPanelDefaultPosition, 'bottom-right');
});

test('normalization bounds untrusted values and maps legacy conditions', () => {
  const config = core.normalizeConfig({
    mode: 'monitor',
    intervalSeconds: '999999',
    text: { enabled: true, condition: 'found', pattern: '  READY  ' },
    url: { enabled: true, expectedUrl: 'https://example.com/a#x' },
    settleMs: 99999,
    timing: { budgetMs: 999999 },
    extra: 'ignored'
  });
  assert.equal(config.mode, 'monitor');
  assert.equal(config.intervalSeconds, 10);
  assert.equal(config.text.condition, 'appears');
  assert.equal(config.text.pattern, 'READY');
  assert.equal(config.url.enabled, true);
  assert.equal(config.settleMs, 5000);
  assert.equal(config.timing.budgetMs, 60000);
  assert.equal(config.autoRefresh, false);

  const refresh = core.normalizeConfig({ mode: 'refresh', text: { pattern: 'ready', enabled: false } });
  assert.equal(refresh.text.enabled, true, 'legacy refresh text is enabled by a non-empty pattern');
  assert.equal(refresh.url.enabled, false);
  assert.equal(refresh.dom.enabled, false);
});

test('event factory uses nulls, bounded values and safe details', () => {
  const event = core.createEvent({
    eventType: 'text_check',
    result: 'FAIL',
    tabId: null,
    sessionId: '',
    url: '',
    expectedValue: '',
    actualValue: 'x'.repeat(900),
    httpStatus: 999,
    loadDurationMs: -1,
    reason: '',
    timestamp: '2026-01-02T03:04:05.000Z',
    details: {
      ok: true,
      nested: { deep: { deeper: { tooDeep: true } } },
      evil: 'x'.repeat(1000),
      'bad key!': 'dropped'
    }
  });
  assert.equal(event.tabId, null);
  assert.equal(event.sessionId, null);
  assert.equal(event.url, null);
  assert.equal(event.expectedValue, null);
  assert.equal(event.actualValue.length, 500);
  assert.equal(event.httpStatus, null);
  assert.equal(event.loadDurationMs, null);
  assert.equal(event.reason, null);
  assert.equal(event.result, 'FAIL');
  assert.equal(event.severity, 'error');
  assert.equal(event.isCheck, true);
  assert.equal(event.details.ok, true);
  assert.equal(event.details['bad key!'], undefined);
  assert.ok(event.description.length > 0);
});

test('stats count checks, not every informational event', () => {
  const events = [
    core.createEvent({ eventType: 'session_start', result: 'INFO', timestamp: '2026-01-01T00:00:00.000Z' }),
    core.createEvent({ eventType: 'navigation', result: 'PASS', httpStatus: 200, loadDurationMs: 800, timestamp: '2026-01-01T00:00:01.000Z' }),
    core.createEvent({ eventType: 'text_check', result: 'FAIL', timestamp: '2026-01-01T00:00:02.000Z', description: 'Text missing' }),
    core.createEvent({ eventType: 'dom_check', result: 'WARN', timestamp: '2026-01-01T00:00:03.000Z' }),
    core.createEvent({ eventType: 'page_load', result: 'UNKNOWN', timestamp: '2026-01-01T00:00:04.000Z' }),
    core.createEvent({ eventType: 'page_load', result: 'PASS', loadDurationMs: 1200, timestamp: '2026-01-01T00:00:05.000Z' })
  ];
  const session = { startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z' };
  const stats = core.computeStats(events, session);
  assert.equal(stats.totalChecks, 5);
  assert.equal(stats.passed, 2);
  assert.equal(stats.failed, 1);
  assert.equal(stats.warnings, 1);
  assert.equal(stats.unknown, 1);
  assert.equal(stats.loadSamples, 2);
  assert.equal(stats.avgLoadDurationMs, 1000);
  assert.equal(stats.sessionDurationMs, 60000);
  assert.equal(stats.failedChecks.length, 1);
});

test('operational failures are not counted as QA checks', () => {
  const events = [
    core.createEvent({ eventType: 'reload_failed', result: 'FAIL', description: 'Reload failed' }),
    core.createEvent({ eventType: 'screenshot_skipped', result: 'WARN', description: 'Capture skipped' }),
    core.createEvent({ eventType: 'text_check', result: 'PASS', description: 'Text found' })
  ];
  const stats = core.computeStats(events, { startedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(stats.totalChecks, 1);
  assert.equal(stats.passed, 1);
  assert.equal(stats.failed, 0);
  assert.equal(stats.warnings, 0);
  assert.equal(stats.failedChecks.length, 0);
});

test('refresh scheduling preserves v2.3 continuous and cycle behavior', () => {
  const now = 1000000;
  const state = { config: { mode: 'refresh', intervalSeconds: 5, cycleMode: 'continuous' }, phase: 'active', reloadsInCycle: 0 };
  let next = core.advanceSchedule(state, now);
  assert.equal(next.phase, 'active');
  assert.equal(next.nextActionAt, now + 5000);

  const cycles = {
    config: { mode: 'refresh', intervalSeconds: 2, cycleMode: 'cycles', reloadsPerCycle: 2, pauseSeconds: 7 },
    phase: 'active',
    reloadsInCycle: 0
  };
  next = core.advanceSchedule(cycles, now);
  assert.deepEqual({ phase: next.phase, count: next.reloadsInCycle, at: next.nextActionAt }, { phase: 'active', count: 1, at: now + 2000 });
  next = core.advanceSchedule({ ...cycles, reloadsInCycle: 1 }, now);
  assert.deepEqual({ phase: next.phase, count: next.reloadsInCycle, at: next.nextActionAt }, { phase: 'pause', count: 2, at: now + 7000 });
  next = core.advanceSchedule({ ...cycles, phase: 'pause', reloadsInCycle: 2 }, now);
  assert.deepEqual({ phase: next.phase, count: next.reloadsInCycle, at: next.nextActionAt }, { phase: 'active', count: 1, at: now + 2000 });

  const monitor = core.advanceSchedule({ config: { mode: 'monitor' }, phase: 'active' }, now);
  assert.equal(monitor.nextActionAt, null);
  const qaNoRefresh = core.advanceSchedule({ config: { mode: 'qa', autoRefresh: false }, phase: 'active' }, now);
  assert.equal(qaNoRefresh.nextActionAt, null);
});

test('badge behavior matches the legacy countdown and monitor states', () => {
  const now = 1000000;
  const active = { config: { mode: 'refresh', cycleMode: 'continuous' }, phase: 'active', nextActionAt: now + 8000 };
  assert.deepEqual(core.badgeForState(active, { showCountdown: true }, now), { text: '8', color: '#c62828' });
  const paused = { config: { mode: 'refresh', cycleMode: 'cycles' }, phase: 'pause', nextActionAt: now + 8000 };
  assert.deepEqual(core.badgeForState(paused, { showCountdown: true }, now), { text: '8', color: '#16803c' });
  const hidden = core.badgeForState(active, { showCountdown: false }, now);
  assert.equal(hidden.text, '');
  const monitor = { config: { mode: 'monitor' }, phase: 'active' };
  assert.equal(core.badgeForState(monitor, { showCountdown: true }, now).text, 'QA');
  assert.equal(core.badgeForState(monitor, { showCountdown: true }, now, 12).text, '9+');
  const long = { config: { mode: 'refresh', cycleMode: 'continuous' }, phase: 'active', nextActionAt: now + 2000000 };
  assert.equal(core.badgeForState(long, { showCountdown: true }, now).text, '999+');
});

test('CSV export escapes quotes, newlines, Unicode and formula injection', () => {
  const session = {
    id: 'sess-1', mode: 'qa', startedAt: '2026-01-01T00:00:00.000Z', endedAt: null,
    url: 'https://example.com/?q=привет', stopReason: null
  };
  const events = [
    core.createEvent({
      sessionId: 'sess-1', eventType: 'text_check', result: 'FAIL',
      description: 'He said "hello",\nthen left',
      actualValue: '=SUM(A1:A2)',
      httpStatus: null
    })
  ];
  const csv = core.buildCsvReport(session, events);
  assert.match(csv, /Odesoftami QA Monitor 3\.2\.0/);
  assert.match(csv, /Session ID/);
  assert.match(csv, /"He said ""hello"",/);
  assert.match(csv, /"'=SUM\(A1:A2\)"/);
  assert.match(csv, /привет/);
  assert.ok(csv.includes('\r\n'));
});

test('HTML report escapes hostile content and labels unavailable data', () => {
  const session = {
    id: 'sess-x', mode: 'qa', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z',
    url: 'https://example.com/<script>alert(1)</script>', stopReason: 'user',
    config: core.defaultConfig('qa')
  };
  const events = [
    core.createEvent({
      sessionId: 'sess-x', eventType: 'page_load', result: 'UNKNOWN',
      description: '<img src=x onerror=alert(1)>', reason: 'Timing unavailable',
      loadDurationMs: null
    })
  ];
  const html = core.buildHtmlReport(session, events, core.computeStats(events, session));
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Odesoftami QA Monitor/);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /UNKNOWN/);
  assert.match(html, /Known limitations/);
  assert.ok(!html.includes('<script'));
});

test('JSON report is parseable and contains session, stats and limitations', () => {
  const session = { id: 'sess-json', mode: 'monitor', startedAt: '2026-01-01T00:00:00.000Z', endedAt: null, url: 'https://example.com/' };
  const events = [core.createEvent({ sessionId: 'sess-json', eventType: 'url_check', result: 'PASS' })];
  const json = JSON.parse(core.buildJsonReport(session, events, core.computeStats(events, session)));
  assert.equal(json.product, 'Odesoftami QA Monitor');
  assert.equal(json.version, '3.2.0');
  assert.equal(json.session.id, 'sess-json');
  assert.equal(json.stats.totalChecks, 1);
  assert.ok(json.limitations.length >= 5);
  assert.equal(json.events.length, 1);
});

test('presets validate, reject bad data and produce safe filenames', () => {
  assert.equal(core.BUILTIN_PRESETS.length, 4);
  for (const preset of core.BUILTIN_PRESETS) {
    assert.equal(preset.config.mode, preset.mode);
    assert.equal(core.validateConfig(preset.config).ok, true);
  }
  const valid = core.validatePreset({
    name: 'My preset', description: 'desc', mode: 'qa',
    config: baseConfig({ mode: 'qa' })
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.preset.name, 'My preset');
  const builtinCollision = core.validatePreset({
    id: 'builtin-deployment', name: 'Not builtin', mode: 'qa', config: baseConfig({ mode: 'qa' })
  });
  assert.equal(builtinCollision.ok, true);
  assert.notEqual(builtinCollision.preset.id, 'builtin-deployment', 'built-in ids must not be overwritten');

  const duplicate = core.validatePreset({ name: 'My preset', mode: 'qa', config: baseConfig({ mode: 'qa' }) }, { existingNames: ['My preset'] });
  assert.equal(duplicate.preset.name, 'My preset (2)');

  const missing = core.validatePreset({ name: '', mode: 'qa', config: {} });
  assert.equal(missing.ok, false);

  const unsafe = core.validatePreset({
    name: 'x', mode: 'refresh', config: baseConfig({ dom: { enabled: true, selector: '.x' } })
  });
  assert.equal(unsafe.ok, false);

  const parsed = core.parsePresetImport(JSON.stringify({ presets: [{ name: 'a', mode: 'refresh', config: baseConfig() }] }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.candidates.length, 1);
  assert.equal(core.parsePresetImport('{bad json').ok, false);
  assert.equal(core.parsePresetImport('{"presets":[]}').ok, false);

  const exported = JSON.parse(core.exportPresets([valid.preset]));
  assert.equal(exported.presets.length, 1);
  assert.equal(exported.presets[0].name, 'My preset');
  assert.equal(exported.presets[0].config.mode, 'qa');

  assert.equal(core.reportFilename({ id: 'abc12345', startedAt: '2026-01-02T03:04:05.000Z' }, 'csv'), 'odesoftami-qa-2026-01-02-03-04-05-abc12345.csv');
  assert.match(core.sanitizeFilename('../../evil name'), /^\.\.-evil-name|^evil-name|^-evil-name|^evil-name/);
});

test('legacy v2.3 config is mapped without losing text behavior', () => {
  const config = core.configFromLegacy({
    intervalSeconds: 15,
    mode: 'cycles',
    reloadsPerCycle: 3,
    pauseSeconds: 20,
    searchText: 'In Stock',
    searchCondition: 'notFound',
    notifyOnMatch: false,
    stopOnMatch: true
  });
  assert.equal(config.mode, 'refresh');
  assert.equal(config.intervalSeconds, 15);
  assert.equal(config.cycleMode, 'cycles');
  assert.equal(config.text.enabled, true);
  assert.equal(config.text.condition, 'absent');
  assert.equal(config.text.pattern, 'In Stock');
  assert.equal(config.notifyOnMatch, false);
  assert.equal(config.stopOnMatch, true);
});

test('human-readable configuration summary never returns undefined', () => {
  const rows = core.describeConfig(core.defaultConfig('qa'));
  assert.ok(rows.length > 8);
  for (const row of rows) {
    assert.equal(row.length, 2);
    assert.equal(typeof row[0], 'string');
    assert.equal(typeof row[1], 'string');
    assert.ok(!row[1].includes('undefined'));
  }
});
