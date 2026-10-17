# Architecture — Odesoftami QA Monitor v3.2.0

This document describes the implemented architecture, data flow, storage model and the precise evaluation semantics of the QA checks.

---

## 1. High-level components

```
┌─────────────────────────────────────────────────────────────────────┐
│ Extension pages (popup / dashboard / options / privacy)             │
│  - user configuration and live statistics                           │
│  - report generation and downloads                                  │
│  - local screenshot gallery                                         │
└───────────────▲─────────────────────────────────────────────────────┘
                │ chrome.runtime messages
┌───────────────┴─────────────────────────────────────────────────────┐
│ service-worker.js — thin MV3 event wiring                           │
│  runtime.onMessage / onInstalled / onStartup / onSuspend             │
│  tabs.onUpdated / onRemoved / onReplaced / alarms.onAlarm            │
│  webRequest.onBeforeRequest / onBeforeRedirect / onCompleted /       │
│              onErrorOccurred                                        │
└───────────────┬─────────────────────────────────────────────────────┘
                │ calls
┌───────────────▼─────────────────────────────────────────────────────┐
│ lib/engine.js — background engine                                    │
│  sessions • per-tab locks • refresh schedule • events • webRequest   │
│  policy • notifications • screenshots • quota handling • migration   │
│  lib/core.js — pure validation, event model, stats, scheduling,      │
│               report builders, preset validation                     │
└───────────────▲─────────────────────────────────────────────────────┘
                │ messages
┌───────────────┴─────────────────────────────────────────────────────┐
│ refresh-content.js — isolated world on HTTP/HTTPS pages             │
│  MutationObserver • text/DOM/URL checks • SPA URL poll               │
│  Navigation Timing • refresh timer • badge tick • cleanup            │
├─────────────────────────────────────────────────────────────────────┤
│ panel-content.js — UI-only Shadow-DOM floating QA panel             │
│  polls GET_PANEL_DATA • collapse/drag/hide • stop/dashboard actions  │
│  (no observer, event collection or second session engine)           │
└─────────────────────────────────────────────────────────────────────┘
```

No component makes network requests. Reports and screenshots are generated and stored locally.

**Public footer links:** `lib/core.js` defines the owner-supplied GitHub profile `https://github.com/odesoftami` and Web page `https://odesoftami.com/apk`. The popup footer uses plain external anchors with `rel="noreferrer"`; no network request is made while rendering.

---

## 2. Files and responsibilities

| File | Responsibility |
|---|---|
| `manifest.json` | MV3 manifest, minimum Chrome 120, permissions, content script, icons |
| `service-worker.js` | Registers Chrome listeners synchronously and forwards events to the engine |
| `lib/core.js` | Pure, testable constants, validation, event factory, statistics, scheduling, CSV/HTML/JSON builders, presets |
| `lib/engine.js` | Session lifecycle, storage, per-tab locking, refresh/watchdog, webRequest handling, notifications, screenshots, migration, message dispatch |
| `lib/screenshots.js` | IndexedDB store with pruning and size limits |
| `refresh-content.js` | Page monitor; runs at `document_start` but is dormant until the SW sends a session state |
| `panel-content.js` | Floating QA panel UI; Shadow DOM, live panel data polling, collapse/drag/hide, stop/dashboard actions; no event collection |
| `popup.html/css/js` | Narrow 3-mode launcher, presets, live summary, CSV export |
| `dashboard.html/css/js` | Live overview, full event history, session deletion, screenshots, preset manager, report exports |
| `options.html/css/js` | Defaults, local data controls, permission/privacy explanation |
| `privacy.html` | Bundled privacy policy |
| `tests/unit/` | Node tests with an in-memory Chrome API mock |
| `tests/e2e/` | Real Chromium + CDP integration suite with a local HTTP server |

The original v2.3.0 files are preserved in `_baseline/v2.3.0/`.

---

## 3. Modes

| Mode | `autoRefresh` | Reload schedule | Checks recorded | Intended use |
|---|---|---|---|---|
| `refresh` | forced `true` | continuous or cycles | HTTP/timing/reload events; legacy text values remain supported internally but the card is hidden in v3.2 UI | simple timed refresh |
| `monitor` | forced `false` | none | text, DOM, URL, HTTP/navigation, timing | watch a live page |
| `qa` | user choice (default `true`) | optional continuous/cycles | all checks; full stats/reports/presets/screenshots | recorded QA session |

