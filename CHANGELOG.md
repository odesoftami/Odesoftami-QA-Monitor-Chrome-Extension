# Changelog — Odesoftami QA Monitor

All notable changes to this project. The format is human-readable and grouped by release.

---

## 3.2.0 — 2026-10-17

**Codename:** Simpler Refresh, fixed status, minimum window size
**Upgrade from:** 3.1.0
**Manifest:** V3 (unchanged permissions)
**Baselines:** v3.1.0 and v3.0.0 ZIPs preserved untouched

### Added

- **Minimum window size** for the detached popup: 420×560 outer (400×520 content).
  - CSS min-width/min-height guards plus `chrome.windows.onBoundsChanged` → `chrome.windows.update`.
  - The window can still be enlarged; no resizing is disabled.
  - The header now has only Settings and Close (the three-bar control was removed).
- **Unified fixed status bar** directly above the footer and below Start/Stop:
  - Not monitoring, Refreshing, Monitoring, QA Session running, Paused.
  - Single source of truth; no duplicate status in the scrolling content.
  - Updates immediately on start, stop, pause and mode changes.
- **Last session type chip** in the shared summary: Refresh, Monitor or QA Session.
- **E2E coverage** for minimum window enforcement using real CDP window bounds, status in all modes, Refresh without legacy checks, QA without auto refresh, ON/OFF check states, and Last session types.

### Changed

- **Hamburger / three-bar control removed** from the popup header. It was the custom drag handle; the window remains movable by its browser title bar. Settings gear and `×` close remain.
- **Refresh is simplified:** only interval, schedule, Presets, Start/Stop and Last session are visible. The legacy Text condition card is hidden from Refresh; legacy values remain in the model for compatibility.
- **QA refresh is explicitly optional:** heading **Optional page refresh**, explanatory note and the existing **Reload pages during this QA session** checkbox. Turning it off keeps text/DOM/URL checks running without reloads.
- **Collapsed check headers** show **ON/OFF** for Text, DOM element and URL & navigation; Session options shows neutral **DEFAULTS**. Status updates immediately and survives collapse/expand.
- **Footer** is now `© 2026 Denys Oleksiienko · v3.2.0 · GitHub ↗ · Web ↗`, one line, grey, 10 px, with version read dynamically from `manifest.json`.
- Version updated to **3.2.0** in manifest, core, package, UI and documentation.
- Status bar added to the fixed bottom region; footer/actions/status never scroll with content.
- Test counts: **55 unit / 28 E2E**.

### Fixed

- The popup could be shrunk until tabs/labels clipped; minimum bounds are now restored automatically.
- Status could disappear when scrolling; it is now fixed above the footer.
- Refresh exposed a legacy Text condition that did not belong in the simple refresh workflow.
- The QA refresh block looked mandatory; it is now labelled optional with an explanation.
- Collapsed check headers did not clearly communicate enabled/disabled state.
- Previous-session statistics could look current; the summary now shows a type chip and keeps Last session semantics.
- Footer version is always in sync with the manifest.

### Compatibility

- Storage keys, extension ID, session/event schema and v2.3 migration unchanged.
- Existing text-condition values are retained in config even though Refresh no longer exposes the card.
- QA default auto refresh remains checked for backward compatibility; the user can explicitly disable it.
- Permissions unchanged: `storage`, `activeTab`, `scripting`, `notifications`, `alarms`, `webRequest`; HTTP/HTTPS hosts.
- `chrome.windows` create/get/update/onBoundsChanged requires no manifest permission.
- v3.1.0 ZIP not overwritten; v3.0.0 ZIP not modified.

### Verification

- Unit: **55 / 55 PASS**.
- Real Chromium E2E: **28 / 28 PASS**.
- Minimum-size check: CDP shrank the popup to 320×400; the app restored it to ≥420×560 and kept tabs/buttons/status/footer visible.
- ZIP smoke loaded in Chromium; no page exceptions.

### Known issues

- Toolbar `onClicked` dispatch remains a manual check in a real Chrome window (headless has no toolbar).
- Successful screenshot capture and panel initialization-failure injection remain manual/not automated.
- Chrome has no native min-size option for extension windows; bounds enforcement is best-effort under the OS window manager.
- Chrome Web Store approval is not claimed; no upload/publication.

---

## 3.1.0 — 2026-10-17

**Codename:** UI Improvements, Floating QA Panel & Branding
**Upgrade from:** 3.0.0
**Manifest:** V3 (unchanged permissions)
**Baseline:** v3.0.0 ZIP preserved untouched

### Added

