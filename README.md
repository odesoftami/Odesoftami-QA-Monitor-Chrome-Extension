
<p align="center">
  <img src="assets/odesoftami-qa-monitor-banner.png"
       alt="Odesoftami QA Monitor — Browser QA and Monitoring Tool"
       width="100%">
</p>

# Odesoftami QA Monitor

**Version 3.2.0 — Browser QA & Monitoring Tool**
Created by **Denys Oleksiienko**

Odesoftami QA Monitor is a local-first Chrome extension for timed page refreshes and lightweight browser QA monitoring. It keeps the orange, graphite and white identity of the original product and adds a fixed popup layout, a floating on-page QA panel, quick history management, a fixed status bar and a simplified v3.2.0 interface.

> Status: source, tests and a loadable v3.2.0 ZIP are complete. The extension has **not** been published or uploaded, and Chrome Web Store approval is **not** claimed. The v3.1.0 and v3.0.0 ZIPs are preserved untouched alongside the new build.

---

## What it does

| Mode | Automatic reloads | Live checks | Structured history | Reports |
|---|---|---|---|---|
| **Refresh** | Yes — continuous or cycles | No check UI; HTTP/navigation, load timing and any saved legacy text run internally | Yes | Yes |
| **Monitor** | No | Text, DOM element, URL, HTTP/navigation, load timing | Yes | Yes |
| **QA Session** | Optional — can combine refresh with all checks | All checks | Yes | Yes + screenshots/report workflow |

All three modes use the same background monitoring engine. A floating QA panel on the page is a UI client for that same engine — it does not collect events separately.

### New in v3.2.0

- **Removed the ☰ / three-bar control** from the popup header. It was the custom drag handle; the detached window can still be moved by its browser title bar. The settings gear and `×` close button remain.
- **Minimum window size:** the detached popup is kept at **420×560 outer** minimum (400 px content width, 520 px content height) using CSS guards plus `chrome.windows.onBoundsChanged` → `chrome.windows.update`. It can still be enlarged freely.
- **Fixed status moved to the bottom:** the single source of truth now sits directly above the footer, below Start/Stop. It remains visible while the middle content scrolls and reflects Not monitoring / Refreshing / Monitoring / QA Session running / Paused.
- **Refresh simplified:** interval, schedule, Presets, Start/Stop and Last session only. The legacy Text condition card is hidden from Refresh; legacy values remain in the model for compatibility.
- **QA Session optional refresh:** the block is titled **Optional page refresh**, with a clear note and the existing **Reload pages during this QA session** toggle. Turning it off leaves checks running without reloads.
- **Collapsed check states:** Text / DOM element / URL & navigation show **ON/OFF**; Session options shows the neutral **DEFAULTS**. State updates immediately and survives collapse/expand.
- **Last session in every mode:** the shared summary card stays in Refresh, Monitor and QA Session, now with a session-type chip (Refresh / Monitor / QA Session), Export CSV, Clear history and Dashboard. It never presents a previous session as current.
- **Footer:** `© 2026 Denys Oleksiienko · v3.2.0 · GitHub ↗ · Web ↗`, one grey line; version is dynamic from `manifest.json`.

### Carried forward from v3.1.0

- Odesoftami QA Monitor branding and **Browser QA & Monitoring Tool** tagline.
- Detached floating popup window opened via `chrome.action.onClicked`.
- Fixed product header + compact fixed mode tabs.
- Floating QA panel in Monitor/QA with live counters, latest event, load timing, collapse, drag, hide, Stop, final summary and Shadow DOM isolation.
- Quick Clear history beside Export CSV in Dashboard and popup; active sessions, presets, settings and screenshots preserved.
- English-only UI and verified public GitHub/Web links.

### Preserved from v3.0.0 / v2.3.0

