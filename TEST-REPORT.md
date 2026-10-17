# Test Report — Odesoftami QA Monitor v3.2.0

Date: **2026-10-17**
Product: **Odesoftami QA Monitor**
Tester: implementation agent (automated suites + code inspection)
Scope: v3.2.0 source, detached Chrome popup window, real Chromium E2E, v3.2.0 ZIP, preserved v3.1.0/v3.0.0 ZIPs

> Only executed checks are reported as PASS. Manual and NOT TESTED items are listed explicitly. Chrome Web Store approval is not claimed.

---

## 1. Environment

| Item | Value |
|---|---|
| OS | macOS (arm64) |
| Node.js | v24.18.0 |
| Browser for E2E | Chromium **153.0.7983.0**, `--headless=new`, unpacked extension |
| Branded Chrome installed (not used for E2E) | Google Chrome 155.0.8059.85 |
| Test server | Local Node HTTP fixtures: 200/302/403/404/500, SPA, dynamic DOM, delayed/hanging load |
| Window type | Detached Chrome extension popup window (`chrome.windows.create`, type `popup`) — **not Electron** and not an anchored action popup |
| Tested content window | **400×600** default; **420×560 outer minimum** enforced |
| Tested footer | `© 2026 Denys Oleksiienko · v3.2.0 · GitHub ↗ · Web ↗` |
| Manifest minimum | Chrome 120 |

---

## 2. Commands executed

```bash
npm run check
node --test tests/unit/*.test.js
node tests/e2e/run.js
```

Additional validation: manifest references, no inline scripts, no remote code, `unzip -t`, extracted-ZIP load in Chromium, popup layout/status/footer smoke, v3.0/v3.1 ZIP hash checks.

---

## 3. Results

| Suite | Tests / steps | PASS | FAIL | NOT TESTED |
|---|---:|---:|---:|---:|
| Unit (`tests/unit/*.test.js`) | **55** | **55** | 0 | 0 |
| Real Chromium E2E (`tests/e2e/run.js`) | **28** | **28** | 0 | 0 |

Artifacts: `tests/e2e/results.json`, `store/popup-400.png`, `store/popup-active.png`, `store/popup-summary.png`, `store/popup-qa.png`, dashboard/options/floating-panel screenshots.

---

## 4. Unit coverage (55 PASS)

All v3.1 unit coverage remains:

- interval/cycle validation, regex/URL/selector validation;
- config validation/normalization, event model/null fields, stats;
- scheduling, badge, CSV/HTML/JSON escaping/XSS safety;
- presets, legacy config mapping, configuration summary;
- panel settings normalization;
- engine start/stop, duplicates, sender restrictions;
- continuous/cycle scheduling, watchdog;
- monitor/QA mode checks, HTTP/URL/redirect/network handling, tab association;
- no collection after stop;
- text/DOM checks, dedupe/notifications/stop conditions;
- load timing PASS/WARN/UNKNOWN/historical;
- tab close, SW suspension/lost runtime, history bounds/quota;
- v2.3 migration, preset CRUD/import, screenshots, delete/clear;
- update handling, legacy messages, two-tab isolation;
- injection fallback, concurrent writes;
- panel data/prefs/final state, panel stop/open dashboard;
- clear history preserves active sessions and screenshots;
- manifest v3.2.0 branding, exact permissions, content-script order, no inline/remote code, detached action wiring.

---

## 5. Real Chromium E2E coverage (28 PASS)