Mode-specific normalization is enforced in `core.normalizeConfig` and `core.validateConfig`:

- Refresh forces `text.enabled = Boolean(pattern)` internally for compatibility, hides the legacy text card in the UI, disables DOM/URL checks and always records HTTP/timing.
- Monitor forces `autoRefresh = false`.
- QA can disable reloads; it then behaves like a recorded monitor session.

---

## 4. Message protocol

All extension messages are handled by `engine.handleMessage`. Messages from content scripts are restricted to a known allow-list; content scripts cannot start or stop sessions, modify presets or read arbitrary sessions.

### Extension pages → service worker

| Type | Purpose |
|---|---|
| `START_SESSION` | Validate tab/config, create session, persist, inject/sync content |
| `STOP_SESSION` | Stop one tab’s session with a reason |
| `STOP_ALL_SESSIONS` | Stop every active session |
| `GET_STATE` | Active state + latest session, events and stats for one tab |
| `GET_SESSION_DATA` | Session metadata, all bounded events and computed stats |
| `GET_SESSIONS` | Session index + active tab ids + storage warning |
| `DELETE_SESSION` | Delete a completed session, its events and screenshots |
| `CLEAR_HISTORY` | Delete all completed sessions/events; active sessions are kept |
| `GET_PRESETS` / `SAVE_PRESET` / `DELETE_PRESET` / `IMPORT_PRESETS` | Preset CRUD and validated import |
| `GET_SETTINGS` / `SAVE_SETTINGS` | Local defaults |
| `GET_DIAGNOSTICS` | Storage usage, active/session counts, screenshot usage |
| `GET_QA_LOGS` / `CLEAR_QA_LOGS` | v2.3-compatible log view/clear |
| `START_REFRESH` / `STOP_REFRESH` | v2.3-compatible aliases |

### Service worker → content script

| Type | Purpose |
|---|---|
| `SYNC_CONTENT_REFRESH` / `START_CONTENT_REFRESH` | Ask the content script to fetch the current session state |
| `STOP_CONTENT_REFRESH` | Clear timers/observers and stop monitoring |

### Content script → service worker

| Type | Purpose |
|---|---|
| `CONTENT_READY` | Request state after a sync/boot/pageshow |
| `MONITOR_BASELINE` | Report the captured baseline (no page text) |
| `CHECK_RESULT` | Batched text/DOM/URL check results |
| `LOAD_TIMING` | Navigation Timing snapshot |
| `CONTENT_ERROR` | Invalid selector/regex or observer failure |
| `REFRESH_DUE` | Content-side reload timer fired |
| `BADGE_TICK` | Refresh badge countdown tick |
| `TEXT_WATCH_BASELINE` / `TEXT_WATCH_RESULT` / `SEARCH_RESULT` | v2.3 compatibility aliases |
| `GET_PANEL_DATA` | Content panel asks for the existing session’s counts/latest/timing/prefs |
| `SAVE_PANEL_PREFS` | Per-origin panel position/collapsed state |
| `PANEL_STOP_SESSION` | Explicit panel Stop → existing session stop |
| `OPEN_DASHBOARD` | Panel Dashboard button → open local dashboard tab; no session is created |

The content script is **dormant** until it receives a sync/start message. It creates no observer, timer or message on pages without an active session.

---

## 5. Session lifecycle

### Start

1. Validate the tab id and URL (`http(s)` only).
2. Reject a second session for the same tab.
3. Validate/normalize the config; selector syntax is additionally validated by the popup/dashboard; regex is validated in the engine too.
4. Create a session id, durable metadata (`qaSessions`) and runtime state (`chrome.storage.session`).
5. Append `session_start`.
6. Append an explicit `http_status` UNKNOWN event because the already-loaded page’s response status cannot be observed retroactively.
7. Ensure the watchdog alarm, update the badge, inject/sync the content script.
8. Return the public state; the content script then captures a baseline.

### Stop

1. Remove the runtime state **before** any further event processing.
2. Clear the watchdog if no other reloading session exists.
3. Finalize durable data: append `session_stop`, mark stopped, set `endedAt`/`durationMs`/`stopReason`.
4. Send `STOP_CONTENT_REFRESH` (errors ignored if the tab is gone), so the floating panel’s final fetch sees the stopped session.
5. Clear the badge.