- Continuous refresh from **2 seconds to 24 hours**, cycle refresh, pause and countdown badges.
- Legacy text conditions, notifications and stop-on-match behavior.
- Dynamic text monitoring, regex, baseline/debounce, duplicate suppression.
- DOM element watcher, URL checks, HTTP/navigation monitoring, Navigation Timing.
- Structured sessions, bounded event history, dashboard, CSV/HTML/JSON reports.
- Presets, opt-in local screenshots, migration of v2.3.0 `qaLogs`.
- MV3 resilience: `storage.session`, `alarms` watchdog, service-worker restart recovery, per-tab locks and serialized event writes.
- Existing permissions, storage keys, event identifiers and session data model.

---

## Installation

### New v3.2.0 build

1. Download `dist/odesoftami-qa-monitor-v3.2.0.zip`.
2. Extract it. `manifest.json` must be at the root.
3. Open `chrome://extensions` → Developer mode → **Load unpacked** → select the folder.
4. Requires Chrome 120 or newer.

### Preserved builds

- v3.1.0 ZIP: `dist/odesoftami-qa-monitor-v3.1.0.zip` (not overwritten).
- v3.0.0 ZIP: `dist/odesoftami-auto-refresh-v3.0.0.zip` (not overwritten).
- v3.0.0 source snapshot: `_baseline/v3.0.0/`.

---

## Floating popup window

The manifest has **no `default_popup`**. A toolbar click is handled by `chrome.action.onClicked`, which opens `popup.html?detached=1&tabId=…` in a small extension popup window (420×680 requested; 400×600 content is the tested layout; minimum outer size 420×560). The target tab id is passed explicitly, so the window controls the page you clicked from rather than the popup window itself.

The window is a three-region flex layout:

- **Fixed top block** — logo, **Odesoftami QA Monitor**, tagline, dynamic version, larger settings gear, close button, and the fixed Refresh / Monitor / QA Session tabs.
- **Scrollable middle** — mode hint, current tab, presets, mode settings, session summary and Clear history.
- **Fixed bottom block** — errors/notices, Start/Stop, the fixed status line, then the attribution footer.

The custom three-bar drag handle was removed in v3.2.0. Move the window with the normal browser title bar; `×` closes it. The detached window enforces a minimum outer size of **420×560** with `chrome.windows.onBoundsChanged`/`update` (Chrome does not expose a native min-size option for extension windows). It can be enlarged normally. If a window cannot be created, the service worker falls back to opening the same page as a tab.

Chrome/OS window-manager behavior still affects positioning and exact outer size.

### Footer

```text
© 2026 Denys Oleksiienko · v3.2.0 · GitHub ↗ · Web ↗
```

- Single line, centered, 10 px, font-weight 400, color `#737373`; links use the same grey, no orange button.
- Version is read dynamically from `manifest.json`; the header also shows it.
- GitHub: `https://github.com/odesoftami` (profile supplied by the project owner).
- Web: `https://odesoftami.com/apk`.
- Both links open in a new tab with `rel="noreferrer"`. The footer sits below the fixed status line.
- The footer is outside the mode content, so it remains visible in all three modes.

---

## Floating QA panel

Shown automatically in **Monitor** and **QA Session** modes when enabled in Settings. Never shown in Refresh mode.

### What it shows

- Product label and current mode.
- Live / Paused / Stopped status.
- PASS, FAIL, WARN and UNKNOWN counters.
- Latest event description.
- Latest page-load duration when available.
- Session duration.
- Dashboard and Stop buttons.
- Collapse and hide controls.

Data comes from `GET_PANEL_DATA`, which computes statistics from the same session/event store used by the dashboard. The panel does not add events, create a session or run a second observer.

### Behavior

- Appears on session start; updates counters and latest event by polling the service worker every 1.5 s.
- Collapse turns it into a small QA pill with the FAIL count; click to expand.
- Drag moves it; the position is saved per site origin and restored after navigation/reload.
- Hide removes the panel for the current page load; monitoring continues.
- Stop sends an explicit panel stop to the existing engine; only that stops monitoring.
- After stop, the final summary is retained (default) until dismissed or a new session starts.
- SPA navigation does not inject a second panel; the session lifecycle is unchanged.
- Disabled or failing panel initialization never disables monitoring.
- Shadow DOM keeps page CSS out; constructable stylesheets avoid page CSP blocking the panel styles.