1. Extension loads as MV3 v3.2.0 with new branding and exact permissions.
2. Service worker responds with four built-ins.
3. **Detached popup / v3.2 UX:**
   - ☰ / three-bar control is **absent**; header contains only Settings and Close.
   - fixed header + fixed mode tabs; tabs fit and stay put when content scrolls.
   - fixed Start/Stop, fixed status line, fixed footer; status is not duplicated in scrolling content.
   - status shows **Not monitoring** initially; `Monitoring` while Monitor runs; `Refreshing` while Refresh runs; `QA Session running` while QA runs; `Paused` between cycles; `Not monitoring` after stop.
   - `Refresh` hides the legacy Text condition card; Presets and Last session remain.
   - `QA Session` shows **Optional page refresh**, explanatory note and **Reload pages during this QA session** toggle.
   - Text / DOM / URL show **ON/OFF**; Session options shows **DEFAULTS**; state survives collapse.
   - Last session shows a mode chip (Monitor / Refresh / QA Session), Export CSV, Clear history, Dashboard; history is not reset by switching tabs.
   - popup Clear history enabled after stop; clears completed sessions; summary resets to Live summary.
   - footer text/version/links: `© 2026 Denys Oleksiienko · v3.2.0 · GitHub ↗ · Web ↗`; 10 px/400/#737373/center/one line; links `https://github.com/odesoftami` and `https://odesoftami.com/apk` with `_blank`/`noreferrer`.
   - Start/stop from the real extension window; close `×` removes the window.
   - **Minimum size:** CDP `Browser.setWindowBounds` shrank the window to **320×400**; the `onBoundsChanged`/`resize` guard restored it to **≥420×560**. At minimum: no horizontal overflow, all three tabs fit, Start/Stop/status/footer visible.
   - Enlarged to **640×720**: no overflow; tabs/footer/status remain visible.
4. **QA Session without optional refresh:** `autoRefresh=false`; text check PASS recorded; no `reload_requested` after 2.5 s; stop works.
5–7. Continuous refresh, HTTP 200, load timing, badge; cycles pause/resume.
8. Dynamic text/DOM WARN→PASS; historical timing UNKNOWN.
9. Floating QA panel: counters match session data, latest FAIL, collapse/expand, drag/persistence, SPA single host, hide keeps monitoring, Stop final summary, disabled panel, Refresh exclusion, QA mode/load timing.
10. Text-change regex PASS.
11. DOM disappearance/expected-text FAIL.
12. Text disappears, DOM text changes, SPA URL FAIL.
13. Text absent FAIL; screenshot refusal `screenshot_skipped`.
14. Invalid selector FAIL; invalid regex rejected.
15. HTTP 200/403/404/500/redirect/URL destination.
16. Network error FAIL with null status; session remains active.
17. No collection after STOP.
18. Stop-on-match notification/stop.
19. Legacy `START_REFRESH`.
20. Tab close → `tab_closed`.
21. Service-worker target closed → restart/recovery.
22. Preset form save.
23. Options save/restore including floating-panel settings and version.
24. IndexedDB screenshot put/list/get/delete.
25. CSV/HTML/JSON builders from real events.
26. Actual browser downloads CSV/HTML/JSON.
27. Responsive dashboard 1280/390, options 760, privacy page.
28. Native dashboard Clear-history cancel/confirm, active/presets/settings/screenshots preservation; no uncaught exceptions.

### Findings fixed in v3.2.0

- The three-bar control was a custom drag handle mistaken for a menu; it was removed. Window movement remains via the OS title bar.
- Chrome has no native minimum size for extension windows; added best-effort bounds enforcement and CSS guards; real CDP resize test passes.
- Status was inside the scroll area and could disappear; moved to fixed bottom, single source.
- Refresh exposed the legacy text card; hidden, while legacy values remain in the model.
- QA refresh looked mandatory; now explicitly optional.
- Collapsed checks now show ON/OFF; Session options neutral.
- Last session now identifies its mode and stays shared across tabs.
- Footer version is dynamic and in sync with manifest.

---

## 6. Acceptance mapping

