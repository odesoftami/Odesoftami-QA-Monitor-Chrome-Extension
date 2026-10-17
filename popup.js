/* Odesoftami QA Monitor — popup controller (v3.1.0) */
'use strict';

const core = OdesCore;
const $ = (id) => document.getElementById(id);
const popupParams = new URLSearchParams(location.search);
const isDetached = popupParams.get('detached') === '1';
const requestedTabId = Number(popupParams.get('tabId')) || null;

const MODE_HINTS = {
  refresh: 'Timed reloads with continuous or cycle scheduling. Use Monitor for live text, DOM and URL checks.',
  monitor: 'Live checks on this page without reloading. HTTP status is only known after a navigation.',
  qa: 'Live checks plus optional timed reloads, structured events, statistics and downloadable reports.'
};
const MODE_START_LABELS = {
  refresh: 'Start refreshing',
  monitor: 'Start monitoring',
  qa: 'Start QA session'
};

let currentTab = null;
let currentTabId = null;
let currentMode = 'refresh';
let state = null;
let session = null;
let stats = null;
let lastEvents = [];
let settings = { ...core.DEFAULT_SETTINGS };
let presets = { builtins: [], presets: [] };
let countdownTimer = null;
let statsTimer = null;
let statsBusy = false;
let noticeTimer = null;
let hasCompletedHistory = false;

const MIN_WINDOW_WIDTH = 420;
const MIN_WINDOW_HEIGHT = 560;
const MIN_CONTENT_HEIGHT = 520;
let minimumWindowTimer = null;

function fitPopupHeight() {
  // A detached window has its own real viewport; keep enough height for the
  // fixed header/actions/status/footer even before the bounds watcher snaps a
  // too-small window back to the minimum.
  const available = window.innerHeight || 600;
  const height = isDetached
    ? Math.max(MIN_CONTENT_HEIGHT, available)
    : Math.max(320, Math.min(600, available));
  document.documentElement.style.height = height + 'px';
  document.body.style.height = height + 'px';
  const app = document.querySelector('.app');
  if (app) app.style.height = height + 'px';
}

function setupBranding() {
  const manifest = chrome.runtime.getManifest();
  const version = 'v' + manifest.version;
  $('headerVersion').textContent = version;
  $('footerVersion').textContent = version;
  const github = $('githubLink');
  const web = $('webLink');
  if (github) github.href = core.GITHUB_URL;
  if (web) web.href = core.WEBSITE_URL;
}

async function closePopup() {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab && tab.id !== undefined) {
      await chrome.tabs.remove(tab.id);
      return;
    }
  } catch (_) { /* fall through */ }
  try { window.close(); } catch (_) { /* ignore */ }
}

function setupWindowControls() {
  document.body.classList.toggle('detached', isDetached);
  if (isDetached) {
    // Fill the real window width (420 px requested) while ordinary tabs keep
    // the compact 400 px popup layout.
    document.documentElement.style.width = '100%';
    document.body.style.width = '100%';
  }
  const close = $('closeButton');
  if (close) close.addEventListener('click', () => closePopup());
  if (!isDetached) return;
  window.addEventListener('resize', scheduleMinimumWindowSize);
  if (chrome.windows && chrome.windows.onBoundsChanged) {
    chrome.windows.onBoundsChanged.addListener(() => scheduleMinimumWindowSize());
  }
  scheduleMinimumWindowSize();
}

function scheduleMinimumWindowSize() {
  if (!isDetached) return;
  if (minimumWindowTimer) clearTimeout(minimumWindowTimer);
  minimumWindowTimer = setTimeout(() => {
    minimumWindowTimer = null;
    enforceMinimumWindowSize().catch(() => {});
  }, 80);
}

async function enforceMinimumWindowSize() {
  if (!isDetached || !chrome.windows) return;
  let current;
  try { current = await chrome.windows.getCurrent(); } catch (_) { return; }
  if (!current || current.type !== 'popup') return;
  if (current.width >= MIN_WINDOW_WIDTH && current.height >= MIN_WINDOW_HEIGHT) return;
  try {
    await chrome.windows.update(current.id, {
      width: Math.max(current.width, MIN_WINDOW_WIDTH),
      height: Math.max(current.height, MIN_WINDOW_HEIGHT)
    });
  } catch (_) { /* Chrome may refuse in a restricted environment. */ }
}