### Settings

Settings → **Floating QA panel**:

- Enable/disable.
- Default position (bottom-right / bottom-left / top-right / top-left).
- Start collapsed.
- Retain final summary.

Defaults: enabled, bottom-right, expanded, retain summary. Monitoring works with the panel disabled.

---

## Quick Clear history

The Dashboard Live Summary has **Export CSV · Clear history** together. The popup’s Last session card also has **Clear history** immediately to the right of **Export CSV**.

- Shows the browser confirmation dialog with the number of completed sessions and historical events.
- Cancel preserves everything.
- Confirm clears only completed sessions and their historical events.
- **Active monitoring sessions are preserved.**
- **Presets and settings are preserved.**
- **Stored screenshots are preserved** — the separate “Clear stored screenshots” action remains the only screenshot bulk-clear action.
- Dashboard counters/history update immediately; the active session stays selected.
- The same behavior applies to the Settings “Clear completed session history” action.
- Deleting an individual session still removes its own events/screenshots.

---

## How checks are evaluated

### What counts as one Check

`Checks` is the number of stored **check events** (`core.CHECK_EVENT_TYPES`), not the number of reloads or sessions. Counted event types:

- `http_status` (including the initial “status not observed” UNKNOWN);
- `navigation`;
- `redirect`;
- `navigation_error`;
- `page_load`;
- `text_check`;
- `dom_check`;
- `url_check`.

Not counted as checks: `session_start`, `session_stop`, `baseline`, `reload_requested`, `reload_failed`, `screenshot`, `screenshot_skipped`, `config` and legacy lifecycle events. These can still appear in the event timeline and can still carry a result, but they do not increase `Checks`, `PASS`, `FAIL`, `WARN` or `UNKNOWN`.

Important consequences:

- In QA/Refresh with HTTP status and load timing enabled, **one reload produces two checks**: `navigation` (HTTP status) + `page_load`. Text, DOM and URL add one check each when enabled.
- A session often starts with **2 UNKNOWN checks**: HTTP status was not observed before start, and the pre-session page-load timing is historical.
- A normal redirect is recorded as an `INFO` check; an unexpected redirect is `WARN`. Because `INFO` has no tile in the compact summary, `Checks` can be larger than `PASS + FAIL + WARN + UNKNOWN` when redirects exist.
- `reload_failed` (including a missed refresh) and `screenshot_skipped` are result events, but **not** check events; they do not change the counters.
- The `CYCLE n/N` display counts reloads in the current cycle, not checks.

### Result semantics

| Source | PASS | FAIL | WARN | UNKNOWN |
|---|---|---|---|---|
| HTTP / navigation | status 100–399 | status 400–599, other navigation errors | `net::ERR_ABORTED` navigation | status missing/invalid |
| Redirect | — | — | unexpected destination | — (normal redirect is `INFO`, not UNKNOWN) |
| Page load | complete and within budget | — | over budget, or load incomplete | Navigation Timing unavailable or historical |
| Text | condition satisfied | condition violated | condition not yet observable | no baseline / not evaluable |
| DOM | condition satisfied | selector missing or expected text mismatch | condition not yet observable | no baseline / not evaluable |
| URL | matches expected URL | unexpected URL | — | — |

Text/DOM details are in the tables below. Notifications and stop conditions are evaluated on these results; see “Notifications and stop conditions” below.

### Reloads vs checks vs average load

- A **reload** is a `tabs.reload()` request; its `reload_requested` INFO event is not a check.
- **Checks** count the HTTP status, page-load timing, text, DOM and URL evaluations described above.
- **AVG LOAD** is the arithmetic mean, rounded to milliseconds, of only those check events that have a numeric `loadDurationMs`. In practice this means completed `page_load` measurements. Historical/UNKNOWN timing is excluded. An incomplete/WARN measurement without a numeric duration is also excluded; any check with a numeric duration (including an over-budget page-load WARN) is included. HTTP navigation duration and TTFB are **not** in this average. With no samples the UI shows `—`.
- An interval change (2 s or 5 s) does not change how many checks one reload produces; it only changes how often reloads occur.

