/* Odesoftami QA Monitor — dashboard controller (v3.1.0) */
'use strict';

const core = OdesCore;
const $ = (id) => document.getElementById(id);

const EVENT_LABELS = {
  session_start: 'Session start',
  session_stop: 'Session stop',
  session_resumed: 'Session resumed',
  baseline: 'Baseline',
  reload_requested: 'Reload',
  reload_failed: 'Reload failure',
  text_check: 'Text check',
  dom_check: 'DOM check',
  url_check: 'URL check',
  http_status: 'HTTP status',
  navigation: 'Navigation / HTTP',
  redirect: 'Redirect',
  navigation_error: 'Navigation error',
  page_load: 'Page load',
  screenshot: 'Screenshot',
  screenshot_skipped: 'Screenshot skipped',
  legacy_event: 'Legacy v2.3',
  config: 'Configuration'
};

let sessions = [];
let builtins = [];
let customPresets = [];
let selectedSessionId = null;
let sessionData = null;
let activeState = null;
let selectedActiveTabId = null;
let currentView = 'overview';
let editingPresetId = null;
let pollTimer = null;
let countdownTimer = null;
let polling = false;
let loadToken = 0;
let screenshotToken = 0;
let lastScreenshotSignature = '';
let toastTimer = null;
let lastSessionSignature = '';

function setupBranding() {
  const version = 'v' + chrome.runtime.getManifest().version;
  $('dashboardVersion').textContent = version;
  $('dashboardFooterVersion').textContent = version;
}

function completedSessions() {
  return sessions.filter((session) => session.status !== 'active');
}

async function clearCompletedHistory() {
  const completed = completedSessions();
  if (!completed.length) {
    showToast('There are no completed sessions to clear.');
    return;
  }
  const eventCount = completed.reduce((sum, session) => sum + (Number(session.eventCount) || 0), 0);
  const message = 'Clear ' + completed.length + ' completed session' + (completed.length === 1 ? '' : 's') +
    ' and ' + eventCount + ' historical event' + (eventCount === 1 ? '' : 's') + '?\n\n' +
    'Active monitoring sessions, presets, settings and stored screenshots will be preserved.';
  if (!window.confirm(message)) return;
  try {
    const response = await send({ type: 'CLEAR_HISTORY' });
    selectedSessionId = null;
    sessionData = null;
    activeState = null;
    await loadSessions({ initial: true });
    const active = sessions.find((session) => session.status === 'active');
    const next = active || sessions[0];
    if (next) {
      await loadSessionData(next.id);
    } else {
      renderEmpty();
    }
    await loadPresets();
    showToast('Cleared ' + response.removed + ' completed session(s). Active sessions, presets, settings and screenshots were preserved.');
  } catch (error) {
    showToast('Could not clear history: ' + error.message, true);
  }
}

function showToast(message, error = false) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.toggle('error', Boolean(error));
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, error ? 7000 : 4000);
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || response.ok === false) {
    throw new Error((response && response.error) || 'The extension did not respond.');
  }
  return response;
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
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function resultBadge(result) {
  const span = document.createElement('span');
  span.className = 'result-badge ' + String(result || 'unknown').toLowerCase();
  span.textContent = result || 'UNKNOWN';
  return span;
}

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text === null || text === undefined || text === '' ? '—' : String(text);
  if (className) td.className = className;
  return td;
}

function eventDetailsText(event) {
  if (!event || !event.details) return '';
  try { return JSON.stringify(event.details); } catch (_) { return ''; }
}

function eventTypeLabel(type) {
  return EVENT_LABELS[type] || type || 'Event';
}

function statusLabel(session) {
  if (!session) return '—';
  if (session.status === 'active') return 'Active';
  return session.stopReason ? 'Stopped · ' + core.stopReasonLabel(session.stopReason) : 'Stopped';
}

function showStorageWarning(warning) {
  const element = $('storageWarning');
  element.textContent = warning || '';
  element.classList.toggle('hidden', !warning);
}

// ---------------------------------------------------------------------------
// Sessions and data
// ---------------------------------------------------------------------------

async function loadSessions({ initial = false } = {}) {
  const response = await send({ type: 'GET_SESSIONS' });
  sessions = response.sessions || [];
  showStorageWarning(response.storageWarning);
  renderSessionControls();
  if (initial) {
    const params = new URLSearchParams(location.search);
    const requested = params.get('session');
    const active = sessions.find((session) => session.status === 'active');
    const selected = (requested && sessions.some((session) => session.id === requested) && requested)
      || (selectedSessionId && sessions.some((session) => session.id === selectedSessionId) && selectedSessionId)
      || (active && active.id)
      || (sessions[0] && sessions[0].id)
      || null;
    if (selected) await loadSessionData(selected);
    else renderEmpty();
  } else if (selectedSessionId) {
    const stillThere = sessions.some((session) => session.id === selectedSessionId);
    if (!stillThere) {
      selectedSessionId = null;
      sessionData = null;
      activeState = null;
      renderEmpty();
    }
  }
}