function showError(message = '') {
  $('error').textContent = message;
  $('error').classList.toggle('hidden', !message);
}

function showNotice(message = '') {
  $('notice').textContent = message;
  $('notice').classList.toggle('hidden', !message);
  if (noticeTimer) clearTimeout(noticeTimer);
  if (message) {
    noticeTimer = setTimeout(() => {
      $('notice').textContent = '';
      $('notice').classList.add('hidden');
    }, 4500);
  }
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || response.ok === false) {
    throw new Error((response && response.error) || 'The extension did not respond.');
  }
  return response;
}

function selectedInterval() {
  if ($('interval').value === 'custom') return Number($('customSeconds').value);
  return Number($('interval').value);
}

function setIntervalValue(seconds) {
  const value = Number(seconds);
  const option = [...$('interval').options].find((item) => item.value !== 'custom' && Number(item.value) === value);
  if (option) {
    $('interval').value = option.value;
    $('customRow').classList.add('hidden');
  } else {
    $('interval').value = 'custom';
    $('customSeconds').value = value;
    $('customRow').classList.remove('hidden');
  }
}

function setMode(mode) {
  currentMode = core.MODES.includes(mode) ? mode : 'refresh';
  for (const button of document.querySelectorAll('.mode-button')) {
    const pressed = button.dataset.mode === currentMode;
    button.classList.toggle('active', pressed);
    button.setAttribute('aria-pressed', String(pressed));
  }
  const isRefresh = currentMode === 'refresh';
  const isMonitor = currentMode === 'monitor';
  $('refreshSection').classList.toggle('hidden', isMonitor);
  $('autoRefreshRow').classList.toggle('hidden', currentMode !== 'qa');
  $('qaRefreshNote').classList.toggle('hidden', currentMode !== 'qa');
  // Refresh is deliberately simple: the legacy text-condition card is hidden.
  // Its stored values remain in the form/model for compatibility.
  $('checksSection').classList.toggle('hidden', isRefresh);
  $('textEnabledRow').classList.toggle('hidden', isRefresh);
  $('regexRow').classList.toggle('hidden', isRefresh);
  $('domDetails').classList.toggle('hidden', isRefresh);
  $('urlDetails').classList.toggle('hidden', isRefresh);
  $('optionsDetails').classList.toggle('hidden', isRefresh);
  $('checksHeading').textContent = 'Checks';
  $('checksBadge').textContent = currentMode === 'qa' ? 'live + report' : 'live';
  $('refreshHeading').textContent = currentMode === 'qa' ? 'Optional page refresh' : 'Refresh';
  $('modeHint').textContent = MODE_HINTS[currentMode];
  $('startButton').textContent = MODE_START_LABELS[currentMode];
  $('textHelp').textContent = 'Case-insensitive visible-text search, evaluated after DOM changes stabilize. “Text changes” compares against the baseline captured after load.';
  updateCheckStates();
}

function updateCheckStates() {
  const isRefresh = currentMode === 'refresh';
  const textOn = isRefresh ? Boolean($('textPattern').value.trim()) : $('textEnabled').checked;
  const domOn = !isRefresh && $('domEnabled').checked;
  const urlOn = !isRefresh && $('urlEnabled').checked;
  $('textState').textContent = textOn ? 'ON' : 'OFF';
  $('textState').classList.toggle('on', textOn);
  $('domState').textContent = domOn ? 'ON' : 'OFF';
  $('domState').classList.toggle('on', domOn);
  $('urlState').textContent = urlOn ? 'ON' : 'OFF';
  $('urlState').classList.toggle('on', urlOn);
  // Session options do not have a meaningful ON/OFF check state.
  $('optionsState').textContent = 'DEFAULTS';
}

