# Changed files — v3.1.0 → v3.2.0

Baselines: v3.1.0 ZIP (`dist/odesoftami-qa-monitor-v3.1.0.zip`, preserved) and v3.0.0 ZIP (preserved). A historical v3.0.0 → v3.1.0 section follows.

---

## v3.2.0 modified files

| File | Changes |
|---|---|
| `manifest.json` | Version **3.2.0**; no `default_popup` (detached window from v3.1.0 retained); permissions/hosts unchanged. |
| `lib/core.js` | `VERSION` 3.2.0. |
| `popup.html` | Removed ☰/three-bar drag control; fixed top header + compact tabs; fixed bottom Start/Stop + **status bar** + footer; footer version span; Refresh/QA headings and optional-refresh note; Last-session type chip. |
| `popup.css` | Removed drag-handle styles; added fixed status bar, footer version/dots, summary type chip, min-width/min-height guards; retained scrolling middle and fixed regions. |
| `popup.js` | Removed custom drag handlers; added min-size enforcement via `chrome.windows.onBoundsChanged`/`update`; footer version; status semantics; Refresh hides legacy checks; QA optional note; ON/OFF check states; Last-session type; no duplicate status. |
| `privacy.html` | Version 3.2.0. |
| `README.md` | v3.2.0 UX, min size, fixed status, simplified Refresh, optional QA refresh, ON/OFF, Last session, footer, tests/build. |
| `CHANGELOG.md` | v3.2.0 section; 3.1.0/3.0.0 history retained. |
| `TEST-REPORT.md` | v3.2.0 results: 55 unit/28 E2E, min-size CDP test, status modes, manual/NOT TESTED. |
| `PERMISSIONS.md` | v3.2.0 wording; no new permissions; `chrome.windows` min guard. |
| `ARCHITECTURE.md` | v3.2.0 UI/status/Refresh/QA/min-size architecture; 28 E2E. |
| `KNOWN-LIMITATIONS.md` | v3.2.0 UI/min-size/status/Refresh/QA limitations. |
| `PRIVACY.md` | Version 3.2.0. |
| `PUBLISHING.md` | v3.2.0 package/listing/screenshots/reviewer notes. |
| `DELIVERY.md` | v3.2.0 artifacts, hashes, tests, caveats. |
| `package.json` | Version 3.2.0. |
| `store/*.png`, `store/README.md` | v3.2.0 popup/QA/summary/dashboard assets. |

## v3.2.0 added files

| File | Purpose |
|---|---|
| `dist/odesoftami-qa-monitor-v3.2.0.zip` | New installable package; v3.1.0/v3.0.0 ZIPs preserved. |
| `dist/SHA256SUMS-v3.2.0.txt` | New checksum file. |
| `tests/e2e` additions | Minimum window enforcement (CDP 320×400 → ≥420×560), status in Monitor/Refresh/QA/Paused, Refresh without legacy checks, QA without auto refresh, ON/OFF states, Last-session types, footer version/links. |
| `store/popup-qa.png` | QA Session optional-refresh UI. |

## v3.2.0 unchanged

- Storage keys, extension ID/path, session/event schema, v2.3 migration.
- Permissions: `storage`, `activeTab`, `scripting`, `notifications`, `alarms`, `webRequest`; HTTP/HTTPS hosts.
- Monitoring engine semantics, floating QA panel, reports, presets, screenshots.
- Text-condition support inside the model/engine (hidden from Refresh UI).
- v3.1.0 and v3.0.0 ZIPs.

## v3.2.0 removed

- Visible ☰ / three-bar drag control and its pointer-drag handlers (window title bar remains).
- Legacy Text condition card from the visible Refresh tab (data/model support retained).
- Duplicate status from the scrolling content.

---

# Changed files — v3.0.0 → v3.1.0

Baseline: `_baseline/v3.0.0/` (preserved v3.0.0 source; v3.0.0 ZIP untouched).
A historical v2.3.0 → v3.0.0 section follows at the end.

---

## v3.1.0 modified files

