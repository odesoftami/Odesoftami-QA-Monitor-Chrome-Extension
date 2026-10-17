# Known limitations — Odesoftami QA Monitor 3.2.0

This file lists what the extension **cannot** reliably do, why, and what it does instead. Nothing here should be read as a Chrome Web Store approval or a claim that untested behaviour works.

---

## 1. HTTP status and navigation

- **Only main-frame navigations are observed.** `webRequest` is registered with `{ urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] }`. Subresource requests, XHR/fetch calls, service-worker requests and iframe requests are not inspected.
- **Only while a session is active.** Events are associated by tab id with an active QA session. Requests on tabs without a session are ignored; after `STOP_SESSION` no further events are collected. Tested.
- **Status may be unavailable.** Chrome does not expose a status for every navigation (examples: some cached/browser-generated pages, some client-side transitions, pages already loaded before the session started). In those cases the result is `UNKNOWN` with a reason. The extension never fills in 200.
- **A page loaded before session start has UNKNOWN status.** There is no supported API to retrieve the already-completed response status retroactively. A later reload/navigation is recorded normally.
- **`webRequest` is observe-only.** No blocking, no request modification, no headers/body reading. The extension cannot retry a failed request, inject headers or simulate a status.
- **Redirect status:** server redirects can be recorded by `webRequest.onBeforeRedirect` with the 3xx status when Chrome exposes it. JavaScript/meta/client-side redirects do not produce a redirect status; they are only detected as URL changes when URL checking is enabled. The extension does not fabricate a 3xx.
- **Redirect target may be the final URL only.** A long redirect chain can produce multiple redirect events; deduplication is time/target-based.
- **HTTP status is not a substitute for a full network report.** The extension cannot state that every request succeeded just because the main document did.
- **Navigation errors:** `net::ERR_ABORTED` is treated as WARN because it is commonly caused by a superseding navigation. Other `net::ERR_*` errors are FAIL. A browser error page can itself load successfully; the original request failure is reported separately.

## 2. Page load performance

- Measurements come from the page’s **Navigation Timing API** (`performance.getEntriesByType('navigation')`).
- They describe navigation start, DOMContentLoaded and the load event. They are **not** server response time and **not** TTFB. The UI/report never labels them that way.
- If the page loaded before the session started, the timing is historical: it is recorded as UNKNOWN and excluded from the average load duration.
- If the load event never fires, the timing is WARN/UNKNOWN; a 20-second timeout sends an incomplete measurement.
- SPA route changes do **not** create a new Navigation Timing entry. A session that only navigates client-side may have no new load measurement.
- Cross-origin restrictions, bfcache restores and browser-generated pages can make some fields unavailable.
- Load timing is a browser-side milestone measurement, not a server-SLA measurement.

## 3. Text monitoring

- Reads **visible top-level document text** (`innerText`, falling back to `textContent`), normalized and capped in memory (500,000 characters). It does not read canvas pixels, images, PDFs, plugin content or browser UI.
- **Cross-origin iframes** cannot be inspected. Content scripts are top-frame only. Same-origin iframe text is not independently watched either.
- **Closed shadow DOM** cannot be inspected. Open shadow roots are not separately observed; only the light DOM of the top-level document is monitored. This can miss text inside web components.
- “Text changes” compares the **whole normalized page text** with the baseline. Pages with clocks, rotating ads, carousels or counters can trigger it. It is intentionally a page-level check; use the DOM watcher for a scoped element.
- “Text disappears” is only evaluated if the text was present at baseline. If it was never present, the result is UNKNOWN (not PASS/FAIL).
- “Text appears” is pending (WARN) until found; it does not have a deadline-based FAIL. This is intentional to support deployment-ready text. Use a DOM/expected-text check or a custom stop condition if a deadline is required.
- Matching is case-insensitive. Regex uses the `i` flag; user-supplied flags are not supported. A catastrophically backtracking regex can still consume page CPU; patterns are length-limited but cannot be fully sandboxed in JavaScript.
- Baseline capture waits for DOM stability up to 10 seconds; a page that mutates forever may still be captured at the cap.
- Visibility toggles are detected through `childList`, `characterData` and `class`/`style`/`hidden`/`aria-hidden` attributes. Animations that continuously change these attributes can cause extra debounced evaluations.
- Full page text is never persisted, but expected patterns, URLs and short result values are stored locally and can be sensitive.

## 4. DOM watcher

- A single CSS selector per session (not multiple watchers).
- The popup/dashboard validate selector syntax in their own document; the content script catches page-specific syntax errors at runtime. An invalid selector is a FAIL with a clear reason, not “element not found”.
- If the element is legitimately absent, “appears” is WARN (pending); “text changes” is FAIL, and expected-text mode is FAIL.
- Element text is normalized and capped at 20,000 characters. `expectedText` is a case-insensitive containment check, not an exact match.
- The watcher does not pierce shadow DOM, iframes or canvas.
- Only one element is checked; if the selector matches multiple elements, the first match is used.

## 5. URL monitoring