| Requirement | Status | Evidence |
|---|---|---|
| Remove ☰ button | PASS | E2E header button ids only Settings/Close; no drag bars |
| Remove related handlers/code | PASS | No drag handle markup/CSS/JS; title-bar movement remains |
| Keep Settings and Close | PASS | E2E |
| Minimum width/height | PASS | CDP 320×400 → restored to ≥420×560; tabs/buttons/status/footer visible |
| Resize larger | PASS | E2E 640×720 no overflow |
| Status fixed above footer | PASS | footer/status geometry + scroll checks |
| Status states | PASS | Monitor, Refresh, QA, Paused, Not monitoring |
| Single status source | PASS | status absent from scroll content |
| Refresh simple | PASS | legacy checks hidden; Presets/Last session remain |
| Refresh settings/presets/history | PASS | E2E + unit |
| QA optional refresh | PASS | heading, note, toggle; with/without E2E |
| QA checks without reload | PASS | QA autoRefresh=false test |
| ON/OFF in collapsed blocks | PASS | E2E states, collapse/expand |
| Last session in all tabs | PASS | shared card + type chip; E2E |
| No previous stats as current | PASS | Live vs Last session semantics |
| Floating QA panel regression | PASS | panel E2E |
| Footer one line/grey/version/GitHub | PASS | E2E computed style/text |
| Version 3.2.0 everywhere | PASS | manifest/core/package/UI/docs |
| v3.1.0 ZIP untouched | PASS | hash `2fc2f291…512e` |
| v3.0.0 ZIP untouched | PASS | hash `c14cf13b…cb8d` |
| No publication/GitHub push | PASS | not performed |

---

## 7. Manual / NOT TESTED

1. **Toolbar `onClicked` dispatch in a real Chrome window.** E2E creates the same window through `chrome.windows.create`; headless has no toolbar. Manual: click toolbar icon and verify the detached window opens/reuses.
2. **Successful screenshot-on-failure capture.** Only the refusal/skip path is automated; programmatic popup-window opening does not grant `activeTab`. Manual steps in prior report/README.
3. **Floating panel initialization-failure fault injection.** Try/catch paths reviewed; not injected.
4. **Panel Dashboard button click.** Engine `OPEN_DASHBOARD` is unit-tested; shadow button click not automated.
5. **Notification click → dashboard.** Not automated.
6. **Real browser restart.** Simulated by clearing `chrome.storage.session`.
7. **Background throttling / multi-hour soak.** Not run.
8. **Real storage quota pressure.** Mocked only.
9. **Very large pages/high-frequency DOM mutation CPU.** Not benchmarked.
10. **Chrome Web Store upload/review/approval.** Not submitted.
11. **Branded Google Chrome 155.** Integration used Chromium 153.
12. **Cross-origin iframes/closed shadow DOM.** Not inspectable by design.
13. **Real physical window resize by mouse.** Automated via CDP bounds; OS-specific drag/resize feel not manually verified.
14. **Accessibility screen-reader audit / Excel-Sheets visual rendering.** Not performed.

### Minimum-size implementation note

Chrome extension windows do not expose `minWidth`/`minHeight` like Electron `BrowserWindow`. v3.2.0 uses CSS minimums plus `chrome.windows.onBoundsChanged` and `chrome.windows.update` to restore 420×560. This is best-effort; an OS/window manager that refuses the update may leave the window smaller, though the content retains CSS minimums. The automated CDP test confirms restoration in Chromium 153.

---

## 8. ZIP/static validation

- All JS passes `node --check`; manifest v3.2.0; exact permissions.
- No `default_popup`; service worker has action/onClicked/windows wiring.
- ZIP `unzip -t` clean; `manifest.json` at root.
- Extracted ZIP loaded in Chromium: manifest, settings, presets, popup window/footer/status smoke; no page exceptions.
- ZIP excludes tests/store/baselines/dist/package/test docs.
- **v3.1.0 ZIP preserved:** SHA-256 `2fc2f291f8f8fafeafdc34bc403115c6e78ba1c6c140b7a8ad79ec52afa1512e` (not overwritten).
- **v3.0.0 ZIP preserved:** SHA-256 `c14cf13b6a212f3bf62f37395fca28113d892a2e8f131b145e3eeeb616c5cb8d`.
- **v3.2.0 ZIP:** **134,572 bytes**, SHA-256 **`f634b8408f6f81fc6c6e69bd39c67ce40afa9ca29ce3b768cec4410037f8e54c`**; see `DELIVERY.md` / `dist/SHA256SUMS-v3.2.0.txt`.