### Live summary vs Last session

- **Live summary** is shown when this tab has an active session; it is computed from that session’s stored events.
- **Last session** is shown when this tab has no active runtime; it is the latest completed session for the same tab, not a global “last session” across all tabs.
- The mode chip identifies Refresh / Monitor / QA Session. Both headings use the same per-tab event store; there are no separate per-mode copies. Switching UI tabs does not reset or duplicate history.
- With no session at all, the card shows an empty/zero summary rather than inventing results.
- The Dashboard’s **Live summary** is a separate fixed panel for the **currently selected session**; it can show an active or a completed session and is not a second live-only data source.

### Mode lifecycle and schedules

- All modes start and stop through the popup’s **Start/Stop**, which sends `START_SESSION` / `STOP_SESSION` to the service worker; there is no auto-start on page load.
- **Refresh** forces automatic reloads, records HTTP/navigation and load timing, disables DOM/URL checks, and keeps legacy text values internal (the text card is hidden in v3.2).
- **Monitor** forces `autoRefresh=false`; it records text/DOM/URL/HTTP/timing checks without reloading.
- **QA Session** keeps checks running; **Reload pages during this QA session** is optional. Its default remains checked for backward compatibility. When unchecked, no reloads are requested but text/DOM/URL checks continue.
- Intervals are **2–86,400 seconds**; cycles use 1–1,000 reloads per cycle and a 1–86,400-second pause. Chrome may throttle timers in background tabs; the 30-second alarm watchdog is a fallback, so intervals are targets rather than hard real-time guarantees.

### Notifications and stop conditions

- `notifyOnMatch` fires on a text-condition **transition** to matched; `notifyOnFailure` fires for failed checks. Notification keys are deduplicated for 60 seconds.
- `stopOnMatch` applies only to the text condition. `stopOnFailure` stops on a failed check; navigation errors stop with `navigation_error`, and three consecutive reload failures stop the session.
- WARN results (for example a page load over budget, or a skipped screenshot) do not by themselves trigger a failure stop. The event timeline still records them.
- Screenshot-skip and reload-failure events are not check events, even though their result field can be WARN or FAIL.

### Text checks

- Baseline after `DOMContentLoaded` + stabilization (default 800 ms), with a 10-second cap on pre-baseline DOM churn.
- Mutations are debounced; checks run after the DOM is quiet.
- Visible top-level text via `innerText` (fallback `textContent`); normalized and capped in memory. Full page text is never stored or sent to the service worker.
- Case-insensitive literal matching; optional validated regex with the `i` flag.
- Duplicate suppression at the content layer and in the engine; notifications use transitions.
- Baseline resets on SPA URL changes; a full reload creates a new baseline.

| Condition | PASS | WARN | FAIL | UNKNOWN |
|---|---|---|---|---|
| Text appears | found | not found yet | — | — |
| Text is absent | not found | — | found | — |
| Text disappears | was present at baseline, now absent | still present | — | not present at baseline |
| Text changes | page text differs from baseline | no change yet | — | no baseline |

### DOM checks

- CSS selector; element appears/disappears/text changes; optional expected text.
- Invalid selector → FAIL with a clear reason, not “element not found”.
- Valid selector + missing element → honest missing-element result.
- Elements inserted dynamically are detected by the same observer.
- Expected text uses case-insensitive containment.

### URL checks

- Expected URL defaults to session start URL; can be overridden.
- URL API comparison; hash ignored by default.
- SPA URL poll (1 s) plus `popstate`/`hashchange`; baseline resets for the new route.
- Unexpected destination → FAIL.

### HTTP / navigation

- Observe-only `webRequest` with `{urls:['http://*/*','https://*/*'], types:['main_frame']}`.
- No `webRequestBlocking`; no request modification, headers or bodies.
- Records final status, redirects and network errors when Chrome exposes them.
- Associates every event with the active session by tab id; ignores tabs with no session; stops at session stop.
- Missing status → **UNKNOWN**, never a fabricated 200.
- Page loaded before session start → explicit UNKNOWN status.
- Only main-frame navigations; not a full network inspector.