function collectConfig() {
  const mode = currentMode;
  const isRefresh = mode === 'refresh';
  const interval = selectedInterval();
  return {
    mode,
    intervalSeconds: interval,
    cycleMode: $('cycleMode').value,
    reloadsPerCycle: Number($('reloadsPerCycle').value),
    pauseSeconds: Number($('pauseSeconds').value),
    autoRefresh: mode === 'qa' ? $('autoRefresh').checked : mode !== 'monitor',
    bypassCache: Boolean(settings.bypassCache),
    text: {
      enabled: isRefresh ? Boolean($('textPattern').value.trim()) : $('textEnabled').checked,
      condition: $('textCondition').value,
      pattern: $('textPattern').value,
      regex: isRefresh ? false : $('textRegex').checked
    },
    dom: {
      enabled: !isRefresh && $('domEnabled').checked,
      selector: $('domSelector').value,
      condition: $('domCondition').value,
      expectedText: $('domExpectedText').value
    },
    url: {
      enabled: !isRefresh && $('urlEnabled').checked,
      expectedUrl: $('expectedUrl').value,
      ignoreHash: $('ignoreHash').checked
    },
    http: { enabled: isRefresh ? true : $('httpEnabled').checked },
    timing: { enabled: isRefresh ? true : $('timingEnabled').checked, budgetMs: Number($('loadBudget').value) },
    settleMs: Number($('settleMs').value),
    notifyOnMatch: $('notifyOnMatch').checked,
    notifyOnFailure: $('notifyOnFailure').checked,
    stopOnMatch: $('stopOnMatch').checked,
    stopOnFailure: $('stopOnFailure').checked,
    screenshotOnFailure: $('screenshotOnFailure').checked
  };
}

function applyConfigToForm(rawConfig) {
  const config = core.normalizeConfig({ ...(rawConfig || {}), mode: (rawConfig && rawConfig.mode) || currentMode });
  setMode(config.mode);
  setIntervalValue(config.intervalSeconds);
  $('cycleMode').value = config.cycleMode;
  $('cycleSettings').classList.toggle('hidden', config.cycleMode !== 'cycles');
  $('reloadsPerCycle').value = config.reloadsPerCycle;
  $('pauseSeconds').value = config.pauseSeconds;
  $('autoRefresh').checked = config.autoRefresh;
  $('textEnabled').checked = config.text.enabled;
  $('textPattern').value = config.text.pattern;
  $('textCondition').value = config.text.condition;
  $('textRegex').checked = config.text.regex;
  $('domEnabled').checked = config.dom.enabled;
  $('domSelector').value = config.dom.selector;
  $('domCondition').value = config.dom.condition;
  $('domExpectedText').value = config.dom.expectedText;
  $('urlEnabled').checked = config.url.enabled;
  $('expectedUrl').value = config.url.expectedUrl;
  $('ignoreHash').checked = config.url.ignoreHash;
  $('httpEnabled').checked = config.http.enabled;
  $('timingEnabled').checked = config.timing.enabled;
  $('loadBudget').value = config.timing.budgetMs;
  $('settleMs').value = config.settleMs;
  $('notifyOnMatch').checked = config.notifyOnMatch;
  $('notifyOnFailure').checked = config.notifyOnFailure;
  $('stopOnMatch').checked = config.stopOnMatch;
  $('stopOnFailure').checked = config.stopOnFailure;
  $('screenshotOnFailure').checked = config.screenshotOnFailure;
  updateCheckStates();
}

function applyDefaults() {
  const config = core.defaultConfig(settings.defaultMode || 'refresh');
  config.bypassCache = Boolean(settings.bypassCache);
  config.settleMs = settings.settleMs;
  config.notifyOnFailure = settings.notifyOnFailure !== false;
  config.screenshotOnFailure = Boolean(settings.screenshotOnFailure);
  applyConfigToForm(config);
}

function setFormDisabled(disabled) {
  for (const element of document.querySelectorAll('#configForm input, #configForm select')) {
    element.disabled = disabled;
  }
  for (const button of document.querySelectorAll('.mode-button')) button.disabled = disabled;
  $('presetSelect').disabled = disabled;
  $('applyPresetButton').disabled = disabled;
  $('showSavePreset').disabled = disabled;
  $('startButton').disabled = disabled || !isMonitorableTab();
}