Stop reasons: `user`, `tab_closed`, `tab_unavailable`, `failure_condition`, `condition_met`, `reload_failed`, `navigation_error`, `extension_updated`, `service_worker_reset`, `internal_error`.

### Service-worker suspension/restart

- Runtime state lives in `chrome.storage.session`, which survives service-worker suspension but not browser restart.
- On each engine start, `ensureReady` hydrates settings, sessions, presets and runtime.
- Runtime entries whose session/tab no longer exists are finalized.
- Sessions marked active without runtime state are finalized as `service_worker_reset` (this also covers a browser restart).
- On extension install/update, active sessions are stopped with `extension_updated`.
- The watchdog alarm and per-tab locks are re-established.

### Concurrency

- A per-tab promise queue (`withLock`) serializes start/stop/check/navigation mutations for the same tab.
- Different tabs can run independent sessions.
- **All event appends are additionally serialized per session** (`appendEvent` queue), so a baseline write cannot overwrite a concurrent watcher FAIL.
- One runtime entry and one reload timer per tab; the watchdog and content timer both check `nextActionAt` and `lastReloadAt` to prevent double reloads.

---

## 6. Refresh scheduling

- Initial `nextActionAt = now + interval`.
- Content script schedules a `setTimeout` for the exact time and sends `REFRESH_DUE`; the engine verifies the request is not more than 500 ms early and that no reload occurred in the last 1.5 s.
- The engine advances the schedule **before** calling `chrome.tabs.reload`, so a service-worker crash cannot create a reload loop.
- Continuous mode: next = now + interval.
- Cycles mode (v2.3 semantics):
  - reload 1..N−1 → next = now + interval;
  - reload N → phase `pause`, next = now + pause;
  - pause due → phase `active`, reload count reset to 1, next = now + interval.
- `chrome.alarms` creates a single watchdog at a 30-second period (Chrome minimum) while any reloading session exists. It:
  - updates badges;
  - reloads overdue sessions;
  - if a window was missed by more than `max(120 s, interval × 3)`, skips the missed reload, reschedules, and records a WARN instead of creating a reload storm;
  - is cleared when no reloading sessions remain.
- Failed reloads are recorded. Three consecutive reload failures stop the session with `reload_failed`.
- Minimum interval is 2 seconds; maximum is 24 hours.

---

## 7. Check evaluation semantics

### 7.1 Baseline

- Captured when `document.readyState` is at least `interactive`/`complete`, after the stabilization period (default 800 ms).
- Pre-baseline mutations postpone the baseline (debounce), with a 10-second cap to avoid infinite postponement.
- Baseline contains:
  - normalized page text (only if a text check is enabled; in memory, never stored);
  - whether the text pattern was found;
  - DOM element presence and normalized element text (only if a DOM check is enabled);
  - current URL.
- `MONITOR_BASELINE` records lengths/flags only.
- A SPA URL change resets the baseline. A full page reload creates a new content-script instance and therefore a new baseline.
- “Text disappears” and DOM “disappears” are only evaluated if the item was present at baseline.

### 7.2 Text conditions

| Condition | Baseline behavior | Trigger |
|---|---|---|
| appears | May be absent | PASS when found; WARN while still absent |
| absent | Assertion | PASS when not found; FAIL when found |
| disappears | Must be present at baseline | PASS when it disappears; WARN while still present; UNKNOWN if not present at baseline |
| changes | Whole normalized page text is stored in memory | PASS when text differs from baseline; WARN until a change |

Text checks are case-insensitive. Regex checks use `/pattern/i`. The content script throttles sends to once per 3 seconds when the result signature is unchanged; the engine additionally dedupes identical per-check results for `max(1.5 s, settle × 2)`.

### 7.3 DOM conditions

| Condition | Result |
|---|---|
| appears | PASS when found, WARN while absent |
| disappears | PASS when absent after being present at baseline, WARN while present, UNKNOWN if absent at baseline |
| textChanges | PASS when element text differs from baseline (or element appeared), WARN while unchanged, FAIL when the selector is missing |
| expectedText set | PASS if the element contains the text, FAIL if not found or missing |