- Top-level document URL only.
- Hash is ignored by default; disable “Ignore URL hash” to include it.
- SPA URL changes are detected by a **1-second poll** plus `popstate`/`hashchange`; a change can take up to about a second to be noticed in the background.
- The extension does not intercept every `history.pushState` synchronously.
- Redirect destinations are compared after navigation; a short-lived intermediate URL may only appear in redirect events.
- `about:blank`, `chrome://`, `file://`, extension pages and the Web Store are not monitored; starting there is rejected.

## 6. Refresh scheduling

- Minimum interval is **2 seconds**; maximum is **24 hours**.
- Chrome throttles timers in background/occluded tabs and can suspend the MV3 service worker. The extension uses both an in-page timer and a `chrome.alarms` watchdog.
- `chrome.alarms` has a **30-second minimum period** in current Chrome; the watchdog is a fallback, not a 2-second guarantee.
- A missed window longer than `max(120 s, interval × 3)` is skipped and rescheduled rather than replayed, to avoid a reload storm after sleep. A WARN event records the skip.
- Intervals are targets, not hard real-time guarantees.
- Three consecutive reload failures stop the session.
- A `beforeunload` dialog can block a reload; the page-side retry logic re-syncs state.
- Browser restart clears `chrome.storage.session`; active sessions are finalized as “Monitoring state was lost”. They are not automatically resumed.
- Extension update stops active sessions with `extension_updated`.
- Tab replacement/discard/close ends the session (`tab_closed`/`tab_unavailable`).

## 7. Service worker, storage and concurrency

- Active runtime state lives in `chrome.storage.session`. It survives service-worker suspension but not browser restart.
- Event history is bounded: up to 30 sessions; 50–2,000 events per session (UI offers 200/500/1,000/2,000; default 500); custom presets up to 50; screenshots 20 entries/40 MB; floating-panel position/collapsed preferences 50 origins.
- **Clear completed history preserves screenshots.** Screenshots are removed only by the separate “Clear stored screenshots” action, individual screenshot deletion, or automatic retention pruning. This avoids surprising data loss but can leave orphaned screenshots after their session is cleared.
- When `chrome.storage.local` is full, the engine prunes oldest **completed** sessions and retries once. If the quota is still exhausted (for example many active sessions), the latest event may be lost and a storage warning is surfaced. It does not silently reset data.
- Pruning deletes old events/screenshots and cannot be undone.
- Concurrent messages for the same tab are serialized; different tabs can run concurrently. An intentional second start on the same tab is rejected.
- A browser crash can lose events that were not yet written; event writes are immediate but Chrome storage is asynchronous.
- Legacy `qaLogs` are migrated once; the old `refreshTabs` runtime timers are not resumed.

## 8. Screenshots

- **Opt-in only.** No screenshot is taken unless the session/user enables it.
- Chrome requires `activeTab` or `<all_urls>` plus an active, focused tab for `captureVisibleTab`. This extension deliberately does not request `<all_urls>`.
- Because the popup window is programmatically opened in headless automation, `activeTab` was not granted there; the tested path records `screenshot_skipped`. **Successful capture is NOT TESTED** and requires a manual toolbar-click test in a real Chrome window.
- Capture is viewport-only, not full-page. It may include sensitive visible content.
- Background tabs, minimized windows, cross-origin navigations that revoke `activeTab`, protected pages and some Chrome configurations can refuse capture.
- Every refusal is logged as a WARN event with the Chrome error; there is no silent capture.
- Screenshots are stored locally in IndexedDB, never uploaded, capped at 20 entries/40 MB, and cleared explicitly. Reports do not embed them.
- No OCR, pixel comparison or visual assertions are performed.

## 9. Notifications

- Local OS notifications only; appearance depends on the OS and notification settings.
- The extension suppresses repeated notifications for an unchanged condition/failure using transition tracking and a 60-second dedupe window.
- Clicking a notification opens the local dashboard. This click path was not automated.
- No notification content is sent anywhere.

## 10. Privacy and access boundaries

- Cross-origin iframe content and closed shadow DOM cannot be inspected.
- The extension cannot access `chrome://` pages, the Chrome Web Store, other extensions, `file://` URLs or authentication prompts. Starting on them is rejected or impossible.
- Host access is HTTP/HTTPS-wide because the extension is designed to monitor arbitrary user-chosen pages. It is not a per-site optional grant.
- URLs can contain tokens/query parameters. Exported reports and screenshots can be sensitive; handle them accordingly.
- No telemetry, analytics, remote code, accounts, cookies or credentials are used.
- Web Store review can still request changes; approval is not guaranteed and is not claimed.

## 11. UI and reports