function renderSessionControls() {
  const active = sessions.filter((session) => session.status === 'active');
  $('clearHistoryQuick').disabled = completedSessions().length === 0;
  const engineState = $('engineState');
  engineState.textContent = active.length ? active.length + ' active' : 'Idle';
  engineState.classList.toggle('live', active.length > 0);
  engineState.classList.toggle('error', Boolean($('storageWarning').textContent));

  const select = $('sessionSelect');
  const signature = sessions.map((session) => session.id + ':' + session.status + ':' + session.eventCount + ':' + (session.endedAt || '')).join('|');
  if (signature !== lastSessionSignature) {
    lastSessionSignature = signature;
    select.textContent = '';
    if (!sessions.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No sessions yet';
      select.appendChild(option);
    }
    for (const session of sessions) {
      const option = document.createElement('option');
      option.value = session.id;
      option.textContent = core.formatLocalDateTime(session.startedAt) + ' · ' + core.modeLabel(session.mode) + ' · ' +
        (session.status === 'active' ? 'Active' : 'Stopped');
      select.appendChild(option);
    }
  }
  if (selectedSessionId) select.value = selectedSessionId;

  const list = $('historySessionList');
  list.textContent = '';
  if (!sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No sessions recorded yet.';
    list.appendChild(empty);
  }
  for (const session of sessions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'session-item' + (session.id === selectedSessionId ? ' active' : '');
    const line1 = document.createElement('span');
    line1.className = 'line1';
    const name = document.createElement('span');
    name.textContent = core.modeLabel(session.mode);
    const pill = document.createElement('span');
    pill.className = 'status-pill ' + (session.status === 'active' ? 'active' : 'stopped');
    pill.textContent = session.status === 'active' ? 'Active' : 'Stopped';
    line1.appendChild(name);
    line1.appendChild(pill);
    const line2 = document.createElement('span');
    line2.className = 'line2';
    line2.textContent = core.formatLocalDateTime(session.startedAt);
    const line3 = document.createElement('span');
    line3.className = 'line3';
    line3.textContent = (session.url || 'Imported history') + ' · ' + (session.eventCount || 0) + ' events';
    item.appendChild(line1);
    item.appendChild(line2);
    item.appendChild(line3);
    item.addEventListener('click', () => {
      selectSession(session.id, true);
    });
    list.appendChild(item);
  }
}

async function loadSessionData(sessionId, options = {}) {
  if (!sessionId) {
    renderEmpty();
    return;
  }
  const token = ++loadToken;
  let response;
  try {
    response = await send({ type: 'GET_SESSION_DATA', sessionId });
  } catch (error) {
    if (!options.silent) showToast(error.message, true);
    return;
  }
  if (token !== loadToken) return;
  sessionData = response;
  selectedSessionId = sessionId;
  activeState = null;
  selectedActiveTabId = null;
  const session = response.session;
  if (session && session.status === 'active') {
    selectedActiveTabId = session.tabId;
    try {
      const stateResponse = await send({ type: 'GET_STATE', tabId: session.tabId, light: true });
      if (token !== loadToken) return;
      activeState = stateResponse.state || null;
    } catch (_) { activeState = null; }
  }
  showStorageWarning(response.storageWarning);
  $('sessionSelect').value = sessionId;
  renderOverview();
  renderHistory();
  renderScreenshots();
  renderSessionControls();
}

function renderEmpty() {
  sessionData = null;
  lastScreenshotSignature = '';
  activeState = null;
  selectedActiveTabId = null;
  $('liveStatus').textContent = 'No session selected';
  $('liveMode').classList.add('hidden');
  $('liveCountdown').textContent = '';
  $('liveDot').className = 'live-dot';
  $('liveUrl').textContent = 'Start a Refresh, Monitor or QA Session from the extension popup.';
  $('liveCurrent').textContent = '—';
  $('liveLastResult').textContent = '—';
  $('liveFailures').textContent = '0';
  $('liveTab').textContent = '—';
  $('stopSessionButton').disabled = true;
  for (const id of ['dashTotal', 'dashPass', 'dashFail', 'dashWarn', 'dashUnknown']) $(id).textContent = '0';
  $('dashAvgLoad').textContent = '—';
  $('dashPassRate').textContent = '—';
  $('dashDuration').textContent = '—';
  $('sessionMeta').textContent = 'No session data yet.';
  $('configTable').textContent = '';
  $('recentEvents').textContent = '';
  $('historyEvents').textContent = '';
  $('overviewEmpty').classList.remove('hidden');
  $('historyEmpty').classList.remove('hidden');
  $('historyEmpty').textContent = 'No events match this session or filter.';
  $('screenshotGrid').textContent = '';
  $('screenshotNote').textContent = 'No session selected.';
  $('clearScreenshotsButton').disabled = true;
  $('historyTitle').textContent = 'Event timeline';
  $('historyCount').textContent = '';
  $('deleteSessionButton').disabled = true;
  $('clearHistoryQuick').disabled = true;
  for (const id of ['exportCsv', 'exportHtml', 'exportJson', 'historyExportCsv', 'historyExportHtml', 'historyExportJson']) {
    $(id).disabled = true;
  }
}