function isMonitorableTab() {
  return Boolean(currentTab && currentTab.url && /^https?:\/\//i.test(currentTab.url));
}

function renderStatus() {
  const status = $('status');
  const active = Boolean(state);
  status.classList.toggle('active', active && !(state.failureCount > 0));
  status.classList.toggle('failure', active && state.failureCount > 0);
  $('statusMode').classList.toggle('hidden', !active);
  if (!active) {
    $('statusText').textContent = 'Not monitoring';
    $('statusMode').textContent = '';
    $('nextAction').classList.add('hidden');
    $('cycleProgress').classList.add('hidden');
    return;
  }
  $('statusMode').textContent = core.modeLabel(state.mode);
  let text = 'Monitoring';
  if (state.mode === 'refresh') text = state.phase === 'pause' ? 'Paused' : 'Refreshing';
  else if (state.mode === 'monitor') text = 'Monitoring';
  else text = 'QA Session running';
  if (state.failureCount > 0) text += ' · ' + state.failureCount + ' failed';
  $('statusText').textContent = text;
  updateCountdown();
}

function updateCountdown() {
  if (!state) {
    $('nextAction').classList.add('hidden');
    $('cycleProgress').classList.add('hidden');
    return;
  }
  if (!state.isReloading || !Number.isFinite(Number(state.nextActionAt))) {
    $('nextAction').textContent = state.mode === 'qa' ? 'Live checks only · no automatic reloads' : 'Live checks · no automatic reloads';
    $('nextAction').classList.remove('hidden');
    $('cycleProgress').classList.add('hidden');
    return;
  }
  const remaining = Math.max(0, (Number(state.nextActionAt) - Date.now()) / 1000);
  const isCycles = state.config && state.config.cycleMode === 'cycles';
  if (isCycles) {
    const isPause = state.phase === 'pause';
    $('nextAction').textContent = isPause
      ? 'Next cycle starts in ' + core.formatDuration(remaining)
      : 'Next reload in ' + core.formatDuration(remaining) + ' · every ' + core.formatDuration(state.config.intervalSeconds);
    $('cycleProgress').textContent = isPause
      ? 'PAUSE · ' + state.reloadsInCycle + '/' + state.config.reloadsPerCycle + ' reloads completed'
      : 'CYCLE · ' + state.reloadsInCycle + '/' + state.config.reloadsPerCycle + ' reloads completed';
    $('cycleProgress').classList.toggle('pause', isPause);
    $('cycleProgress').classList.remove('hidden');
  } else {
    $('nextAction').textContent = 'Next refresh in ' + core.formatDuration(remaining) + ' · every ' + core.formatDuration(state.config.intervalSeconds);
    $('cycleProgress').classList.add('hidden');
  }
  $('nextAction').classList.remove('hidden');
}

function resultBadge(result) {
  const span = document.createElement('span');
  span.className = 'result-badge ' + String(result || 'unknown').toLowerCase();
  span.textContent = result || 'UNKNOWN';
  return span;
}

async function refreshHistoryAvailability() {
  try {
    const response = await send({ type: 'GET_SESSIONS' });
    hasCompletedHistory = (response.sessions || []).some((entry) => entry.status !== 'active');
  } catch (_) {
    hasCompletedHistory = false;
  }
  const button = $('clearHistoryButton');
  if (button) button.disabled = !hasCompletedHistory;
}

function renderSummary() {
  const active = Boolean(state);
  $('summaryHeading').textContent = active ? 'Live summary' : (session ? 'Last session' : 'Live summary');
  const summaryType = $('summaryType');
  const modeForType = active && state ? state.mode : (session ? session.mode : null);
  summaryType.textContent = modeForType ? core.modeLabel(modeForType) : '';
  summaryType.classList.toggle('hidden', !modeForType);
  const safeStats = stats || {
    totalChecks: 0, passed: 0, failed: 0, warnings: 0, unknown: 0,
    avgLoadDurationMs: null, sessionDurationMs: null, lastEventAt: null, totalEvents: 0
  };
  $('statTotal').textContent = String(safeStats.totalChecks || 0);
  $('statPass').textContent = String(safeStats.passed || 0);
  $('statFail').textContent = String(safeStats.failed || 0);
  $('statWarn').textContent = String(safeStats.warnings || 0);
  $('statUnknown').textContent = String(safeStats.unknown || 0);
  $('statLoad').textContent = safeStats.avgLoadDurationMs === null ? '—' : core.formatMs(safeStats.avgLoadDurationMs);
  $('summaryDuration').textContent = 'Duration ' + (safeStats.sessionDurationMs === null ? '—' : core.formatSessionDuration(safeStats.sessionDurationMs));
  $('summaryLastEvent').textContent = 'Last event ' + (safeStats.lastEventAt ? core.formatLocalTime(safeStats.lastEventAt) : '—');

  const line = $('lastCheckLine');
  line.textContent = '';
  const lastCheck = (state && state.lastCheck) || (safeStats.lastCheck
    ? { result: safeStats.lastCheck.result, description: safeStats.lastCheck.description, at: safeStats.lastCheck.timestamp }
    : null);
  if (lastCheck) {
    line.appendChild(resultBadge(lastCheck.result));
    const text = document.createElement('span');
    text.textContent = ' ' + (lastCheck.description || 'Last check') + (lastCheck.at ? ' · ' + core.formatLocalTime(lastCheck.at) : '');
    line.appendChild(text);
    line.classList.remove('hidden');
  } else {
    line.classList.add('hidden');
  }

  const events = lastEvents || [];
  if (events.length) {
    $('historyNote').textContent = events.length + ' event' + (events.length === 1 ? '' : 's') + ' recorded' +
      (session && session.droppedEvents ? ' · ' + session.droppedEvents + ' dropped' : '');
  } else if (session) {
    $('historyNote').textContent = 'No events recorded for this session yet.';
  } else {
    $('historyNote').textContent = 'No events recorded yet.';
  }
  $('exportCsvButton').disabled = !session;
  const clear = $('clearHistoryButton');
  if (clear) clear.disabled = !hasCompletedHistory;
}

function setActive(active) {
  setFormDisabled(active);
  $('stopButton').disabled = !active;
  $('startButton').disabled = active || !isMonitorableTab();
  $('savePresetRow').classList.add('hidden');
  $('showSavePreset').classList.remove('hidden');
}

function startStatsPolling() {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = setInterval(() => {
    if (document.hidden) return;
    refreshState().catch(() => {});
  }, 3000);
}

function stopStatsPolling() {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = null;
}

async function refreshState() {
  if (currentTabId === null || statsBusy) return;
  statsBusy = true;
  try {
    const response = await send({ type: 'GET_STATE', tabId: currentTabId });
    settings = response.settings || settings;
    session = response.session || null;
    stats = response.stats || null;
    lastEvents = Array.isArray(response.events) ? response.events : [];
    if (response.state) {
      const previousSession = state && state.sessionId;
      state = response.state;
      if (previousSession !== state.sessionId) {
        setMode(state.mode);
        applyConfigToForm(state.config);
      }
      setActive(true);
      startStatsPolling();
    } else {
      const wasActive = Boolean(state);
      state = null;
      setActive(false);
      stopStatsPolling();
      if (wasActive) {
        showNotice('Session stopped. The session record is available in the dashboard.');
        await refreshHistoryAvailability();
      }
    }
    renderStatus();
    renderSummary();
  } finally {
    statsBusy = false;
  }
}

async function loadPresets() {
  try {
    const response = await send({ type: 'GET_PRESETS' });
    presets = { builtins: response.builtins || [], presets: response.presets || [] };
    renderPresets();
  } catch (_) {
    presets = { builtins: core.BUILTIN_PRESETS, presets: [] };
    renderPresets();
  }
}

function renderPresets() {
  const select = $('presetSelect');
  const previous = select.value;
  select.textContent = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose a preset…';
  select.appendChild(placeholder);
  const builtins = document.createElement('optgroup');
  builtins.label = 'Built-in presets';
  for (const preset of presets.builtins) {
    const option = document.createElement('option');
    option.value = 'builtin:' + preset.id;
    option.textContent = preset.name;
    builtins.appendChild(option);
  }
  select.appendChild(builtins);
  if (presets.presets.length) {
    const custom = document.createElement('optgroup');
    custom.label = 'My presets';
    for (const preset of presets.presets) {
      const option = document.createElement('option');
      option.value = 'custom:' + preset.id;
      option.textContent = preset.name;
      custom.appendChild(option);
    }
    select.appendChild(custom);
  }
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

function findPreset(value) {
  if (!value) return null;
  const [kind, id] = value.split(':');
  if (kind === 'builtin') return presets.builtins.find((preset) => preset.id === id) || null;
  if (kind === 'custom') return presets.presets.find((preset) => preset.id === id) || null;
  return null;
}

function downloadText(text, filename, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openDashboard(hash = '') {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html' + hash) });
  window.close();
}

async function load() {
  showError();
  let tab = null;
  if (requestedTabId !== null) {
    try { tab = await chrome.tabs.get(requestedTabId); } catch (_) { tab = null; }
  }
  if (!tab) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = active || null;
  }
  if (!tab) throw new Error('No target tab was found.');
  currentTab = tab;
  currentTabId = tab.id;
  $('pageTitle').textContent = tab.title || 'Current tab';
  $('pageUrl').textContent = tab.url || '';

  const response = await send({ type: 'GET_STATE', tabId: currentTabId });
  settings = response.settings || core.DEFAULT_SETTINGS;
  session = response.session || null;
  stats = response.stats || null;
  lastEvents = Array.isArray(response.events) ? response.events : [];
  await loadPresets();

  if (response.state) {
    state = response.state;
    setMode(state.mode);
    applyConfigToForm(state.config);
    setActive(true);
    startStatsPolling();
  } else {
    state = null;
    setMode(settings.defaultMode || 'refresh');
    applyDefaults();
    setActive(false);
  }
  if (!isMonitorableTab()) {
    $('startButton').disabled = true;
    showError('This page cannot be monitored. Open a regular HTTP or HTTPS webpage.');
  }
  renderStatus();
  renderSummary();
  await refreshHistoryAvailability();
  countdownTimer = setInterval(updateCountdown, 500);
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

$('interval').addEventListener('change', () => {
  $('customRow').classList.toggle('hidden', $('interval').value !== 'custom');
});
$('cycleMode').addEventListener('change', () => {
  $('cycleSettings').classList.toggle('hidden', $('cycleMode').value !== 'cycles');
});
for (const button of document.querySelectorAll('.mode-button')) {
  button.addEventListener('click', () => {
    if (state) return;
    setMode(button.dataset.mode);
    if (button.dataset.mode !== 'refresh') {
      $('stopOnMatch').checked = false;
      $('stopOnFailure').checked = false;
    } else {
      $('stopOnMatch').checked = true;
    }
    showError();
  });
}
$('textPattern').addEventListener('input', updateCheckStates);
$('textEnabled').addEventListener('change', updateCheckStates);
$('domEnabled').addEventListener('change', updateCheckStates);
$('urlEnabled').addEventListener('change', updateCheckStates);
$('screenshotOnFailure').addEventListener('change', updateCheckStates);

$('startButton').addEventListener('click', async () => {
  showError();
  showNotice();
  if (!isMonitorableTab()) {
    showError('This page cannot be monitored. Open a regular HTTP or HTTPS webpage.');
    return;
  }
  const config = collectConfig();
  const validation = core.validateConfig(config, {
    selectorValidator: (selector) => core.validateSelectorWithDom(document, selector)
  });
  if (!validation.ok) {
    showError(validation.errors.join(' '));
    return;
  }
  try {
    $('startButton').disabled = true;
    await send({ type: 'START_SESSION', tabId: currentTabId, config: validation.config });
    await refreshState();
    showNotice(core.modeLabel(config.mode) + ' started.');
  } catch (error) {
    showError(error.message);
    $('startButton').disabled = false;
  }
});

$('stopButton').addEventListener('click', async () => {
  showError();
  try {
    await send({ type: 'STOP_SESSION', tabId: currentTabId, reason: 'user' });
    state = null;
    await refreshState();
    await refreshHistoryAvailability();
    showNotice('Session stopped.');
  } catch (error) {
    showError(error.message);
  }
});

$('exportCsvButton').addEventListener('click', async () => {
  showError();
  try {
    const response = await send({ type: 'GET_STATE', tabId: currentTabId });
    if (!response.session || !response.events || !response.events.length) {
      showError('There are no QA events to export yet.');
      return;
    }
    const csv = core.buildCsvReport(response.session, response.events);
    downloadText('\ufeff' + csv, core.reportFilename(response.session, 'csv'), 'text/csv;charset=utf-8');
    showNotice('CSV export created.');
  } catch (error) {
    showError(error.message);
  }
});

$('clearHistoryButton').addEventListener('click', async () => {
  showError();
  try {
    const list = await send({ type: 'GET_SESSIONS' });
    const completed = (list.sessions || []).filter((entry) => entry.status !== 'active');
    if (!completed.length) {
      showNotice('There are no completed sessions to clear.');
      return;
    }
    const events = completed.reduce((sum, entry) => sum + (Number(entry.eventCount) || 0), 0);
    const message = 'Clear ' + completed.length + ' completed session' + (completed.length === 1 ? '' : 's') +
      ' and ' + events + ' historical event' + (events === 1 ? '' : 's') + '?\n\n' +
      'Active monitoring sessions, presets, settings and stored screenshots will be preserved.';
    if (!window.confirm(message)) return;
    const result = await send({ type: 'CLEAR_HISTORY' });
    await refreshState();
    await refreshHistoryAvailability();
    showNotice('Cleared ' + result.removed + ' completed session(s). Active sessions, presets, settings and screenshots were preserved.');
  } catch (error) {
    showError(error.message);
  }
});

$('dashboardButton').addEventListener('click', () => openDashboard());
$('settingsButton').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('managePresetsButton').addEventListener('click', () => openDashboard('#presets'));

$('applyPresetButton').addEventListener('click', () => {
  const preset = findPreset($('presetSelect').value);
  if (!preset) {
    showError('Choose a preset to apply.');
    return;
  }
  applyConfigToForm({ ...preset.config, mode: preset.mode });
  showError();
  showNotice('Preset loaded: ' + preset.name + '. Review the settings, then start.');
});

$('showSavePreset').addEventListener('click', () => {
  $('savePresetRow').classList.remove('hidden');
  $('showSavePreset').classList.add('hidden');
  $('presetName').value = core.modeLabel(currentMode) + ' preset';
  $('presetName').focus();
  $('presetName').select();
});

$('cancelSavePreset').addEventListener('click', () => {
  $('savePresetRow').classList.add('hidden');
  $('showSavePreset').classList.remove('hidden');
});

$('confirmSavePreset').addEventListener('click', async () => {
  showError();
  const name = $('presetName').value.trim();
  if (!name) {
    showError('Enter a preset name.');
    return;
  }
  const config = collectConfig();
  const validation = core.validateConfig(config, {
    selectorValidator: (selector) => core.validateSelectorWithDom(document, selector)
  });
  if (!validation.ok) {
    showError(validation.errors.join(' '));
    return;
  }
  try {
    const response = await send({ type: 'SAVE_PRESET', preset: { name, mode: config.mode, config: validation.config } });
    await loadPresets();
    $('presetSelect').value = 'custom:' + response.preset.id;
    $('savePresetRow').classList.add('hidden');
    $('showSavePreset').classList.remove('hidden');
    showNotice('Preset saved: ' + response.preset.name + '.');
  } catch (error) {
    showError(error.message);
  }
});

$('configForm').addEventListener('submit', (event) => event.preventDefault());

fitPopupHeight();
window.addEventListener('resize', fitPopupHeight);
setupWindowControls();
setupBranding();
load().catch((error) => {
  showError(error.message);
  setFormDisabled(false);
});