- **Floating QA panel** for Monitor and QA Session modes, isolated in a Shadow DOM:
  - live PASS / FAIL / WARN / UNKNOWN counters, latest event, page-load timing and session duration;
  - Dashboard and Stop actions;
  - collapse to a small QA indicator with FAIL count, expand, and hide;
  - drag with per-site position persistence;
  - final session summary retained until dismissed/new session;
  - disabled-panel and initialization-failure paths never stop the monitoring engine.
- Panel settings: enable/disable, default corner, start collapsed, retain final summary.
- `panel-content.js` UI-only content script (no second monitoring engine).
- Engine `GET_PANEL_DATA`, `SAVE_PANEL_PREFS`, `PANEL_STOP_SESSION`, `OPEN_DASHBOARD` messages.
- `qaPanelPrefs` local storage for per-origin panel position/collapsed state.
- **Quick Clear history** next to Export CSV in the Dashboard Live Summary and the popup Last session card.
  - confirmation with session/event counts;
  - cancel preserves data;
  - active sessions, presets, settings and screenshots preserved;
  - dashboard counters/history refresh immediately.
- **Detached floating popup window** opened from the toolbar action (`chrome.action.onClicked` → `chrome.windows.create`), replacing the anchored action popup.
  - fixed product header with drag handle, larger settings gear and close button;
  - **fixed mode tabs** (Refresh / Monitor / QA Session) in the top block, with shorter height;
  - middle content scrolls independently; Start/Stop and footer stay fixed;
  - target tab id passed to the window so it controls the page you clicked from.
- **Permanent single-line footer:** `© 2026 Denys Oleksiienko GitHub ↗ Web ↗`.
  - no version in the footer; version remains in the header;
  - GitHub `https://github.com/odesoftami` and Web `https://odesoftami.com/apk`, grey links.
- Dynamic version display in popup, dashboard and settings from `manifest.json`.
- Public GitHub/Web links configured in `lib/core.js`.
- English-only UI labels for panel, footer, confirmations and new settings.
- New E2E coverage for the detached window, fixed tabs/footer, GitHub/Web links, panel behavior, popup/dashboard clear history and native dialog.

### Changed

- Product renamed **Odesoftami Auto Refresh → Odesoftami QA Monitor**.
- Short description **Browser QA & Monitoring Tool**.
- Manifest `name`, `short_name`, `description`, `default_title`, version and `version_name`.
- Toolbar action now opens a detached 420×680 popup window instead of Chrome’s anchored action popup.
- Popup width/layout enlarged; product header, mode tabs, Start/Stop and footer stay fixed while content scrolls.
- Settings gear enlarged by 25% (20 px → 25 px); drag handle and close button added.
- Clear history added next to Export CSV in the popup Last session card.
- Dashboard “Session statistics” renamed **Live summary** with Export CSV + Clear history.
- Dashboard, options, privacy, notifications, reports and documentation branding.
- Page titles, footer copy and store assets updated.
- `CLEAR_HISTORY` now preserves stored screenshots; screenshot clearing remains a separate explicit action.
- Date/English formatting remains `en-GB`.
- Test counts and documentation updated.

### Fixed

- Detached popup layout fills the real `window.innerHeight`; footer cannot fall below the window.
- Popup content could be hidden behind fixed controls; flex regions now reserve header/tabs/footer space.
- Toolbar action previously used an anchored popup that could not be dragged; it now opens a movable window with a custom drag handle and close control.
- Clear-history previously deleted session screenshots; screenshots are now preserved by that action.
- Panel position/collapse state survives reloads per origin.
- Panel final summary now sees the stopped session because the engine finalizes the session before sending the page stop message.
- Panel duplicate DOM on SPA navigation is prevented by a single guarded host.
- Panel styling is isolated via Shadow DOM; constructable stylesheets avoid page CSP blocking.
- Clear-history confirmation now reports affected counts and is integration-tested with the native dialog.
- Fixed mode tabs no longer scroll out of view; they moved from the content area into the fixed header.
- Footer version removed because the header already shows the dynamic version; GitHub/Web links added.

### Unchanged / compatibility

- Extension ID path and storage keys preserved.
- Existing settings, sessions, events, presets and v2.3 migration data remain compatible.
- Event identifiers PASS / FAIL / WARN / UNKNOWN / INFO unchanged.
- Permissions unchanged: `storage`, `activeTab`, `scripting`, `notifications`, `alarms`, `webRequest`; HTTP/HTTPS hosts.
- v3.0.0 ZIP not overwritten or modified.

### Verification

- Unit: **55 / 55 PASS**.
- Real Chromium E2E: **27 / 27 PASS**.
- ZIP smoke: loaded extracted v3.1.0 package in Chromium; manifest, dashboard, settings and presets APIs verified.
- Chrome Web Store approval is not claimed; no upload/publication.

### Known issues