An **invalid CSS selector** produces a FAIL `dom_check` with `reason` describing the invalid selector — it is not reported as “element not found”. The engine validates shape/length; the content script catches browser syntax errors.

### 7.4 URL checks

- Compare current top-level `location.href` with `expectedUrl` (default: session start URL).
- URL API normalization; hash ignored by default.
- PASS = unchanged; FAIL = unexpected destination.
- SPA changes are detected by a 1-second poll plus `popstate`/`hashchange`; the baseline is reset for the new route.
- Server redirects are additionally recorded by `webRequest.onBeforeRedirect`.

### 7.5 HTTP / navigation

`service-worker.js` registers observe-only `webRequest` listeners with this filter:

```js
{ urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] }
```

- `onBeforeRequest` stores the pending navigation start for the tab.
- `onBeforeRedirect` records a redirect event with the exposed 3xx status and target.
- `onCompleted` records a `navigation` event:
  - status 100–399 → PASS (304 is a cache revalidation PASS);
  - 400–599 → FAIL;
  - missing/0/outside 100–599 → UNKNOWN.
  - Includes `fromCache`, transition type (when present), navigation timing between request events and URL validation at the final destination.
- `onErrorOccurred`:
  - `net::ERR_ABORTED` → WARN (usually a superseded navigation);
  - other errors → FAIL `navigation_error`.
- All handlers first resolve the runtime state by `tabId`; without an active session the event is ignored. This is the stop-collection guarantee.
- A page loaded before the session started gets an explicit UNKNOWN status.
- No request blocking, modification, header reading, body reading or cross-request inspection is performed.

### 7.6 Load timing

From `performance.getEntriesByType('navigation')[0]`:

- `navigationStart = performance.timeOrigin + startTime`;
- `domContentLoadedMs = domContentLoadedEventEnd`;
- `loadEventMs = loadEventEnd`;
- `durationMs = duration` (or loadEventEnd);
- state `complete` / `incomplete` / `unavailable`.

Result logic:

- no Navigation Timing entry → UNKNOWN;
- load event not fired (20 s timeout or `incomplete`) → WARN;
- timing belongs to a page loaded before the session start → UNKNOWN/historical, excluded from average load duration;
- complete and over the configured budget → WARN (duration still counted);
- complete within budget → PASS;
- missing fields → UNKNOWN.

The report never calls these values server response time or TTFB. They are navigation/DOMContentLoaded/load milestones.

---

## 8. Structured event model

Each event:

```json
{
  "id": "uuid",
  "timestamp": "2026-10-17T16:04:00.000Z",
  "sessionId": "sess-...",
  "tabId": 123,
  "eventType": "text_check",
  "checkName": "Text condition",
  "result": "PASS",
  "severity": "info",
  "url": "https://example.com/",
  "expectedValue": "READY",
  "actualValue": "Text found",
  "httpStatus": null,
  "loadDurationMs": null,
  "reason": "Expected text found.",
  "details": { "condition": "appears", "textLength": 812 },
  "description": "Text condition — PASS — Expected text found.",
  "isCheck": true
}
```

- Unknown values are `null`, not empty strings.
- Strings are length-limited; details are sanitized to a bounded JSON-safe structure.
- `isCheck` marks the check event types used in totals: `http_status`, `navigation`, `redirect`, `navigation_error`, `page_load`, `text_check`, `dom_check`, `url_check`. Lifecycle, baseline, reload, screenshot and config events are excluded from totals. A redirect can be a check with `INFO` or `WARN`, not a PASS/FAIL tile.
- Descriptions are human-readable and generated from actual data.

`computeStats` is computed on read from events; no statistics are stored or fabricated. `totalChecks` is the count of the check event types above, not the number of reloads. Averages use only check events with a numeric `loadDurationMs` (in practice completed `page_load` measurements); historical/UNKNOWN timing is excluded; an incomplete WARN without a numeric duration is excluded; any check with a numeric duration, including an over-budget page-load WARN, is included. HTTP navigation duration/TTFB is not part of AVG LOAD.

---

## 9. Storage model

### `chrome.storage.local`

