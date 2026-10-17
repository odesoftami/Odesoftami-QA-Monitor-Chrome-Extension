/* Odesoftami QA Monitor — options controller (v3.1.0) */
'use strict';

const core = OdesCore;

const $ = (id) => document.getElementById(id);

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || response.ok === false) {
    throw new Error((response && response.error) || 'The extension did not respond.');
  }
  return response;
}

function setStatus(message, error = false) {
  $('status').textContent = message;
  $('status').style.color = error ? '#b42318' : '#167747';
}

function setDataStatus(message, error = false) {
  $('dataStatus').textContent = message;
  $('dataStatus').style.color = error ? '#b42318' : '#167747';
}

async function loadSettings() {
  const response = await send({ type: 'GET_SETTINGS' });
  const settings = response.settings || core.DEFAULT_SETTINGS;
  $('bypassCache').checked = Boolean(settings.bypassCache);
  $('showCountdown').checked = settings.showCountdown !== false;
  $('defaultMode').value = settings.defaultMode;
  $('settleMs').value = settings.settleMs;
  $('historyLimit').value = String(settings.historyLimit);
  $('notifyOnFailure').checked = settings.notifyOnFailure !== false;
  $('screenshotOnFailure').checked = Boolean(settings.screenshotOnFailure);
  $('floatingPanelEnabled').checked = settings.floatingPanelEnabled !== false;
  $('floatingPanelDefaultPosition').value = settings.floatingPanelDefaultPosition;
  $('floatingPanelDefaultCollapsed').checked = Boolean(settings.floatingPanelDefaultCollapsed);
  $('floatingPanelRetainSummary').checked = settings.floatingPanelRetainSummary !== false;
}

async function refreshUsage() {
  try {
    const response = await send({ type: 'GET_DIAGNOSTICS' });
    const parts = [];
    parts.push('IndexedDB screenshots: ' + (response.screenshotUsage
      ? response.screenshotUsage.count + ' / ' + response.screenshotUsage.maxEntries + ' · ' + core.formatBytes(response.screenshotUsage.bytes)
      : 'unavailable'));
    parts.push('chrome.storage.local: ' + (response.storageBytes === null || response.storageBytes === undefined
      ? 'unavailable'
      : core.formatBytes(response.storageBytes)));
    parts.push('Sessions stored: ' + response.sessions);
    parts.push('Active sessions: ' + response.activeSessions);
    if (response.storageWarning) parts.push('Storage warning: ' + response.storageWarning);
    $('storageUsage').textContent = parts.join(' · ');
  } catch (error) {
    $('storageUsage').textContent = 'Storage usage is unavailable: ' + error.message;
  }
}

$('save').addEventListener('click', async () => {
  setStatus('');
  const settings = core.normalizeSettings({
    bypassCache: $('bypassCache').checked,
    showCountdown: $('showCountdown').checked,
    defaultMode: $('defaultMode').value,
    settleMs: Number($('settleMs').value),
    historyLimit: Number($('historyLimit').value),
    notifyOnFailure: $('notifyOnFailure').checked,
    screenshotOnFailure: $('screenshotOnFailure').checked,
    floatingPanelEnabled: $('floatingPanelEnabled').checked,
    floatingPanelDefaultPosition: $('floatingPanelDefaultPosition').value,
    floatingPanelDefaultCollapsed: $('floatingPanelDefaultCollapsed').checked,
    floatingPanelRetainSummary: $('floatingPanelRetainSummary').checked
  });
  try {
    await send({ type: 'SAVE_SETTINGS', settings });
    $('settleMs').value = settings.settleMs;
    $('historyLimit').value = String(settings.historyLimit);
    setStatus('Settings saved.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

$('clearHistory').addEventListener('click', async () => {
  setDataStatus('');
  if (!confirm('Delete all completed QA sessions and their historical events? Active sessions, presets, settings and stored screenshots are preserved.')) return;
  try {
    const response = await send({ type: 'CLEAR_HISTORY' });
    setDataStatus('Removed ' + response.removed + ' completed session(s). Screenshots were preserved.');
    await refreshUsage();
  } catch (error) {
    setDataStatus(error.message, true);
  }
});

$('clearScreenshots').addEventListener('click', async () => {
  setDataStatus('');
  if (!confirm('Delete all screenshots stored locally by this extension?')) return;
  try {
    await OdesScreenshots.clearAll();
    setDataStatus('Stored screenshots cleared.');
    await refreshUsage();
  } catch (error) {
    setDataStatus(error.message, true);
  }
});

const manifest = chrome.runtime.getManifest();
document.getElementById('optionsVersion').textContent = 'v' + manifest.version;

Promise.all([loadSettings(), refreshUsage()]).catch((error) => {
  setStatus('Could not load settings: ' + error.message, true);
});