| File | Changes |
|---|---|
| `manifest.json` | Name **Odesoftami QA Monitor**, short name **QA Monitor**, version **3.1.0**, description **Browser QA & Monitoring Tool**, default title; removed `default_popup` so the toolbar action opens a detached floating window; added `panel-content.js` after `refresh-content.js` in the content-script sequence (monitoring first, UI second). Permissions/hosts unchanged. |
| `lib/core.js` | Branding constants, `TAGLINE`, copyright year, version 3.1.0, `GITHUB_URL`/`WEBSITE_URL`, floating-panel settings, panel-position constants, updated limitation strings. |
| `lib/engine.js` | Floating-panel data/prefs messages, panel stop/dashboard actions, `qaPanelPrefs` store, settings sync to active content scripts, finalize-before-stop ordering, clear-history screenshot preservation. |
| `refresh-content.js` | Panel lifecycle integration (show on Monitor/QA, destroy for Refresh/disabled, finalize on stop without breaking monitoring). |
| `popup.js` | Detached-window target tab id, drag handle/close controls, dynamic header version, GitHub/Web links, popup Clear history availability/handler, viewport fit. |
| `popup.html` | Detached floating layout: fixed product header with drag/gear/close controls, fixed mode tabs, independently scrolling middle, fixed Start/Stop + footer with GitHub/Web links and popup Clear history. |
| `popup.css` | Fixed header/tabs, scrolling middle, fixed footer, larger gear, drag bars, compact tabs, footer links, popup clear button; real-viewport fitting. |
| `dashboard.html` | Product name/tagline/version, “Live summary”, Export CSV + Clear history, dynamic version. |
| `dashboard.css` | Live-summary action styles. |
| `dashboard.js` | Dynamic version, quick/shared Clear history with native confirmation + counts, active-session selection/counter refresh, product branding. |
| `options.html` | Product name/tagline/version, floating-panel settings section, clear-history screenshot-preservation copy. |
| `options.js` | Dynamic version, floating-panel settings load/save, updated clear-history text. |
| `privacy.html` | Product/version, panel preferences, clear-history screenshot preservation, no-new-permission note, GitHub link note. |
| `README.md` | Updated for v3.1.0: branding, detached floating window, fixed tabs/footer, GitHub/Web links, popup clear history, floating panel, permissions, tests, build, limitations. |
| `CHANGELOG.md` | v3.1.0 section; 3.0.0 history retained. |
| `TEST-REPORT.md` | v3.1.0 results, 55 unit/27 E2E, manual/NOT TESTED, detached-window checks, v3.0.0 preservation. |
| `PERMISSIONS.md` | v3.1.0 wording; explicitly no new permissions; panel/clear-history/detached-window semantics. |
| `ARCHITECTURE.md` | v3.1.0 architecture, detached popup/window drag, fixed tabs/footer, panel component/messages/prefs, clear history, finalize ordering. |
| `KNOWN-LIMITATIONS.md` | v3.1.0 panel, detached popup/window drag, clear-history limitations. |
| `PRIVACY.md` | Product/version, panel prefs, clear-history screenshot preservation, GitHub external-link note. |
| `PUBLISHING.md` | v3.1.0 package/listing/permission/privacy/screenshot guidance. |
| `DELIVERY.md` | v3.1.0 artifact index, paths, tests, checksum, GitHub action. |
| `package.json` | Version 3.1.0, new description, test/check scripts unchanged. |
| `store/*.png`, `store/README.md` | New v3.1.0 screenshots/assets. |

## v3.1.0 added files

| File | Purpose |
|---|---|
| `panel-content.js` | Shadow-DOM floating QA panel (UI only); live data polling, collapse/drag/hide, stop/dashboard actions; no event collection/second engine. |
| `_baseline/v3.0.0/` | Preserved v3.0.0 source and screenshots for comparison/rollback. |
| `dist/odesoftami-qa-monitor-v3.1.0.zip` | New installable package; v3.0.0 ZIP remains. |
| `dist/SHA256SUMS-v3.1.0.txt` | New checksum file; v3.0.0 checksum file remains. |
| New E2E coverage | Detached popup window layout/controls/footer links/popup clear, floating panel, native Clear-history dialog, QA panel timing; added to `tests/e2e/run.js`. |
| New unit coverage | Panel data/prefs/final state, open-dashboard no session, clear-history screenshot preservation, panel settings normalization, manifest content-script sequence. |

## v3.1.0 unchanged