### Load timing

- Navigation Timing API: total navigation duration, DOMContentLoaded, load event.
- Not server response time or TTFB.
- Pre-session/historical timing → UNKNOWN, excluded from average.
- Missing/incomplete timing → UNKNOWN/WARN.

---

## Dashboard and reports

The dashboard is a local extension page with:

- Live summary counts, pass rate, average load, session duration.
- Current session/URL/current check/last result/failures/tab.
- Full event timeline with result/type/search filters.
- Session history, per-session deletion, quick clear history.
- Screenshot gallery for the selected session.
- Preset manager.
- CSV / HTML / JSON exports generated from actual recorded events.

Reports include session metadata, configuration, statistics, failures, unknown measurements, event timeline and limitations. CSV is escaped and BOM-prefixed; HTML is standalone/script-free and escaped; JSON is machine-readable. Screenshots are not embedded.

---

## Presets

Built-in: Deployment Monitor, Error Watch, URL / Redirect Check, Custom QA Session. Users can save, apply, edit/rename, duplicate, delete, export and import validated JSON. Imports are size-limited and never executed as code.

---

## Screenshots on failure (opt-in)

- Disabled by default; explicit per-session or Settings default.
- Chrome requires an active/focused tab and `activeTab`/`<all_urls>` for `captureVisibleTab`; this extension intentionally does not request `<all_urls>`.
- If capture is refused, a `screenshot_skipped` WARN explains why; capture is never silent.
- Screenshots are local IndexedDB only, capped at 20 entries/40 MB, never uploaded.
- Successful capture remains a manual test; programmatic popup opening in headless Chromium does not grant `activeTab`. See `KNOWN-LIMITATIONS.md`.

---

## Privacy and data

- No telemetry, analytics, advertising, accounts or remote code.
- No network requests to Odesoftami or third parties.
- Settings, sessions, events, presets, panel preferences and screenshots stay in the browser profile.
- Full page text is not stored; results/values/lengths/URLs are.
- Retention: up to 30 sessions, 50–2,000 events per session (500 default; UI 200/500/1,000/2,000), 20 screenshots / 40 MB.
- Clear history preserves screenshots; the separate screenshot clear remains.
- URLs and report/screenshot files can be sensitive.

See `PRIVACY.md` and `privacy.html`.

---

## Permissions (unchanged from v3.0.0)

| Permission | Why |
|---|---|
| `storage` | Local settings, sessions, events, presets, panel prefs; active runtime in `storage.session` |
| `activeTab` | Identify the explicitly monitored tab; opt-in screenshots after user invocation |
| `scripting` | Inject the packaged monitor into an already-open tab |
| `notifications` | Local condition/failure alerts |
| `alarms` | Service-worker-safe fallback/watchdog |
| `webRequest` | **Observe-only** main-frame HTTP/HTTPS status, redirects, errors; no blocking |
| `http://*/*`, `https://*/*` | Run the monitor on user-chosen pages and read their navigation details |

**No new permissions were added in v3.2.0.** The floating panel uses the existing content script, Shadow DOM and existing `storage`/messaging. The detached popup uses the permission-free `chrome.windows` API. No `tabs`, `downloads`, `webRequestBlocking`, `webNavigation`, `unlimitedStorage` or `<all_urls>`.

Full justification: `PERMISSIONS.md`.

---

## Project layout

```text
manifest.json                 MV3 manifest, v3.2.0
service-worker.js             MV3 event wiring
refresh-content.js            isolated-world monitor
panel-content.js              Shadow-DOM floating QA panel (UI only)
lib/core.js                   validation, events, stats, reports, presets, branding/config
lib/engine.js                 sessions, scheduling, storage, webRequest, panel data, reports data
lib/screenshots.js            IndexedDB screenshot store
popup.html/css/js             fixed header/tabs/status/footer, dynamic version, min-size guard
dashboard.html/css/js         live QA dashboard, quick clear history, presets, exports
options.html/css/js           defaults incl. floating panel, privacy, local data
privacy.html                  bundled privacy policy
icons/                        16/32/48/128
tests/unit/                   Node unit tests + Chrome API mock
tests/e2e/                    real Chromium CDP integration suite
_baseline/v2.3.0/             original v2.3.0 source
_baseline/v3.0.0/             preserved v3.0.0 source/screenshots
store/                        optional listing screenshots/assets
dist/                         v3.0.0, v3.1.0 and v3.2.0 ZIPs
```