| Key | Contents |
|---|---|
| `settings` | Normalized defaults (bypass cache, badge, mode, settle, history limit, notification/screenshot defaults) |
| `qaSessions` | Object map sessionId → metadata (no event payload) |
| `qaEvents:<sessionId>` | Bounded array of events for that session |
| `qaPresets` | Custom presets (built-ins are code constants) |
| `qaPanelPrefs` | Per-origin floating-panel position/collapsed state (max 50 origins) |
| `legacyMigratedV3` | Migration flag |
| `qaLogsV2Backup` | Raw v2.3.0 logs preserved after migration |
| `qaLogs` | Deleted only after successful migration |

Limits: 30 sessions, 50–2,000 events per session (default 500; UI offers 200/500/1,000/2,000), custom presets 50. Oldest completed sessions are pruned. Quota errors trigger one prune+retry; if still full, the extension surfaces a storage warning instead of crashing monitoring.

### `chrome.storage.session`

| Key | Contents |
|---|---|
| `qaRuntime` | Per-tab active runtime: sessionId, config, phase, counts, nextActionAt, dedupe maps, pending navigation, screenshot throttle |

This survives service-worker suspension but is cleared by browser restart.

### IndexedDB (`odesoftami-qa` / `screenshots`)

- `{id, sessionId, eventId, timestamp, url, dataUrl, bytes}`
- indexes on sessionId and timestamp;
- max 20 entries / 40 MB / 2.5 MB per item;
- oldest entries pruned;
- clear by session or all.

### Migration

On first v3 load, `qaLogs` from v2.3.0 are merged chronologically into one read-only session `legacy-v2.3.0` (up to 1,000 events), with the raw logs preserved under `qaLogsV2Backup`. The original `qaLogs` key is removed only after a successful write. Old `refreshTabs` runtime timers are not resumed (the old service worker is gone); a new session must be started.

---

## 10. Report generation

`lib/core.js` is DOM-free and generates:

- **CSV**: `#` metadata preamble, then columns timestamp/session/tab/type/check/result/severity/URL/expected/actual/HTTP/load/reason/description/details. All strings are quoted/escaped; CRLF; formula-injection guard; UI adds a UTF-8 BOM.
- **HTML**: standalone, no scripts, all data escaped, inline print styles, summary/config/failures/unknown/timeline/limitations. Screenshots are not embedded.
- **JSON**: schema version, product/version, generatedAt, session, stats, events, limitations.

Reports are built from the exact events returned by `GET_SESSION_DATA`; there is no sample/hardcoded data.

---

## 11. UI architecture

- No framework, no remote assets, no inline scripts or inline event handlers.
- All dynamic text is inserted with `textContent`; HTML report content is escaped by the report builder.
- The toolbar action has no `default_popup`; `chrome.action.onClicked` opens `popup.html?detached=1&tabId=…` in a 420×680 extension popup window through the permission-free `chrome.windows` API. The target tab id is explicit, so the window controls the page the user invoked it from.
- Popup is a fixed-top/fixed-bottom layout: product header + compact mode tabs + gear/close controls are fixed; the middle content scrolls independently; Start/Stop, a single fixed status line and the footer are fixed. `fitPopupHeight` sizes to the real window viewport.
- Footer is `© 2026 Denys Oleksiienko · v3.2.0 · GitHub ↗ · Web ↗`, 10 px/400/#737373, with the version read from `manifest.json` and external anchors (`rel="noreferrer"`).
- The three-bar/drag control was removed in v3.2.0; the window is moved by the OS title bar. `×` closes it. If window creation is unavailable, the service worker falls back to a tab.
- Minimum size is best-effort: CSS min-width/min-height plus `chrome.windows.onBoundsChanged` → `chrome.windows.update` restores 420×560 outer (400×520 content). Chrome has no native extension-window min-size option.
- The status line is the only status source: Not monitoring / Refreshing / Monitoring / QA Session running / Paused. It is outside the scroll region and above the footer.
- Refresh hides the legacy Text condition card; QA labels its refresh block **Optional page refresh** and keeps the reload toggle/explanation. Shared summary keeps Last session with a mode chip in all three tabs.
- Dashboard Live Summary has Export CSV + quick Clear history; the popup Last session card has Clear history immediately beside Export CSV. The native confirmation reports affected counts and preserves active sessions, presets, settings and screenshots.
- The floating QA panel is a separate UI-only content script (Section 12); it never collects events.
- Dashboard polls `GET_SESSIONS` every 3 seconds only when visible; it reloads session data when the selected session changes or its event count changes.
- Screenshot thumbnails are loaded from IndexedDB only for the selected session, with a signature check to avoid repeated full reloads.
- Presets are rendered from validated objects; imported JSON is never executed.