- Extension ID path, storage keys (`settings`, `qaSessions`, `qaEvents:*`, `qaPresets`, runtime), event identifiers and schema.
- Permissions: `storage`, `activeTab`, `scripting`, `notifications`, `alarms`, `webRequest`; HTTP/HTTPS hosts.
- Continuous refresh, cycles, pause, badges, text/DOM/URL/HTTP/timing checks, sessions, dashboard, reports, presets, screenshots, migration.
- v3.0.0 ZIP content and SHA-256.

## v3.1.0 added storage keys

- `qaPanelPrefs` in `chrome.storage.local` (per-origin panel position/collapsed state, max 50 origins).
- New `settings` fields: `floatingPanelEnabled`, `floatingPanelDefaultPosition`, `floatingPanelDefaultCollapsed`, `floatingPanelRetainSummary`.
- Existing settings are normalized with defaults; no key renames, no destructive migration.

---

# Changed files — v2.3.0 → v3.0.0

Baseline: `_baseline/v2.3.0/` (pristine supplied source).
Comparison excludes runtime/test artifacts (`tests/`, `store/`, `dist/`, `.tmp/`).

No v2.3.0 source file was deleted. All original functionality is preserved or intentionally migrated/aliased; see the notes at the end.

---

## Modified

| File | Changes |
|---|---|
| `manifest.json` | Version 3.0.0; MV3; description; `minimum_chrome_version` 120; 32 px icon; permissions reduced/reworked: removed `tabs`, added `alarms` and `webRequest`; no `webNavigation`/`webRequestBlocking`; HTTP/HTTPS host access retained; content script top-frame HTTP/HTTPS at `document_start`. |
| `service-worker.js` | Rewritten as thin MV3 wiring: message dispatch, observe-only `webRequest` listeners with a `main_frame` filter, alarm watchdog, tab lifecycle, install/startup/suspend, notification click → dashboard. No `webNavigation`. |
| `refresh-content.js` | Rewritten content monitor: dormant until sync; dynamic text checks; regex; baseline/reset; DOM watcher; URL polling; Navigation Timing; refresh/badge timers; cleanup; SPA handling; error reporting. |
| `popup.html` | Three modes (Refresh/Monitor/QA), presets, text/DOM/URL/timing/session options, summary statistics, fixed bottom action bar, legacy branding/footer. |
| `popup.css` | New layout/styles for modes, cards, checks, stats, fixed actions; preserves orange/graphite/white, typography and footer. |
| `popup.js` | Mode/config collection and validation, start/stop via `START_SESSION`/`STOP_SESSION`, preset apply/save, live summary, CSV export, dashboard/options links, countdown. |
| `options.html` | Existing settings structure preserved; added default mode, stabilization, history limit, notification/screenshot defaults, local data controls, updated permissions/privacy explanation, dashboard/privacy links. |
| `options.css` | Extended responsive settings styling for new controls/uses. |
| `options.js` | Settings load/save through `GET_SETTINGS`/`SAVE_SETTINGS`, storage diagnostics, clear completed history/screenshots. |
| `README.md` | Replaced the v2.3.0 README with v3.0.0 installation, modes, evaluation semantics, privacy, permissions, testing, packaging and limitations. |
| `icons/icon16.png` | Regenerated from the original 128 px icon for consistent scaling. |
| `icons/icon48.png` | Regenerated from the original 128 px icon for consistent scaling. |

`icons/icon128.png` is unchanged (same SHA-256 as v2.3.0).

---

## Added

### Runtime files

| File | Purpose |
|---|---|
| `dashboard.html` | QA dashboard: live overview, statistics, session history, filters, screenshots, presets, exports. |
| `dashboard.css` | Dashboard responsive styling (desktop/narrow), tables, chips, preset/screenshot cards, toast. |
| `dashboard.js` | Dashboard controller: session polling, actual stats, event tables, filters, session delete/clear, screenshot gallery, preset CRUD/import/export, CSV/HTML/JSON downloads, hash routing, responsive layout. |
| `privacy.html` | Bundled privacy policy page linked from settings. |
| `lib/core.js` | Pure shared logic: constants, validators, config normalization, event model, stats, scheduling/badge, CSV/HTML/JSON reports, presets, limitations. |
| `lib/engine.js` | Background engine: sessions, per-tab locks, per-session event queue, storage, alarms, webRequest policy, notifications, screenshots, quota pruning, v2.3 migration, message dispatch, lifecycle. |
| `lib/screenshots.js` | IndexedDB screenshot store with indexed metadata, size/count caps and pruning. |
| `icons/icon32.png` | 32 px icon required for the manifest/action icon set. |