---

## Testing

```bash
node --test tests/unit/*.test.js
node tests/e2e/run.js
```

Latest executed result: **55 unit tests PASS, 28 Chromium E2E tests PASS, 0 FAIL, 0 NOT TESTED** in the automated suites. See `TEST-REPORT.md`, `tests/e2e/results.json` and `KNOWN-LIMITATIONS.md`.

The E2E suite covers the detached popup created through `chrome.windows.create` (fixed header/tabs/footer, footer version/GitHub/Web links, status in all modes, Refresh without legacy checks, QA optional refresh, ON/OFF check states, Last session types, min-size enforcement via CDP window bounds, popup Clear history), floating panel counters/collapse/drag/hide/stop/final/disabled, native Clear-history confirmation, HTTP 200/403/404/500/redirect/network errors, stop-collection, tab close, service-worker restart, reports/downloads, presets, options and responsive layouts. The actual toolbar `onClicked` event remains a manual check because headless Chromium has no toolbar.

---

## Build the v3.2.0 ZIP

```bash
mkdir -p dist
zip -r -X dist/odesoftami-qa-monitor-v3.2.0.zip \
  manifest.json service-worker.js refresh-content.js panel-content.js \
  popup.html popup.css popup.js \
  options.html options.css options.js \
  dashboard.html dashboard.css dashboard.js privacy.html \
  lib icons README.md CHANGELOG.md PRIVACY.md PERMISSIONS.md \
  ARCHITECTURE.md KNOWN-LIMITATIONS.md \
  -x '*.DS_Store'
unzip -l dist/odesoftami-qa-monitor-v3.2.0.zip | head
```

`manifest.json` is at the ZIP root. Tests, store assets, baselines, the preserved v3.1.0/v3.0.0 ZIPs and `dist/` itself are excluded.

---

## Known limitations

See `KNOWN-LIMITATIONS.md`. Highlights:

- HTTP status only for main-frame navigations observed while a session is active; otherwise UNKNOWN.
- Client-side redirects have no redirect status in Chrome; URL checks detect destination changes.
- Load timings are navigation/DOMContentLoaded/load, not server response time/TTFB.
- Cross-origin iframes and closed shadow DOM cannot be inspected.
- Background tabs can be throttled; alarm fallback has a 30 s minimum.
- Browser restart finalizes sessions; no auto-resume.
- Screenshot capture success remains manually unverified; the refusal path is tested.
- Floating panel initialization-failure fault injection is not automated; the panel is wrapped so monitoring continues. Manual steps are in the test report.
- The ☰ / custom drag handle was removed. Move the window with the browser title bar; the toolbar `onClicked` dispatch is still a manual check because headless has no toolbar.
- Minimum size is enforced best-effort through `chrome.windows.onBoundsChanged`/`update`; Chrome has no native extension-window min-size option. Window-manager/OS behavior can affect exact outer bounds.
- Successful screenshot-on-failure capture and panel initialization-failure fault injection remain manual/not automated.
- Chrome Web Store approval is not claimed; no upload/publication was performed.

---

## Links

- Product: Odesoftami QA Monitor
- Author: Denys Oleksiienko
- Website: <https://odesoftami.com/apk/>
- v3.1.0 ZIP: `dist/odesoftami-qa-monitor-v3.1.0.zip` (preserved)
- v3.0.0 baseline: `_baseline/v3.0.0/`
- Original v2.3.0: `_baseline/v2.3.0/`
- Privacy: `PRIVACY.md`
- Permissions: `PERMISSIONS.md`
- Publishing checklist: `PUBLISHING.md`

Simple. Useful. Free.