function renderOverview() {
  if (!sessionData || !sessionData.session) {
    renderEmpty();
    return;
  }
  const session = sessionData.session;
  const stats = sessionData.stats || core.computeStats(sessionData.events, session);
  const events = sessionData.events || [];
  const active = session.status === 'active';

  $('liveStatus').textContent = active
    ? 'Active · ' + core.modeLabel(session.mode)
    : 'Completed · ' + (session.stopReason ? core.stopReasonLabel(session.stopReason) : 'stopped');
  $('liveMode').textContent = core.modeLabel(session.mode);
  $('liveMode').classList.remove('hidden');
  const dot = $('liveDot');
  dot.className = 'live-dot' + (active ? (stats.failed > 0 ? ' failure' : ' live') : '');
  $('liveUrl').textContent = session.url || 'Imported session (no URL recorded).';
  $('liveTab').textContent = session.tabId === null || session.tabId === undefined ? '—' : String(session.tabId);
  const lastCheck = activeState && activeState.lastCheck
    ? activeState.lastCheck
    : stats.lastCheck;
  $('liveCurrent').textContent = lastCheck ? (lastCheck.description || lastCheck.checkName || lastCheck.type || '—') : '—';
  $('liveLastResult').textContent = (activeState && activeState.lastResult) || stats.lastResult || '—';
  $('liveFailures').textContent = String(active ? (activeState ? activeState.failureCount : stats.failed) : stats.failed);
  $('stopSessionButton').disabled = !active || session.tabId === null || session.tabId === undefined;

  $('dashTotal').textContent = String(stats.totalChecks || 0);
  $('dashPass').textContent = String(stats.passed || 0);
  $('dashFail').textContent = String(stats.failed || 0);
  $('dashWarn').textContent = String(stats.warnings || 0);
  $('dashUnknown').textContent = String(stats.unknown || 0);
  $('dashAvgLoad').textContent = stats.avgLoadDurationMs === null ? '—' : core.formatMs(stats.avgLoadDurationMs);
  $('dashPassRate').textContent = stats.totalChecks ? core.formatPercent(stats.passed, stats.totalChecks) : '—';
  $('dashDuration').textContent = stats.sessionDurationMs === null ? '—' : core.formatSessionDuration(stats.sessionDurationMs);

  const meta = [];
  meta.push('Started ' + core.formatLocalDateTime(session.startedAt));
  meta.push('Ended ' + (session.endedAt ? core.formatLocalDateTime(session.endedAt) : 'active'));
  meta.push('Events ' + (stats.totalEvents || 0) + (session.droppedEvents ? ' (' + session.droppedEvents + ' dropped)' : ''));
  meta.push('Last event ' + (stats.lastEventAt ? core.formatLocalTime(stats.lastEventAt) : '—'));
  if (session.importedFrom) meta.push('Imported from v' + session.importedFrom);
  if (activeState) {
    if (activeState.nextActionAt) meta.push('Next action ' + core.formatLocalTime(new Date(activeState.nextActionAt).toISOString()));
    meta.push('Session ID ' + session.id);
  }
  $('sessionMeta').textContent = meta.join(' · ');

  const configBody = $('configTable');
  configBody.textContent = '';
  const rows = session.config ? core.describeConfig(session.config) : [['Configuration', 'Not stored for this imported session.']];
  for (const [label, value] of rows) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = label;
    const td = document.createElement('td');
    td.textContent = value;
    tr.appendChild(th);
    tr.appendChild(td);
    configBody.appendChild(tr);
  }

  renderEvents($('recentEvents'), events.slice(-12), false);
  $('overviewEmpty').classList.toggle('hidden', events.length > 0);
  for (const id of ['exportCsv', 'exportHtml', 'exportJson']) $(id).disabled = false;
  updateCountdown();
}