### Documentation delivered with the source

| File | Purpose |
|---|---|
| `CHANGELOG.md` | Full 3.0.0 change log and version rationale. |
| `PERMISSIONS.md` | Exact permission/host justification, scope, safeguards and store review notes. |
| `ARCHITECTURE.md` | Components, message flow, modes, scheduling, evaluation semantics, storage, reports, errors. |
| `KNOWN-LIMITATIONS.md` | API and behavioural limitations, including untested/manual areas. |
| `TEST-REPORT.md` | Actual test execution results, requirement mapping and NOT TESTED items. |
| `CHANGED-FILES.md` | This file. |
| `PRIVACY.md` | Store-hostable privacy policy text. |
| `PUBLISHING.md` | Chrome Web Store preparation/checklist; no upload performed. |
| `store/README.md` + screenshots | Optional listing assets generated from the running extension. |
| `package.json` | Local test scripts only; not shipped in the extension ZIP. |
| `.gitignore` | Local profiles/build/test artifacts. |

### Tests

| Path | Purpose |
|---|---|
| `tests/unit/mock-chrome.js` | In-memory Chrome API mock (storage quota, tabs, actions, alarms, notifications, scripting, windows, CDP-independent). |
| `tests/unit/core.test.js` | 16 core tests. |
| `tests/unit/engine.test.js` | 29 engine tests (including concurrency, quota, migration, tab association, stop-collection, watchdog, injection fallback). |
| `tests/unit/manifest.test.js` | 4 manifest/files/static-safety tests. |
| `tests/e2e/cdp.js` | Dependency-free CDP/WebSocket client and page helpers; launches Chromium with the unpacked extension. |
| `tests/e2e/server.js` | Local HTTP fixture server (200/302/403/404/500, dynamic, SPA, slow, hang, redirect). |
| `tests/e2e/run.js` | 25-step real-Chromium integration suite, actual popup, downloads, screenshots and responsive checks. |
| `tests/e2e/results.json` | Latest E2E result artifact (regenerated by the suite). |

---

## Removed from the runtime surface

| Item | Reason |
|---|---|
| `tabs` permission | Not needed; host permissions/activeTab provide tab URL/title for HTTP/HTTPS and the action popup. |
| `webNavigation` | Not present in v2.3.0; considered and then deliberately not used in v3.0.0 because it did not expose status codes in tested Chromium. `webRequest` replaced it. |
| v2.3 `refreshTabs` runtime state | Old service-worker timers cannot survive the upgrade; cleared. Users start a new session. |
| v2.3 `qaLogs` active log | Migrated once into a read-only `legacy-v2.3.0` session; raw data backed up under `qaLogsV2Backup` before removal. |

No UI feature, author/branding element, footer link, continuous refresh, cycle, pause, badge, text condition, notification/stop option or local setting was removed.

---

## Unchanged / preserved

- Product name: **Odesoftami Auto Refresh**.
- Author: **Denys Oleksiienko**.
- Orange, graphite and white visual identity.
- Logo/icon artwork (128 px original; other sizes derived from it).
- Footer: “Simple. Useful. Free.” and Odesoftami Apps link.
- Continuous refresh, cycle refresh, pause, 2 s minimum, cache-bypass option, countdown badge behavior, local settings persistence.
- Text-search conditions and notify/stop behavior (now with structured events).
- Original source available in `_baseline/v2.3.0/`.

---

## Release artifacts (not source changes)

| Artifact | Notes |
|---|---|
| `dist/odesoftami-auto-refresh-v3.0.0.zip` | Extension package; manifest at ZIP root; tests/store/baseline/dist excluded. |
| `store/dashboard-1280x800.png` | Real dashboard screenshot (1280×800), generated by E2E. |
| `store/popup-active.png` | Real action-popup screenshot (389×498). |
| `store/dashboard-390.png`, `store/options-760.png` | Responsive screenshots. |
| `store/popup-640x400.png` | Optional listing-size composition of the real popup screenshot (generated separately; not runtime code). |

ZIP integrity, manifest validation, syntax checks and test results are recorded in `TEST-REPORT.md` and the final delivery summary.