- The toolbar action opens a **detached popup window** (420×680 requested), not Chrome’s anchored action popup. If `chrome.windows.create` fails, the same page opens as a normal tab.
- The popup layout uses a fixed product header + fixed mode tabs, a scrolling middle, and fixed Start/Stop/status/footer regions. The tested content viewport is 400×600; OS window chrome/manager differences can change the outer size.
- Chrome has **no native `minWidth`/`minHeight`** for extension windows. v3.2.0 enforces a 420×560 outer minimum via CSS plus `chrome.windows.onBoundsChanged` → `chrome.windows.update`. A window manager that refuses the update may leave the window smaller; this is best-effort, not a native constraint.
- The ☰ / three-bar control was removed in v3.2.0 (it was a custom drag handle). Move the window by the OS title bar. The toolbar `onClicked` dispatch remains a manual check in a real Chrome window because headless has no toolbar.
- Closing `×` removes the popup tab/window. If the page is opened as an ordinary tab, the same control closes the tab.
- The footer is one line: `© 2026 Denys Oleksiienko · v3.2.0 · GitHub ↗ · Web ↗`; version is read from `manifest.json`. GitHub points to the owner-supplied profile `https://github.com/odesoftami`; Web points to `https://odesoftami.com/apk`.
- The popup Clear history button uses the same confirmation/engine path as the dashboard; its click path is E2E-tested with a stubbed confirmation, while the native dialog is exercised from the dashboard.
- Refresh hides the legacy Text condition card. Legacy text values remain supported in the model for compatibility but are not editable in Refresh.
- QA auto refresh remains **checked by default** for backward compatibility; it is optional and can be disabled without disabling text/DOM/URL checks.
- Status is a single fixed line; it is not a full event log. Detailed state/results stay in the scrolling content, Dashboard and floating panel.
- The collapsed ON/OFF labels describe whether a check is enabled, not whether its last result passed.
- The dashboard pauses its 3-second polling while hidden; it refreshes on visibility change.
- Reports are static local files. The HTML report has no scripts; it cannot run imported content by design.
- CSV uses a `#` metadata preamble and CRLF; some spreadsheet importers may treat those lines specially. CSV formula injection is neutralized.
- Screenshots are not embedded in reports.
- Local dates use `en-GB` formatting (24-hour) for consistent English UI; this is not a full localization system.
- No pixel-perfect visual regression testing was performed.
- No accessibility audit with a screen reader was performed; labels, focus styles, `aria-live` regions and keyboard-operable controls are present.

## 12. Floating QA panel and quick clear history

- The floating panel is shown only in **Monitor** and **QA Session** modes; Refresh mode never shows it.
- It polls the service worker every 1.5 s for counts/latest/timing. Updates are near-real-time, not a per-event push; a just-recorded event can take up to ~1.5 s to appear.
- Counters/latest come from the same event store as the dashboard. If storage is full and an event is dropped, the panel and dashboard both reflect the stored events; the panel does not invent counts.
- Collapse shows a small QA pill with the FAIL count. Hide removes the panel for the current page load; there is no in-page restore button after Hide (reload/new session restores it). Hiding never stops monitoring.
- Drag/collapse position is persisted per origin; moving the same site to a different viewport size is clamped to stay on-screen.
- Final summary is retained by default until Dismiss or a new session; if the option is disabled, the panel closes on stop.
- Panel initialization failure is caught and does not stop monitoring, but **fault injection for this path was not automated** (manual/review-only). The panel is a UI client; a broken panel cannot alter event collection.
- Shadow DOM isolates page CSS. Constructable stylesheets are used where available with a `<style>` fallback; a page with unusual CSP behavior may still prevent panel styling, but not monitoring.
- The panel is top-frame only; cross-origin iframe content is not inspected.
- The panel Dashboard button opens the local dashboard and does not create a second session; this engine path is unit-tested, but the actual button click is not automated.
- **Quick Clear history** uses the native browser confirmation. It clears only completed sessions/events and intentionally preserves active sessions, presets, settings and screenshots. Cancel is non-destructive. The native dialog rendering is browser/OS-dependent, and the integration test runs in headless Chromium.
- Clear-history errors (for example a storage failure) are shown as a toast; an injected failure scenario was not automated.

## 13. Browser and distribution

- Chrome/Chromium only; no Firefox/Safari support.
- Manifest declares Chrome 120+; integration tests used **Chromium 153 headless**. Branded Google Chrome 155 was installed but not used for `--load-extension` testing because branded builds restrict that flag.
- The extension has not been uploaded to the Chrome Web Store. No approval, ranking or publication is claimed.
- The v3.1.0 and v3.0.0 ZIPs are preserved and must not be overwritten; v3.2.0 is separate.
- The GitHub link points to the owner-supplied profile, not a repository page; no repository URL was asserted.
- The project is not a GitHub release and no remote distribution was created.
- No license file was supplied with the original project; do not assume a license for redistribution beyond the owner’s instructions.

## 14. Explicitly out of scope for 3.2.0

- Full network waterfall/request inspection.
- Response body/JSON assertions.
- Visual regression screenshots as a test assertion.
- Cross-browser support.
- Cloud sync, teams, accounts or remote report storage.
- Automatic session resume after browser restart.
- Bypassing Chrome protected pages or security boundaries.
- Claiming Chrome Web Store verification.

---

If a limitation is critical to your workflow, the honest fallback is to use the event history and report the measurement as **UNKNOWN/unavailable**, or to extend the extension with a supported Chrome API and a new permission review.