function renderEvents(tbody, events, wide) {
  tbody.textContent = '';
  for (const event of events) {
    const tr = document.createElement('tr');
    tr.className = String(event.result || 'info').toLowerCase();
    tr.appendChild(cell(core.formatLocalTime(event.timestamp), 'time'));
    const result = document.createElement('td');
    result.appendChild(resultBadge(event.result));
    tr.appendChild(result);
    tr.appendChild(cell(event.checkName || eventTypeLabel(event.eventType)));
    tr.appendChild(cell(event.description, 'desc'));
    if (wide) {
      tr.appendChild(cell(event.expectedValue));
      tr.appendChild(cell(event.actualValue));
    }
    tr.appendChild(cell(event.httpStatus === null ? '—' : event.httpStatus));
    tr.appendChild(cell(event.loadDurationMs === null ? '—' : core.formatMs(event.loadDurationMs)));
    if (wide) {
      tr.appendChild(cell(event.reason));
      const details = eventDetailsText(event);
      const detailCell = cell(details.length > 180 ? details.slice(0, 180) + '…' : details, 'detail-cell');
      if (details) detailCell.title = details;
      tr.appendChild(detailCell);
    }
    tbody.appendChild(tr);
  }
}

function filterEvents(events) {
  const result = $('filterResult').value;
  const type = $('filterType').value;
  const query = $('filterText').value.trim().toLocaleLowerCase();
  return events.filter((event) => {
    if (result && event.result !== result) return false;
    if (type) {
      if (type === 'navigation') {
        if (event.eventType !== 'navigation' && event.eventType !== 'http_status') return false;
      } else if (event.eventType !== type) return false;
    }
    if (query) {
      const haystack = [event.description, event.url, event.reason, event.checkName, event.expectedValue, event.actualValue]
        .filter(Boolean).join(' ').toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function renderHistory() {
  if (!sessionData || !sessionData.session) {
    $('historyEvents').textContent = '';
    $('historyEmpty').classList.remove('hidden');
    $('historyCount').textContent = '';
    $('deleteSessionButton').disabled = true;
    return;
  }
  const session = sessionData.session;
  $('historyTitle').textContent = core.modeLabel(session.mode) + ' · ' + core.formatLocalDateTime(session.startedAt);
  const filtered = filterEvents(sessionData.events || []);
  renderEvents($('historyEvents'), filtered, true);
  $('historyCount').textContent = filtered.length + ' of ' + (sessionData.events || []).length + ' events';
  $('historyEmpty').classList.toggle('hidden', filtered.length > 0);
  $('historyEmpty').textContent = filtered.length ? '' : 'No events match this session or filter.';
  $('deleteSessionButton').disabled = session.status === 'active';
  for (const id of ['historyExportCsv', 'historyExportHtml', 'historyExportJson']) $(id).disabled = false;
}

async function selectSession(sessionId, goToHistory = false) {
  await loadSessionData(sessionId);
  if (goToHistory) location.hash = 'history';
}

// ---------------------------------------------------------------------------
// Countdown and polling
// ---------------------------------------------------------------------------

function updateCountdown() {
  if (!activeState) {
    $('liveCountdown').textContent = '';
    return;
  }
  if (!activeState.isReloading || !Number.isFinite(Number(activeState.nextActionAt))) {
    $('liveCountdown').textContent = 'Live checks';
    return;
  }
  const remaining = Math.max(0, (Number(activeState.nextActionAt) - Date.now()) / 1000);
  const phase = activeState.phase === 'pause' ? 'Pause' : 'Next reload';
  $('liveCountdown').textContent = phase + ' in ' + core.formatDuration(remaining);
  $('liveCountdown').classList.remove('hidden');
}

async function poll() {
  if (document.hidden || polling) return;
  polling = true;
  try {
    await loadSessions();
    if (selectedSessionId) {
      const session = sessions.find((item) => item.id === selectedSessionId);
      if (session && (session.status === 'active' || (session.eventCount || 0) !== ((sessionData && sessionData.session.eventCount) || 0))) {
        await loadSessionData(selectedSessionId, { silent: true });
      }
    }
  } catch (error) {
    $('engineState').textContent = 'Error';
    $('engineState').classList.add('error');
  } finally {
    polling = false;
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

async function exportSession(kind) {
  if (!selectedSessionId) {
    showToast('Select a session first.', true);
    return;
  }
  try {
    const response = await send({ type: 'GET_SESSION_DATA', sessionId: selectedSessionId });
    if (!response.session) {
      showToast('The session could not be loaded.', true);
      return;
    }
    const extension = kind === 'csv' ? 'csv' : kind === 'html' ? 'html' : 'json';
    let content;
    let mime;
    if (kind === 'csv') {
      content = '\ufeff' + core.buildCsvReport(response.session, response.events);
      mime = 'text/csv;charset=utf-8';
    } else if (kind === 'html') {
      content = core.buildHtmlReport(response.session, response.events, response.stats);
      mime = 'text/html;charset=utf-8';
    } else {
      content = core.buildJsonReport(response.session, response.events, response.stats);
      mime = 'application/json;charset=utf-8';
    }
    downloadText(content, core.reportFilename(response.session, extension), mime);
    showToast('Report exported as ' + extension.toUpperCase() + '.');
  } catch (error) {
    showToast(error.message, true);
  }
}

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

function downloadDataUrl(dataUrl, filename) {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function renderScreenshots() {
  const token = ++screenshotToken;
  const grid = $('screenshotGrid');
  const note = $('screenshotNote');
  grid.textContent = '';
  if (!sessionData || !sessionData.session) {
    note.textContent = 'No session selected.';
    return;
  }
  const session = sessionData.session;
  if (typeof OdesScreenshots === 'undefined') {
    note.textContent = 'Screenshot storage is unavailable in this browser context.';
    return;
  }
  let entries = [];
  try {
    entries = await OdesScreenshots.listBySession(session.id);
  } catch (error) {
    note.textContent = 'Screenshots could not be loaded: ' + error.message;
    return;
  }
  if (token !== screenshotToken) return;
  const signature = session.id + ':' + entries.map((entry) => entry.id + ':' + entry.bytes).join(',');
  if (signature === lastScreenshotSignature) return;
  lastScreenshotSignature = signature;
  const totalBytes = entries.reduce((sum, entry) => sum + (entry.bytes || 0), 0);
  note.textContent = entries.length
    ? entries.length + ' screenshot(s), ' + core.formatBytes(totalBytes) + ' stored locally in IndexedDB. Never uploaded.'
    : 'No screenshots stored for this session. Screenshots are opt-in and capture only the visible viewport of the active, focused tab.';
  $('clearScreenshotsButton').disabled = entries.length === 0;
  for (const entry of entries) {
    if (token !== screenshotToken) return;
    let record;
    try {
      record = await OdesScreenshots.getById(entry.id);
    } catch (_) {
      continue;
    }
    if (!record) continue;
    const card = document.createElement('div');
    card.className = 'screenshot-card';
    const image = document.createElement('img');
    image.src = record.dataUrl;
    image.alt = 'Screenshot captured at ' + core.formatLocalDateTime(record.timestamp);
    image.loading = 'lazy';
    const meta = document.createElement('div');
    meta.className = 'screenshot-meta';
    const time = document.createElement('div');
    time.textContent = core.formatLocalDateTime(record.timestamp);
    const size = document.createElement('div');
    size.textContent = core.formatBytes(record.bytes) + ' · local only';
    const actions = document.createElement('div');
    actions.className = 'actions';
    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'secondary';
    download.textContent = 'Download';
    download.addEventListener('click', () => {
      downloadDataUrl(record.dataUrl, core.sanitizeFilename('odesoftami-screenshot-' + record.timestamp) + '.jpg');
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      try {
        await OdesScreenshots.deleteById(record.id);
        showToast('Screenshot deleted.');
        renderScreenshots();
      } catch (error) {
        showToast(error.message, true);
      }
    });
    actions.appendChild(download);
    actions.appendChild(remove);
    meta.appendChild(time);
    meta.appendChild(size);
    meta.appendChild(actions);
    card.appendChild(image);
    card.appendChild(meta);
    grid.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

async function loadPresets() {
  const response = await send({ type: 'GET_PRESETS' });
  builtins = response.builtins || [];
  customPresets = response.presets || [];
  renderPresetList();
}

function presetMeta(config, mode) {
  const parts = [core.modeLabel(mode || config.mode)];
  if (mode !== 'monitor') parts.push('every ' + core.formatDuration(config.intervalSeconds));
  if (config.text && config.text.enabled) parts.push(core.textConditionLabel(config.text.condition));
  if (config.dom && config.dom.enabled) parts.push('DOM watcher');
  if (config.url && config.url.enabled) parts.push('URL check');
  return parts.join(' · ');
}

function presetAction(label, className, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className || 'secondary';
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function renderPresetList() {
  const list = $('presetList');
  list.textContent = '';
  const all = [
    ...builtins.map((preset) => ({ ...preset, builtin: true })),
    ...customPresets.map((preset) => ({ ...preset, builtin: false }))
  ];
  if (!all.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No presets available.';
    list.appendChild(empty);
    return;
  }
  for (const preset of all) {
    const card = document.createElement('div');
    card.className = 'preset-card';
    const head = document.createElement('div');
    head.className = 'preset-head';
    const title = document.createElement('h3');
    title.textContent = preset.name;
    head.appendChild(title);
    if (preset.builtin) {
      const pill = document.createElement('span');
      pill.className = 'builtin-pill';
      pill.textContent = 'Built-in';
      head.appendChild(pill);
    }
    const description = document.createElement('p');
    description.textContent = preset.description || 'No description.';
    const meta = document.createElement('div');
    meta.className = 'preset-meta';
    meta.textContent = presetMeta(preset.config, preset.mode);
    const actions = document.createElement('div');
    actions.className = 'preset-actions';
    if (preset.builtin) {
      actions.appendChild(presetAction('Use as template', 'secondary', () => {
        fillPresetForm(null, preset);
        location.hash = 'presets';
        $('presetName').focus();
      }));
      actions.appendChild(presetAction('Export', 'secondary', () => {
        downloadText(core.exportPresets([preset]), core.sanitizeFilename('odesoftami-preset-' + preset.name) + '.json', 'application/json;charset=utf-8');
      }));
    } else {
      actions.appendChild(presetAction('Edit', 'secondary', () => {
        fillPresetForm(preset);
        $('presetName').focus();
      }));
      actions.appendChild(presetAction('Duplicate', 'secondary', () => {
        fillPresetForm(null, { ...preset, name: preset.name + ' copy' });
      }));
      actions.appendChild(presetAction('Export', 'secondary', () => {
        downloadText(core.exportPresets([preset]), core.sanitizeFilename('odesoftami-preset-' + preset.name) + '.json', 'application/json;charset=utf-8');
      }));
      actions.appendChild(presetAction('Delete', 'danger', async () => {
        if (!confirm('Delete preset “' + preset.name + '”?')) return;
        try {
          await send({ type: 'DELETE_PRESET', id: preset.id });
          if (editingPresetId === preset.id) resetPresetForm();
          await loadPresets();
          showToast('Preset deleted.');
        } catch (error) {
          showToast(error.message, true);
        }
      }));
    }
    card.appendChild(head);
    card.appendChild(description);
    card.appendChild(meta);
    card.appendChild(actions);
    list.appendChild(card);
  }
}

function fillPresetForm(preset, template) {
  const source = preset || template;
  const config = core.normalizeConfig(source ? { ...source.config, mode: source.mode } : core.defaultConfig('refresh'));
  editingPresetId = preset ? preset.id : null;
  $('presetFormTitle').textContent = preset ? 'Edit preset' : (template && template.builtin ? 'New preset from template' : 'Create a preset');
  $('presetName').value = source ? source.name : 'My QA preset';
  $('presetDescription').value = source ? (source.description || '') : '';
  $('presetMode').value = config.mode;
  $('presetInterval').value = config.intervalSeconds;
  $('presetCycleMode').value = config.cycleMode;
  $('presetReloads').value = config.reloadsPerCycle;
  $('presetPause').value = config.pauseSeconds;
  $('presetAutoRefresh').checked = config.autoRefresh;
  $('presetTextEnabled').checked = config.text.enabled;
  $('presetTextCondition').value = config.text.condition;
  $('presetTextPattern').value = config.text.pattern;
  $('presetTextRegex').checked = config.text.regex;
  $('presetDomEnabled').checked = config.dom.enabled;
  $('presetDomCondition').value = config.dom.condition;
  $('presetDomSelector').value = config.dom.selector;
  $('presetDomExpected').value = config.dom.expectedText;
  $('presetUrlEnabled').checked = config.url.enabled;
  $('presetExpectedUrl').value = config.url.expectedUrl;
  $('presetIgnoreHash').checked = config.url.ignoreHash;
  $('presetHttp').checked = config.http.enabled;
  $('presetTiming').checked = config.timing.enabled;
  $('presetBudget').value = config.timing.budgetMs;
  $('presetSettle').value = config.settleMs;
  $('presetNotifyMatch').checked = config.notifyOnMatch;
  $('presetNotifyFailure').checked = config.notifyOnFailure;
  $('presetStopMatch').checked = config.stopOnMatch;
  $('presetStopFailure').checked = config.stopOnFailure;
  $('presetScreenshot').checked = config.screenshotOnFailure;
  $('presetFormError').classList.add('hidden');
  syncPresetModeFields();
  $('presetForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetPresetForm() {
  editingPresetId = null;
  const config = core.defaultConfig($('presetMode').value || 'refresh');
  fillPresetForm(null, {
    name: 'My QA preset',
    description: '',
    mode: config.mode,
    config
  });
  editingPresetId = null;
  $('presetFormTitle').textContent = 'Create a preset';
}

function syncPresetModeFields() {
  const mode = $('presetMode').value;
  const isRefresh = mode === 'refresh';
  for (const id of ['presetDomEnabled', 'presetDomCondition', 'presetDomSelector', 'presetDomExpected',
    'presetUrlEnabled', 'presetExpectedUrl', 'presetIgnoreHash', 'presetAutoRefresh']) {
    $(id).disabled = isRefresh || (id === 'presetAutoRefresh' && mode !== 'qa');
  }
  $('presetModeHint').textContent = mode === 'refresh'
    ? 'Refresh mode keeps the legacy text condition; DOM and URL checks are unavailable.'
    : mode === 'monitor' ? 'Monitor mode runs live checks without reloading.' : 'QA Session can combine live checks with timed reloads.';
}

function configFromPresetForm() {
  const mode = $('presetMode').value;
  const isRefresh = mode === 'refresh';
  return {
    mode,
    intervalSeconds: Number($('presetInterval').value),
    cycleMode: $('presetCycleMode').value,
    reloadsPerCycle: Number($('presetReloads').value),
    pauseSeconds: Number($('presetPause').value),
    autoRefresh: mode === 'qa' ? $('presetAutoRefresh').checked : mode !== 'monitor',
    text: {
      enabled: isRefresh ? Boolean($('presetTextPattern').value.trim()) : $('presetTextEnabled').checked,
      condition: $('presetTextCondition').value,
      pattern: $('presetTextPattern').value,
      regex: $('presetTextRegex').checked
    },
    dom: {
      enabled: !isRefresh && $('presetDomEnabled').checked,
      selector: $('presetDomSelector').value,
      condition: $('presetDomCondition').value,
      expectedText: $('presetDomExpected').value
    },
    url: {
      enabled: !isRefresh && $('presetUrlEnabled').checked,
      expectedUrl: $('presetExpectedUrl').value,
      ignoreHash: $('presetIgnoreHash').checked
    },
    http: { enabled: $('presetHttp').checked },
    timing: { enabled: $('presetTiming').checked, budgetMs: Number($('presetBudget').value) },
    settleMs: Number($('presetSettle').value),
    notifyOnMatch: $('presetNotifyMatch').checked,
    notifyOnFailure: $('presetNotifyFailure').checked,
    stopOnMatch: $('presetStopMatch').checked,
    stopOnFailure: $('presetStopFailure').checked,
    screenshotOnFailure: $('presetScreenshot').checked
  };
}

$('presetForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = $('presetFormError');
  errorBox.classList.add('hidden');
  const config = configFromPresetForm();
  const name = $('presetName').value.trim();
  const draft = {
    id: editingPresetId || undefined,
    name,
    description: $('presetDescription').value.trim(),
    mode: config.mode,
    config
  };
  const existingNames = customPresets
    .filter((preset) => preset.id !== editingPresetId)
    .map((preset) => preset.name);
  const check = core.validatePreset(draft, {
    selectorValidator: (selector) => core.validateSelectorWithDom(document, selector),
    existingNames
  });
  if (!check.ok) {
    errorBox.textContent = check.errors.join(' ');
    errorBox.classList.remove('hidden');
    return;
  }
  try {
    const response = await send({ type: 'SAVE_PRESET', preset: check.preset });
    editingPresetId = response.preset.id;
    await loadPresets();
    $('presetFormTitle').textContent = 'Edit preset';
    $('presetName').value = response.preset.name;
    showToast('Preset saved: ' + response.preset.name, false);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.classList.remove('hidden');
  }
});

$('presetMode').addEventListener('change', syncPresetModeFields);
$('presetCancelButton').addEventListener('click', resetPresetForm);

$('exportPresetsButton').addEventListener('click', () => {
  if (!customPresets.length) {
    showToast('There are no custom presets to export.', true);
    return;
  }
  downloadText(core.exportPresets(customPresets), 'odesoftami-presets.json', 'application/json;charset=utf-8');
});

$('importPresetsInput').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const status = $('presetStatus');
  status.textContent = '';
  if (file.size > core.LIMITS.maxPresetFileBytes) {
    status.textContent = 'The import file is too large (maximum 256 KB).';
    status.style.color = '#b42318';
    return;
  }
  try {
    const text = await file.text();
    const response = await send({ type: 'IMPORT_PRESETS', json: text });
    await loadPresets();
    status.textContent = 'Imported ' + response.imported + ' preset(s).' + (response.errors && response.errors.length ? ' Skipped: ' + response.errors.join(' ') : '');
    status.style.color = response.errors && response.errors.length ? '#9a5b00' : '#167747';
    showToast('Imported ' + response.imported + ' preset(s).');
  } catch (error) {
    status.textContent = error.message;
    status.style.color = '#b42318';
  }
});

// ---------------------------------------------------------------------------
// Views and wiring
// ---------------------------------------------------------------------------

function switchView(view, updateHash = false) {
  currentView = ['overview', 'history', 'presets'].includes(view) ? view : 'overview';
  for (const tab of document.querySelectorAll('.dash-tab')) {
    const active = tab.dataset.view === currentView;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', String(active));
  }
  $('overviewView').classList.toggle('hidden', currentView !== 'overview');
  $('historyView').classList.toggle('hidden', currentView !== 'history');
  $('presetsView').classList.toggle('hidden', currentView !== 'presets');
  if (currentView === 'presets') loadPresets().catch((error) => showToast(error.message, true));
  if (currentView === 'history') renderHistory();
  if (currentView === 'overview') renderOverview();
  if (updateHash && location.hash !== '#' + currentView) location.hash = currentView;
}

function applyHash() {
  const hash = location.hash.replace('#', '');
  switchView(hash || 'overview', false);
}

for (const tab of document.querySelectorAll('.dash-tab')) {
  tab.addEventListener('click', () => {
    location.hash = tab.dataset.view;
    switchView(tab.dataset.view, false);
  });
}
window.addEventListener('hashchange', applyHash);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) poll();
});

$('sessionSelect').addEventListener('change', () => {
  if ($('sessionSelect').value) loadSessionData($('sessionSelect').value);
});
$('refreshButton').addEventListener('click', async () => {
  try {
    await loadSessions();
    if (selectedSessionId) await loadSessionData(selectedSessionId);
    showToast('Dashboard refreshed.');
  } catch (error) {
    showToast(error.message, true);
  }
});
$('stopSessionButton').addEventListener('click', async () => {
  if (!sessionData || !sessionData.session || sessionData.session.tabId === null) return;
  if (!confirm('Stop the active session on this tab?')) return;
  try {
    await send({ type: 'STOP_SESSION', tabId: sessionData.session.tabId, reason: 'user' });
    await loadSessions();
    await loadSessionData(selectedSessionId);
    showToast('Session stopped.');
  } catch (error) {
    showToast(error.message, true);
  }
});
$('deleteSessionButton').addEventListener('click', async () => {
  if (!sessionData || !sessionData.session) return;
  if (!confirm('Delete this session and all of its events and screenshots?')) return;
  try {
    await send({ type: 'DELETE_SESSION', sessionId: sessionData.session.id });
    selectedSessionId = null;
    sessionData = null;
    activeState = null;
    await loadSessions();
    await loadPresets();
    showToast('Session deleted.');
  } catch (error) {
    showToast(error.message, true);
  }
});
$('clearHistoryButton').addEventListener('click', () => clearCompletedHistory());
$('clearHistoryQuick').addEventListener('click', () => clearCompletedHistory());
$('clearScreenshotsButton').addEventListener('click', async () => {
  if (!sessionData || !sessionData.session) return;
  if (!confirm('Delete all screenshots stored for this session?')) return;
  try {
    await OdesScreenshots.deleteBySession(sessionData.session.id);
    await renderScreenshots();
    showToast('Session screenshots cleared.');
  } catch (error) {
    showToast(error.message, true);
  }
});

for (const id of ['exportCsv', 'historyExportCsv']) {
  if ($(id)) $(id).addEventListener('click', () => exportSession('csv'));
}
for (const id of ['exportHtml', 'historyExportHtml']) {
  if ($(id)) $(id).addEventListener('click', () => exportSession('html'));
}
for (const id of ['exportJson', 'historyExportJson']) {
  if ($(id)) $(id).addEventListener('click', () => exportSession('json'));
}

$('filterResult').addEventListener('change', renderHistory);
$('filterType').addEventListener('change', renderHistory);
$('filterText').addEventListener('input', renderHistory);
$('clearFilters').addEventListener('click', () => {
  $('filterResult').value = '';
  $('filterType').value = '';
  $('filterText').value = '';
  renderHistory();
});

async function init() {
  setupBranding();
  applyHash();
  try {
    await loadSessions({ initial: true });
    await loadPresets();
  } catch (error) {
    showToast('Could not load dashboard data: ' + error.message, true);
    $('engineState').textContent = 'Error';
    $('engineState').classList.add('error');
  }
  pollTimer = setInterval(poll, 3000);
  countdownTimer = setInterval(updateCountdown, 500);
}

init();