- Successful screenshot capture remains manually unverified (headless `activeTab` limitation); refusal path tested.
- Panel initialization-failure fault injection is not automated.
- Toolbar `onClicked` dispatch and real-window drag movement are manual checks; headless Chromium has no toolbar/window manager. Window creation and controls are E2E-tested through `chrome.windows.create`.
- See `KNOWN-LIMITATIONS.md`.

---

## 3.0.0 — 2026-10-17

**Codename:** Odesoftami QA Monitor
**Upgrade from:** 2.3.0
**Manifest:** V3
**Minimum Chrome:** 120

### Highlights

- Three real modes: **Refresh**, **Monitor**, **QA Session**.
- Dynamic text and DOM element monitoring without full-page reloads.
- Observe-only HTTP status, redirect and network-error monitoring for main-frame navigations.
- Page load performance measurements with explicit UNKNOWN/historical handling.
- Structured sessions, bounded event history, live QA dashboard and CSV/HTML/JSON reports.
- Local QA presets, validated import/export and opt-in screenshots on failure.
- Service-worker-resilient scheduling and storage.

### Added

#### Monitoring modes

- Refresh (continuous/cycles; v2.3-compatible text condition).
- Monitor (no reloads; live checks).
- QA Session (live checks + optional reloads + full recorded report workflow).

#### Dynamic text monitoring

- Text appears, text is absent, text disappears, text changes.
- Baseline capture after DOM stabilization; baseline reset on SPA URL changes.
- `MutationObserver` with debounced/stabilized evaluation and attribute visibility filters.
- Optional regular expressions with validation and safe failure.
- Duplicate suppression by result signature and engine-side per-check dedupe.
- Notification/stop transition tracking so unchanged conditions do not spam.

#### DOM watcher

- CSS selector, element appears/disappears/text changes, optional expected text.
- Clear separation between invalid selector and missing element.
- Invalid selector FAIL event; dynamically inserted elements supported; observer cleanup.

#### HTTP / navigation

- Observe-only `chrome.webRequest` (main-frame HTTP/HTTPS only; no `webRequestBlocking`).
- Final status codes when Chrome exposes them (200/3xx/4xx/5xx/304), redirect target/status, network errors.
- Explicit UNKNOWN for unavailable status; never a fabricated 200.
- Session/tab association; no events after stop.
- URL validation and unexpected-destination FAIL events.
- `net::ERR_ABORTED` treated as WARN.

#### Performance

- Navigation Timing capture: navigation start, DOMContentLoaded, load event, total duration.
- Configurable load budget (WARN when exceeded; 0 disables).
- Historical pre-session timing marked UNKNOWN and excluded from averages.
- Timeout/incomplete navigation state.

#### Sessions and events

- New structured event model with sessionId, tabId, eventType, checkName, result, severity, URL, expected/actual values, HTTP status, load duration, reason, bounded details and human-readable description.
- Session start/stop records, stop reasons, session duration.
- PASS/FAIL/WARN/UNKNOWN/INFO states.
- Live statistics computed from actual events (no hardcoded sample data).
- Bounded local retention with quota pruning and warning.
- Automatic migration of v2.3.0 `qaLogs` into a read-only imported session (raw backup kept).

#### Dashboard and reports

- New dashboard page: live status, URL, current check, last result, totals, pass rate, average load, duration, event timeline, filters, configuration, screenshots, presets.
- CSV export with metadata preamble, Unicode/BOM, correct escaping and formula-injection protection.
- Standalone script-free HTML report with escaped content and print styles.
- JSON report for machine-readable results.
- Actual browser downloads verified in integration tests.

#### Presets

- Built-in Deployment Monitor, Error Watch, URL / Redirect Check, Custom QA Session.
- Save, apply, rename/edit, duplicate, delete, export/import.
- Strict import validation (size, types, bounds, selector/regex); no code execution.

#### Screenshots

- Opt-in screenshot-on-failure stored locally in IndexedDB.
- Active/focused-tab requirement; explicit `screenshot_skipped` events with Chrome’s reason.
- 20-entry/40 MB cap, clear by session or all, never uploaded.
- Screenshot store tested; successful capture remains a manual test (headless activeTab limitation documented).

#### Reliability / MV3

- Runtime state in `chrome.storage.session`, durable history in `chrome.storage.local`.
- `chrome.alarms` watchdog fallback (30 s minimum) and missed-window rescheduling.
- Per-tab promise locks and per-session event write queue.
- Service-worker restart/rehydration; browser-restart finalization; extension-update cleanup.
- Tab close/navigation handling; reload failure handling with 3-strike stop.
- Content-script injection fallback via `chrome.scripting`.
- v2.3 message aliases (`START_REFRESH`, `STOP_REFRESH`, `GET_QA_LOGS`, `CLEAR_QA_LOGS`) and v2.3-shaped logs.