---

## 12. Floating QA panel

- `panel-content.js` is a UI-only declared content script. It creates one Shadow-DOM host on `<html>` and reuses it; SPA navigation does not add a second host.
- It polls `GET_PANEL_DATA` every 1.5 s while active. The engine computes panel counts/latest/load from the same session events used by the dashboard; no counters are duplicated in the panel.
- It can send `SAVE_PANEL_PREFS`, `PANEL_STOP_SESSION` and `OPEN_DASHBOARD`; it cannot start sessions or write events.
- Collapse stores a per-origin collapsed flag; drag stores per-origin coordinates; both are bounded in `qaPanelPrefs`.
- Hide removes the host for the current page load without sending a stop. Only `PANEL_STOP_SESSION`/the existing Stop path stops monitoring.
- On stop the engine finalizes before sending `STOP_CONTENT_REFRESH`; the panel fetches the stopped session, disables Stop and offers Dismiss if “retain final summary” is on.
- Panel disabled or failed initialization: `syncPanel`/`show` are wrapped; monitoring continues. The panel is not created in Refresh mode.
- Shadow DOM isolates page CSS; constructable stylesheets are used with a `<style>` fallback to avoid page CSP issues.
- No new permission, network request, analytics or second engine.

## 13. Security and privacy

- MV3 with no remote code, no `eval`, no `new Function`, no inline scripts.
- Minimal permission set: `storage`, `activeTab`, `scripting`, `notifications`, `alarms`, `webRequest`; HTTP/HTTPS host permissions.
- `webRequest` is observe-only and limited to main-frame HTTP/HTTPS; no blocking API is requested.
- Content script is top-frame only, HTTP/HTTPS only, dormant without a session.
- No telemetry, analytics, accounts, cookies, credentials or uploads.
- Full page text never leaves the page; only check results/lengths and bounded snippets/details are stored.
- Screenshots are opt-in, local, capped and explicitly logged when skipped.
- URLs and expected values can be sensitive; reports are user-generated local files.

---

## 14. Error handling summary

| Failure | Handling |
|---|---|
| Tab closed | Session finalized `tab_closed` |
| Tab becomes non-HTTP | Stop `tab_unavailable` |
| Reload fails | FAIL event; 3 consecutive failures stop |
| Invalid selector | FAIL event with invalid-selector reason; watcher disabled for that document |
| Invalid regex | Rejected at start; content fallback also safe |
| HTTP status unavailable | UNKNOWN with reason |
| Navigation error | FAIL `navigation_error`; `ERR_ABORTED` is WARN |
| Permission denied for screenshot | `screenshot_skipped` WARN with Chrome’s reason |
| Storage full | Prune completed sessions and retry once; warning surfaced |
| Service worker restart | Runtime hydrated; active state recovered |
| Lost runtime (browser restart) | Session finalized `service_worker_reset` |
| Concurrent start | Rejected by per-tab runtime check |
| Duplicate events | Content signature throttle + engine dedupe + per-session write queue |
| Export error | Dashboard toast; no silent failure |

---

## 15. Tests

- **Unit**: `lib/core.js` pure functions, engine with in-memory Chrome mock, manifest/files/static safety, concurrency race, quota, migration, tab association, stop-collection, watchdog, injection fallback.
- **E2E**: real Chromium 153 headless, local HTTP server, CDP; detached popup with fixed header/tabs/status/footer, no ☰ control, 400×600 layout, 640×720 enlargement, CDP 320×400 shrink → enforced ≥420×560, status in Monitor/Refresh/QA/Paused, Refresh without legacy checks, QA with/without auto refresh, ON/OFF check states, Last session types, popup Clear history, footer version/GitHub/Web, floating panel, native Clear-history dialog, dynamic DOM/SPA, HTTP 200/403/404/500/redirect/network errors, SW restart, tab close, reports/downloads, presets, options, responsive screenshots. Toolbar `onClicked` dispatch is manual (headless has no toolbar).
- Latest result: 55 unit + 28 E2E PASS (see `TEST-REPORT.md`).

See `TEST-REPORT.md` and `KNOWN-LIMITATIONS.md`.
