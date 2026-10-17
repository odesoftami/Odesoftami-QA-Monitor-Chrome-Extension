/*
 * Odesoftami QA Monitor — floating QA panel (v3.1.0)
 *
 * This file is a UI-only content script. It does not observe the page, collect
 * events or manage a session. It reads the existing session through the
 * service worker (GET_PANEL_DATA) and can ask the existing engine to stop.
 *
 * The panel lives in a Shadow DOM host appended to <html>, so page CSS cannot
 * break it and panel CSS cannot affect the page.
 */
(() => {
  'use strict';
  if (window.__odesoftamiFloatingPanelInstalled) return;
  window.__odesoftamiFloatingPanelInstalled = true;

  const HOST_ATTR = 'data-odesoftami-floating-panel';
  const POLL_MS = 1500;
  const POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

  const state = {
    host: null,
    shadow: null,
    panel: null,
    refs: null,
    timer: null,
    sessionId: null,
    mode: null,
    settings: {},
    config: null,
    data: null,
    collapsed: false,
    hidden: false,
    hiddenSessionId: null,
    userPositioned: false,
    userCollapsed: false,
    prefsApplied: false,
    drag: null,
    destroyed: true,
    resizeHandler: null,
    visibilityHandler: null,
    lastError: null
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel {
      position: fixed;
      width: 306px;
      background: #ffffff;
      color: #202633;
      border: 1px solid #d9e0e8;
      border-radius: 12px;
      box-shadow: 0 12px 34px rgba(32, 38, 51, .22), 0 2px 8px rgba(32, 38, 51, .10);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      font-size: 11px;
      line-height: 1.35;
      pointer-events: auto;
      overflow: hidden;
      user-select: none;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 9px 9px 10px;
      background: #202633;
      color: #fff;
      cursor: move;
      touch-action: none;
    }
    .brand { display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1; }
    .logo {
      width: 22px; height: 22px; border-radius: 6px; background: #f39224;
      color: #fff; display: grid; place-items: center; font-size: 17px; font-weight: 600;
      flex: 0 0 auto;
    }
    .titles { min-width: 0; }
    .titles strong { display: block; font-size: 10.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .titles span { display: block; color: #aab4c2; font-size: 8.5px; margin-top: 1px; text-transform: uppercase; letter-spacing: .04em; }
    .bar-actions { display: flex; gap: 2px; flex: 0 0 auto; }
    .icon-button {
      width: 22px; height: 22px; border: 0; border-radius: 5px; background: transparent;
      color: #cdd5e0; font: inherit; font-size: 15px; line-height: 1; cursor: pointer;
      display: grid; place-items: center; padding: 0;
    }
    .icon-button:hover { background: #ffffff1f; color: #fff; }
    .body { padding: 10px; }
    .status-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #9aa3b0; flex: 0 0 auto; }
    .dot.live { background: #1aab63; box-shadow: 0 0 0 3px #1aab631c; }
    .dot.failure { background: #c62828; box-shadow: 0 0 0 3px #c628281c; }
    .status-text { font-weight: 700; font-size: 10px; color: #344054; }
    .phase { margin-left: auto; color: #7b8492; font-size: 8.5px; text-transform: uppercase; letter-spacing: .04em; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-bottom: 8px; }
    .stat { border: 1px solid #edf0f4; background: #f8fafc; border-radius: 7px; padding: 5px 4px; text-align: center; min-width: 0; }
    .stat span { display: block; color: #7b8492; font-size: 7.5px; text-transform: uppercase; letter-spacing: .04em; }
    .stat strong { display: block; margin-top: 1px; font-size: 14px; font-variant-numeric: tabular-nums; }
    .stat.pass strong { color: #16803c; }
    .stat.fail strong { color: #b42318; }
    .stat.warn strong { color: #9a5b00; }
    .stat.unknown strong { color: #596273; }
    .latest { border-top: 1px solid #edf0f4; padding-top: 7px; margin-bottom: 7px; }
    .label { display: block; color: #7b8492; font-size: 8px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 2px; }
    .latest-text {
      font-size: 9.5px; color: #4d5664; line-height: 1.4; max-height: 38px; overflow: hidden;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word;
    }
    .meta { display: flex; justify-content: space-between; gap: 8px; color: #7b8492; font-size: 8.5px; margin-bottom: 8px; }
    .actions { display: flex; gap: 6px; }
    .button {
      border: 1px solid #d5dce5; background: #fff; color: #344054; border-radius: 6px;
      padding: 6px 8px; font: inherit; font-size: 9px; font-weight: 700; cursor: pointer;
      flex: 1; white-space: nowrap;
    }
    .button:hover { background: #f7f9fb; }
    .button.primary { background: #f39224; border-color: #e68113; color: #fff; }
    .button.primary:hover { background: #e68113; }
    .button.danger { background: #fff; border-color: #f0c8c8; color: #b42318; }
    .button.danger:hover { background: #fff5f5; }
    .button:disabled { opacity: .55; cursor: not-allowed; }
    .collapsed-pill {
      display: flex; align-items: center; gap: 7px; border: 1px solid #d9e0e8;
      background: #202633; color: #fff; border-radius: 999px; padding: 7px 11px;
      box-shadow: 0 8px 22px rgba(32,38,51,.24); cursor: pointer; font: inherit;
      font-size: 9.5px; font-weight: 700;
    }
    .collapsed-pill .pill-logo { width: 17px; height: 17px; border-radius: 50%; background: #f39224; display: grid; place-items: center; font-size: 13px; }
    .collapsed-pill .pill-fail { color: #ffb4b4; margin-left: 1px; }
    .collapsed-pill .pill-fail.zero { color: #aab4c2; }
    .hidden { display: none !important; }
    @media (prefers-reduced-motion: no-preference) {
      .panel { transition: box-shadow .15s ease; }
    }
  `;

  function send(message) {
    try {
      return chrome.runtime.sendMessage(message);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function formatMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    return ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s';
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const seconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours) return hours + 'h ' + (minutes % 60) + 'm';
    if (minutes) return minutes + 'm ' + (seconds % 60) + 's';
    return seconds + 's';
  }

  function modeLabel(mode) {
    return mode === 'qa' ? 'QA Session' : 'Monitor';
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function buildDom(shadow) {
    const panel = createElement('div', 'panel');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Odesoftami QA Monitor floating panel');

    const bar = createElement('div', 'bar');
    const brand = createElement('div', 'brand');
    const logo = createElement('div', 'logo', '↻');
    const titles = createElement('div', 'titles');
    const title = createElement('strong', '', 'Odesoftami QA Monitor');
    const mode = createElement('span', '', 'Monitor');
    titles.appendChild(title);
    titles.appendChild(mode);
    brand.appendChild(logo);
    brand.appendChild(titles);
    const barActions = createElement('div', 'bar-actions');
    const collapse = createElement('button', 'icon-button', '–');
    collapse.type = 'button';
    collapse.title = 'Collapse panel';
    collapse.setAttribute('aria-label', 'Collapse panel');
    const hide = createElement('button', 'icon-button', '×');
    hide.type = 'button';
    hide.title = 'Hide panel (monitoring continues)';
    hide.setAttribute('aria-label', 'Hide panel; monitoring continues');
    barActions.appendChild(collapse);
    barActions.appendChild(hide);
    bar.appendChild(brand);
    bar.appendChild(barActions);

    const body = createElement('div', 'body');
    const statusRow = createElement('div', 'status-row');
    const dot = createElement('span', 'dot');
    const statusText = createElement('span', 'status-text', 'Live');
    const phase = createElement('span', 'phase', '');
    statusRow.appendChild(dot);
    statusRow.appendChild(statusText);
    statusRow.appendChild(phase);

    const stats = createElement('div', 'stats');
    const statRefs = {};
    for (const [key, label] of [['pass', 'PASS'], ['fail', 'FAIL'], ['warn', 'WARN'], ['unknown', 'UNKNOWN']]) {
      const stat = createElement('div', 'stat ' + key);
      stat.appendChild(createElement('span', '', label));
      const value = createElement('strong', '', '0');
      stat.appendChild(value);
      statRefs[key] = value;
      stats.appendChild(stat);
    }

    const latest = createElement('div', 'latest');
    latest.appendChild(createElement('span', 'label', 'Latest event'));
    const latestText = createElement('div', 'latest-text', 'Waiting for events…');
    latest.appendChild(latestText);

    const meta = createElement('div', 'meta');
    const load = createElement('span', '', 'Load —');
    const duration = createElement('span', '', 'Session —');
    meta.appendChild(load);
    meta.appendChild(duration);

    const actions = createElement('div', 'actions');
    const dashboard = createElement('button', 'button', 'Dashboard');
    dashboard.type = 'button';
    const stop = createElement('button', 'button danger', 'Stop');
    stop.type = 'button';
    const dismiss = createElement('button', 'button primary hidden', 'Dismiss');
    dismiss.type = 'button';
    actions.appendChild(dashboard);
    actions.appendChild(stop);
    actions.appendChild(dismiss);

    body.appendChild(statusRow);
    body.appendChild(stats);
    body.appendChild(latest);
    body.appendChild(meta);
    body.appendChild(actions);

    const collapsedPill = createElement('button', 'collapsed-pill hidden');
    collapsedPill.type = 'button';
    collapsedPill.title = 'Expand QA panel';
    const pillLogo = createElement('span', 'pill-logo', '↻');
    const pillText = createElement('span', '', 'QA');
    const pillFail = createElement('span', 'pill-fail zero', '0 FAIL');
    collapsedPill.appendChild(pillLogo);
    collapsedPill.appendChild(pillText);
    collapsedPill.appendChild(pillFail);

    panel.appendChild(bar);
    panel.appendChild(body);
    panel.appendChild(collapsedPill);
    shadow.appendChild(panel);

    state.refs = {
      panel, bar, mode, collapse, hide, body, dot, statusText, phase, stats: statRefs,
      latestText, load, duration, dashboard, stop, dismiss, collapsedPill, pillFail
    };
    return state.refs;
  }

  function clampPosition(x, y) {
    if (!state.refs || !state.refs.panel) return { x: 14, y: 14 };
    const rect = state.refs.panel.getBoundingClientRect();
    const width = rect.width || 306;
    const height = rect.height || 160;
    const maxX = Math.max(8, window.innerWidth - width - 8);
    const maxY = Math.max(8, window.innerHeight - height - 8);
    return {
      x: Math.min(maxX, Math.max(8, Math.round(Number(x) || 0))),
      y: Math.min(maxY, Math.max(8, Math.round(Number(y) || 0)))
    };
  }

  function applyPosition(x, y) {
    if (!state.refs || !state.refs.panel) return;
    const point = clampPosition(x, y);
    state.refs.panel.style.left = point.x + 'px';
    state.refs.panel.style.top = point.y + 'px';
  }

  function defaultPosition() {
    const corner = POSITIONS.includes(state.settings.floatingPanelDefaultPosition)
      ? state.settings.floatingPanelDefaultPosition
      : 'bottom-right';
    if (!state.refs || !state.refs.panel) return { x: 14, y: 14 };
    const rect = state.refs.panel.getBoundingClientRect();
    const width = rect.width || 306;
    const height = rect.height || 160;
    const margin = 16;
    if (corner === 'bottom-left') return { x: margin, y: window.innerHeight - height - margin };
    if (corner === 'top-right') return { x: window.innerWidth - width - margin, y: margin };
    if (corner === 'top-left') return { x: margin, y: margin };
    return { x: window.innerWidth - width - margin, y: window.innerHeight - height - margin };
  }

  function applyPrefs(prefs) {
    if (!prefs || state.userPositioned || state.userCollapsed) return;
    state.prefsApplied = true;
    if (prefs.position && Number.isFinite(Number(prefs.position.x)) && Number.isFinite(Number(prefs.position.y))) {
      applyPosition(prefs.position.x, prefs.position.y);
    }
    if (typeof prefs.collapsed === 'boolean') {
      setCollapsed(prefs.collapsed, { save: false });
    }
  }

  function setCollapsed(collapsed, options = {}) {
    state.collapsed = Boolean(collapsed);
    if (!state.refs) return;
    state.refs.body.classList.toggle('hidden', state.collapsed);
    state.refs.bar.classList.toggle('hidden', state.collapsed);
    state.refs.collapsedPill.classList.toggle('hidden', !state.collapsed);
    if (state.collapsed) {
      const fail = state.data && state.data.counts ? state.data.counts.fail : 0;
      state.refs.pillFail.textContent = fail + ' FAIL';
      state.refs.pillFail.classList.toggle('zero', !fail);
    }
    if (!options.save) return;
    state.userCollapsed = true;
    savePrefs();
    requestAnimationFrame(() => {
      if (!state.refs) return;
      const rect = state.refs.panel.getBoundingClientRect();
      applyPosition(parseFloat(state.refs.panel.style.left) || rect.left, parseFloat(state.refs.panel.style.top) || rect.top);
    });
  }

  function savePrefs() {
    if (!state.refs || !state.refs.panel) return;
    const rect = state.refs.panel.getBoundingClientRect();
    send({
      type: 'SAVE_PANEL_PREFS',
      position: { x: Math.round(rect.left), y: Math.round(rect.top) },
      collapsed: state.collapsed
    }).catch(() => { /* panel preferences are non-critical */ });
  }

  function render(data) {
    if (!data || !state.refs) return;
    state.data = data;
    const counts = data.counts || { pass: 0, fail: 0, warn: 0, unknown: 0 };
    for (const key of ['pass', 'fail', 'warn', 'unknown']) {
      state.refs.stats[key].textContent = String(counts[key] || 0);
    }
    state.refs.mode.textContent = modeLabel(data.mode);
    const active = Boolean(data.active);
    state.refs.dot.className = 'dot' + (active ? (counts.fail > 0 ? ' failure' : ' live') : '');
    state.refs.statusText.textContent = active ? 'Live' : 'Session stopped';
    state.refs.phase.textContent = active
      ? (data.phase === 'pause' ? 'Paused' : 'Live')
      : 'Stopped';

    if (data.latest) {
      const text = data.latest.description || data.latest.result || 'Event recorded';
      state.refs.latestText.textContent = text;
      state.refs.latestText.title = text;
    } else {
      state.refs.latestText.textContent = 'Waiting for events…';
      state.refs.latestText.title = '';
    }
    state.refs.load.textContent = data.loadDurationMs === null || data.loadDurationMs === undefined
      ? 'Load —'
      : 'Load ' + formatMs(data.loadDurationMs);
    state.refs.duration.textContent = 'Session ' + formatDuration(data.durationMs);

    state.refs.stop.disabled = !active;
    state.refs.stop.classList.toggle('hidden', !active);
    state.refs.dismiss.classList.toggle('hidden', active);
    state.refs.pillFail.textContent = (counts.fail || 0) + ' FAIL';
    state.refs.pillFail.classList.toggle('zero', !counts.fail);
    if (!active) {
      stopPolling();
      state.refs.statusText.textContent = data.stopReason ? 'Session stopped' : 'Session ended';
    }
  }

  async function fetchData() {
    if (!state.host || state.hidden) return;
    let response;
    try {
      response = await send({ type: 'GET_PANEL_DATA' });
    } catch (error) {
      state.lastError = error;
      stopPolling();
      return;
    }
    if (!response || response.ok === false || !response.panel) {
      if (state.host) {
        destroy();
      }
      return;
    }
    if (response.settings) state.settings = response.settings;
    state.sessionId = response.panel.sessionId;
    state.mode = response.panel.mode;
    if (!state.prefsApplied) applyPrefs(response.prefs);
    render(response.panel);
    if (response.panel.active && !state.timer) startPolling();
    if (!response.panel.active) stopPolling();
  }

  function startPolling() {
    stopPolling();
    state.timer = setInterval(() => {
      if (!document.hidden) fetchData();
    }, POLL_MS);
  }

  function stopPolling() {
    if (state.timer !== null) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  function onDragStart(event) {
    if (!state.refs || event.button !== 0) return;
    if (event.target && event.target.closest && event.target.closest('button')) return;
    const rect = state.refs.panel.getBoundingClientRect();
    state.drag = {
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      pointerId: event.pointerId
    };
    try { state.refs.bar.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
    window.addEventListener('pointermove', onDragMove, true);
    window.addEventListener('pointerup', onDragEnd, true);
    window.addEventListener('pointercancel', onDragEnd, true);
    event.preventDefault();
  }

  function onDragMove(event) {
    if (!state.drag) return;
    const point = clampPosition(
      state.drag.left + event.clientX - state.drag.startX,
      state.drag.top + event.clientY - state.drag.startY
    );
    state.refs.panel.style.left = point.x + 'px';
    state.refs.panel.style.top = point.y + 'px';
  }

  function onDragEnd() {
    if (!state.drag) return;
    state.drag = null;
    state.userPositioned = true;
    window.removeEventListener('pointermove', onDragMove, true);
    window.removeEventListener('pointerup', onDragEnd, true);
    window.removeEventListener('pointercancel', onDragEnd, true);
    savePrefs();
  }

  function onResize() {
    if (!state.refs || !state.refs.panel) return;
    const left = parseFloat(state.refs.panel.style.left);
    const top = parseFloat(state.refs.panel.style.top);
    if (Number.isFinite(left) && Number.isFinite(top)) applyPosition(left, top);
  }

  function createPanel() {
    if (state.host) return true;
    try {
      const host = document.createElement('div');
      host.setAttribute(HOST_ATTR, '');
      host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
      const shadow = host.attachShadow({ mode: 'open' });
      // Constructable stylesheets avoid a page CSP blocking an inline <style>
      // element inside the shadow root; fall back to a <style> where unsupported.
      try {
        if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in shadow) {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(CSS);
          shadow.adoptedStyleSheets = [sheet];
        } else {
          const style = document.createElement('style');
          style.textContent = CSS;
          shadow.appendChild(style);
        }
      } catch (_) {
        const style = document.createElement('style');
        style.textContent = CSS;
        shadow.appendChild(style);
      }
      document.documentElement.appendChild(host);
      state.host = host;
      state.shadow = shadow;
      state.destroyed = false;
      buildDom(shadow);

      const refs = state.refs;
      refs.bar.addEventListener('pointerdown', onDragStart);
      refs.collapse.addEventListener('click', () => setCollapsed(!state.collapsed, { save: true }));
      refs.collapsedPill.addEventListener('click', () => setCollapsed(false, { save: true }));
      refs.hide.addEventListener('click', () => hide());
      refs.dashboard.addEventListener('click', () => {
        send({ type: 'OPEN_DASHBOARD' }).catch(() => {});
      });
      refs.stop.addEventListener('click', async () => {
        refs.stop.disabled = true;
        refs.statusText.textContent = 'Stopping…';
        try {
          const response = await send({ type: 'PANEL_STOP_SESSION' });
          if (!response || response.ok === false) {
            refs.statusText.textContent = 'Stop failed';
            refs.stop.disabled = false;
          }
        } catch (_) {
          refs.statusText.textContent = 'Stop failed';
          refs.stop.disabled = false;
        }
      });
      refs.dismiss.addEventListener('click', () => hide());

      state.resizeHandler = onResize;
      window.addEventListener('resize', state.resizeHandler);
      return true;
    } catch (error) {
      state.lastError = error;
      try { if (state.host) state.host.remove(); } catch (_) { /* ignore */ }
      state.host = null;
      state.shadow = null;
      state.refs = null;
      return false;
    }
  }

  function show(config) {
    const options = config || {};
    if (!options.enabled || (options.mode !== 'monitor' && options.mode !== 'qa')) {
      destroy();
      return false;
    }
    if (state.hiddenSessionId && state.hiddenSessionId === options.sessionId) {
      return false;
    }
    if (options.sessionId !== state.hiddenSessionId) state.hiddenSessionId = null;
    state.settings = { ...(options.settings || {}) };
    state.mode = options.mode;
    state.sessionId = options.sessionId || null;
    if (state.host) {
      if (state.refs) {
        state.refs.mode.textContent = modeLabel(state.mode);
        state.refs.panel.classList.remove('hidden');
      }
      fetchData();
      return true;
    }
    state.hidden = false;
    if (!createPanel()) return false;
    const initial = defaultPosition();
    applyPosition(initial.x, initial.y);
    if (state.settings.floatingPanelDefaultCollapsed) {
      setCollapsed(true, { save: false });
    }
    fetchData();
    startPolling();
    return true;
  }

  async function finalize(options = {}) {
    const retain = options.retain !== false;
    if (!state.host) return;
    stopPolling();
    let response = null;
    try { response = await send({ type: 'GET_PANEL_DATA' }); } catch (_) { response = null; }
    if (!retain) {
      destroy();
      return;
    }
    if (response && response.panel) {
      render(response.panel);
      if (state.refs) {
        state.refs.stop.classList.add('hidden');
        state.refs.stop.disabled = true;
        state.refs.dismiss.classList.remove('hidden');
        state.refs.statusText.textContent = 'Session stopped';
      }
    } else if (state.refs) {
      state.refs.statusText.textContent = 'Session stopped';
      state.refs.stop.classList.add('hidden');
      state.refs.stop.disabled = true;
      state.refs.dismiss.classList.remove('hidden');
    }
  }

  function hide() {
    if (state.host) {
      state.hidden = true;
      state.hiddenSessionId = state.sessionId;
      destroy({ keepHidden: true });
    }
  }

  function destroy(options = {}) {
    stopPolling();
    if (state.resizeHandler) {
      window.removeEventListener('resize', state.resizeHandler);
      state.resizeHandler = null;
    }
    window.removeEventListener('pointermove', onDragMove, true);
    window.removeEventListener('pointerup', onDragEnd, true);
    window.removeEventListener('pointercancel', onDragEnd, true);
    if (state.host) {
      try { state.host.remove(); } catch (_) { /* ignore */ }
    }
    state.host = null;
    state.shadow = null;
    state.panel = null;
    state.refs = null;
    state.data = null;
    state.timer = null;
    state.destroyed = true;
    state.prefsApplied = false;
    state.userPositioned = false;
    state.userCollapsed = false;
    state.collapsed = false;
    if (!options.keepHidden) {
      state.hidden = false;
      state.hiddenSessionId = null;
    }
  }

  function refresh() {
    if (state.host) fetchData();
  }

  window.OdesoftamiFloatingPanel = {
    show,
    finalize,
    destroy,
    hide,
    refresh,
    isVisible: () => Boolean(state.host),
    _state: state
  };
})();