#### Documentation and tests

- README with installation, usage, evaluation semantics, architecture, testing and packaging.
- Architecture, permissions, privacy, known limitations, test report, changed-files and publishing docs.
- 51 Node unit tests and 25 real-Chromium E2E tests.
- Store README and optional listing screenshots.

### Changed

- Popup rebuilt around three modes, presets, live summary and a fixed bottom action bar; branding, colors, author and footer links preserved.
- Settings page expanded with history/screenshot defaults, storage usage and local-data controls.
- Badge: refresh countdown remains red/green; Monitor/QA-without-refresh shows a QA/failure badge.
- Text semantics clarified: pending appearance/disappearance/change conditions are WARN; assertion failures are FAIL; unavailable data is UNKNOWN.
- “Text changes” remains whole-page comparison (v2.3 behavior), now with baseline reset on SPA navigation.
- HTTP/timing are recorded in Refresh mode as structured events, not only “Reload requested”.
- `showCountdown` setting now controls badge visibility with a clearer label (key preserved for compatibility).
- Date formatting in the English UI uses `en-GB` 24-hour format.
- Permissions: added `alarms` and `webRequest`; removed `tabs`; no `webNavigation`, no `webRequestBlocking`, no `<all_urls>`.

### Fixed

- MV3 timer fragility: content timers + watchdog alarm, state persisted outside the worker.
- Duplicate event writes caused by unsynchronized baseline/check handlers (per-session queue).
- Double reload requests (due-time tolerance + last-reload guard + single runtime).
- Event/notification spam from repeated unchanged DOM mutations.
- Stale monitoring state after SPA navigation (baseline reset, URL checks).
- Invalid selector/regex no longer crashes or appears as “element not found”.
- Storage quota errors no longer crash monitoring; warning surfaced.
- Tab close/replacement/session cleanup leaks.
- Report HTML/CSV injection risks.
- Popup actions hidden below the fold.
- Service worker startup failure caused by a non-existent `webNavigation.onBeforeRedirect` API (removed; `webRequest` used).
- Missing HTTP statuses in Chromium 153 (observe-only `webRequest` added with an explicit main-frame filter).
- Baseline could overwrite a concurrent watcher FAIL (write serialization).

### Removed / deliberately not used

- `tabs` permission (not required).
- `webNavigation` permission (not required after switching to `webRequest`).
- `webRequestBlocking` (never requested).
- Remote code, telemetry, analytics and external dependencies.
- No v2.3 feature was silently removed. The old `refreshTabs` runtime timers are not resumed after upgrade; start a new session.

### Migration and compatibility

- Existing v2.3.0 local `qaLogs` are merged into a new read-only session and raw logs are backed up under `qaLogsV2Backup`.
- Old `refreshTabs` timer state is cleared; the previous service worker no longer exists after the update.
- Message aliases keep legacy callers working.
- Settings keys are preserved and normalized.
- Version 3.0.0 is used because the extension now provides the implemented QA tooling, MV3 resilience and compatibility described above.

### Security and privacy

- Local-only operation; no uploads or telemetry.
- Minimal permission set documented in `PERMISSIONS.md`.
- Explicit user opt-in for screenshots; local-only storage.
- Report content escaped; imports validated; no remote code.
- Privacy policy bundled as `privacy.html` and `PRIVACY.md`.

### Verification

- Unit: **51 / 51 PASS**.
- Real Chromium E2E: **25 / 25 PASS**.
- Manifest, file references, syntax, inline-script and remote-code scans performed.
- Chrome Web Store approval is **not** claimed; the extension was not uploaded.

### Known issues

See `KNOWN-LIMITATIONS.md`, including successful screenshot capture (manual test), client-side redirect statuses, historical HTTP status, cross-origin iframes/closed shadow DOM, background throttling and browser restart behavior.

---

## 2.3.0 — supplied baseline

- Dynamic page text watching with `MutationObserver`.
- Text conditions: appears, absent, disappears after being present, changes.
- Local per-tab QA event log (up to 500 events).
- CSV export from the popup.
- Continuous refresh, cycles, pause, countdown badge, cache bypass, local settings.
- Manifest V3, permissions: `storage`, `activeTab`, `tabs`, `scripting`, `notifications`; HTTP/HTTPS hosts.

## 2.2.0

- Text condition monitoring added to the popup; notify/stop on match.

## 2.1.0

- Earlier refresh extension baseline.

---

## Version rationale

`3.0.0` is justified by the new functional modes, monitoring capabilities, data model, dashboard/report subsystem, permission changes and MV3 reliability work. It is not a cosmetic version bump.
