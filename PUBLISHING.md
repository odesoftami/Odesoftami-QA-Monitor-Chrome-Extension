# Chrome Web Store publishing guide

This document prepares the v3.2.0 package for a Chrome Web Store submission. **No upload or publication was performed, and approval is not claimed.** The publisher must review and submit the package.

---

## 1. Preconditions

- Google Chrome Web Store developer account, verified contact email and 2FA.
- A **public privacy policy URL** (host `PRIVACY.md` or an equivalent page; `privacy.html` is bundled but is not a public URL).
- Store listing text and at least one screenshot (1280×800 or 640×400).
- A ZIP with `manifest.json` at its root.
- Review of permission justifications and data practices (below).

The project ZIP is generated as:

```bash
cd Odesoftami-Auto-Refresh-Chrome-Extension
mkdir -p dist
zip -r -X dist/odesoftami-qa-monitor-v3.2.0.zip \
  manifest.json service-worker.js refresh-content.js panel-content.js \
  popup.html popup.css popup.js \
  options.html options.css options.js \
  dashboard.html dashboard.css dashboard.js privacy.html \
  lib icons README.md CHANGELOG.md PRIVACY.md PERMISSIONS.md \
  ARCHITECTURE.md KNOWN-LIMITATIONS.md \
  -x '*.DS_Store'
unzip -t dist/odesoftami-qa-monitor-v3.2.0.zip
unzip -l dist/odesoftami-qa-monitor-v3.2.0.zip | head -20
```

A ready v3.2.0 ZIP is provided at `dist/odesoftami-qa-monitor-v3.2.0.zip` with a SHA-256 in the delivery summary. The v3.1.0 and v3.0.0 ZIPs remain untouched.

---

## 2. Package verification checklist

- [ ] `manifest.json` is at the ZIP root (not inside an extra folder).
- [ ] `manifest_version` is 3; version is `3.2.0`.
- [ ] Name, short name, description, icons 16/32/48/128 exist.
- [ ] No remote code, `eval`, `new Function`, inline scripts or inline event handlers.
- [ ] Permissions: `storage`, `activeTab`, `scripting`, `notifications`, `alarms`, `webRequest`; hosts `http://*/*`, `https://*/*`.
- [ ] No `webRequestBlocking`, no `tabs`, no `webNavigation`, no `unlimitedStorage`, no `<all_urls>`. No new permission was added in v3.2.0.
- [ ] `service-worker.js`, content script, popup, options, dashboard, privacy page and `lib/` files load with no console errors.
- [ ] `node --test tests/unit/*.test.js` passes.
- [ ] `node tests/e2e/run.js` passes (Chromium available).
- [ ] ZIP integrity (`unzip -t`) passes.
- [ ] Privacy policy URL is public and matches the bundled policy.
- [ ] No analytics/telemetry/upload code.
- [ ] Screenshots show real UI (not mockups).

---

## 3. Store listing copy

### Name (max 75)

`Odesoftami QA Monitor`

### Short description (max 132)

`Browser QA & Monitoring Tool`

### Detailed description

> **Odesoftami QA Monitor — Browser QA & Monitoring Tool**
>
> Refresh pages on a schedule and run local QA checks without sending data anywhere. A compact floating QA panel keeps results visible on the page.
>
> **Three real modes**
> - **Refresh:** simple continuous or cycle-based reloads from 2 seconds to 24 hours, with Presets, Start/Stop, Last session and countdown badge.
> - **Monitor:** live text, DOM element, URL, HTTP/navigation and load-timing checks without reloading.
> - **QA Session:** checks always run; page reloads are an explicit optional toggle. Record events, view statistics and export a report.
>
> **v3.2 usability**
> - ☰/three-bar control removed; Settings and Close remain.
> - Minimum 420×560 window; tabs, Start/Stop, status and footer stay usable while content scrolls.
> - Fixed single status line above the footer: Not monitoring / Refreshing / Monitoring / QA Session running / Paused.
> - Collapsed checks show ON/OFF; Last session shows its type and stays available in all three modes.
> - Footer: `© 2026 Denys Oleksiienko · v3.2.0 · GitHub ↗ · Web ↗` (dynamic version).
>
> **Monitoring that understands dynamic pages**
> - Text appears, is absent, disappears or changes; optional regular expressions.
> - CSS-selector watcher: element appears/disappears/text changes, optional expected text.
> - SPA URL changes and unexpected destinations.
> - Main-frame HTTP status, redirects and network errors when Chrome exposes them; otherwise an honest UNKNOWN.
> - Navigation Timing for total load, DOMContentLoaded and load event.
>
> **Structured QA history**
> - PASS / FAIL / WARN / UNKNOWN events with URL, expected/actual values, HTTP status, load duration and reasons.
> - Live dashboard with actual totals, pass rate, average load and session duration.
> - CSV, standalone HTML and JSON reports from recorded data only.
>
> **Floating QA panel**
> - Live PASS / FAIL / WARN / UNKNOWN counters, latest event and load timing on the monitored page.
> - Collapse to a QA indicator with FAIL count; drag and position persists per site; hide without stopping monitoring.
> - Stop/Dashboard actions use the same session engine — no duplicate monitoring.
>
> **Quick history cleanup**
> - Clear completed session history next to Export CSV, with a confirmation that shows affected counts.
> - Active sessions, presets, settings and screenshots are preserved.
>
> **Local presets**
> - Deployment Monitor, Error Watch, URL/Redirect Check, Custom QA Session.
> - Save, edit, rename, duplicate, delete, export and import validated JSON.
>
> **Privacy first**
> - No telemetry, analytics, accounts or remote code.
> - No uploads of browsing data, QA logs or screenshots.
> - Optional screenshots are saved locally in IndexedDB and can be cleared.
> - Data stays in your browser profile.
>
> Created by Denys Oleksiienko. Simple. Useful. Free. Refresh is simple, Monitor is live, QA Session keeps refresh optional, status is always fixed above the footer, and the window has a 420×560 minimum. Footer: `© 2026 Denys Oleksiienko · v3.2.0 · GitHub ↗ · Web ↗`.
>
> Minimum Chrome 120. Some Chrome-protected pages cannot be monitored. Successful screenshot capture requires the active/focused tab and Chrome’s activeTab grant; skipped captures are logged with the reason.

### Category

Productivity (Developer Tools is also plausible; choose the category that best matches the publisher’s listing strategy).

### Language

English.

### Homepage

`https://odesoftami.com/apk/`

### Support/contact

Use the contact details published on the Odesoftami website.

---

## 4. Single-purpose statement

> Timed page refresh and local QA monitoring/reporting for pages the user explicitly starts a session on.

---

## 5. Permission justifications (short form for the listing)

- **storage:** save local settings, sessions, events and presets.
- **activeTab:** identify the tab the user explicitly monitors and support opt-in screenshots.
- **scripting:** inject the packaged monitoring script into an already-open tab at session start.
- **notifications:** local alerts for configured conditions/failures.
- **alarms:** service-worker-safe fallback timer/watchdog.
- **webRequest:** observe-only, main-frame HTTP/HTTPS access to read final status, redirect target and network error; no blocking or modification; `webRequestBlocking` is not used.
- **Host access (http/https):** run the monitor on user-chosen pages and receive their main-frame navigation details.

Full text: `PERMISSIONS.md`.

---

## 6. Data practices answers (Chrome Web Store questionnaire)

- Does the extension collect user data? **No.**
- Does it sell or transfer data to third parties? **No.**
- Is data used for advertising, creditworthiness or lending? **No.**
- Does it use remote code? **No.**
- Does it collect authentication information, cookies or browsing history? **No.** URLs of pages the user explicitly monitors are stored locally as part of the session record.
- Are screenshots uploaded? **No.** Opt-in local storage only.
- Privacy policy URL: **required** — host `PRIVACY.md` publicly and provide that URL.

If the store questionnaire requires selecting categories of “locally processed” data, describe it as website content/URLs processed and stored locally solely to provide the user-facing monitoring/history features; no collection or transmission occurs.

---

## 7. Screenshots and promotional assets

Real UI assets generated from the running extension are in `store/`:

- `store/dashboard-1280x800.png` — 1280×800 overview with real pass/fail/HTTP data (valid store size).
- `store/dashboard-390.png` — narrow responsive dashboard.
- `store/popup-400.png` / `store/popup-active.png` — real detached popup window, 400×600 content, fixed header/tabs/status/footer, Settings/Close controls and GitHub/Web links.
- `store/popup-qa.png` — QA Session optional-refresh UI and note.
- `store/popup-summary.png` — Last session with type chip and Clear history beside Export CSV.
- `store/popup-summary.png` — popup scrolled to Last session showing Clear history immediately right of Export CSV.
- `store/floating-panel.png` — real floating QA panel over a monitored page.
- `store/options-760.png` — settings page with floating-panel options.
- `store/popup-640x400.png` — optional 640×400 listing composition built from the real popup screenshot (not runtime code).

The store accepts 1280×800 or 640×400 screenshots. Use `dashboard-1280x800.png` as the primary screenshot. Crop/pad additional screenshots to a valid size if needed. Do not present mockups as proof of unimplemented functionality.

---

## 8. Reviewer test instructions

1. Load the unpacked folder or ZIP via `chrome://extensions` → Developer mode → Load unpacked.
2. Open any normal HTTP/HTTPS page.
3. Click the toolbar icon; a **detached popup window** should open showing **Odesoftami QA Monitor**, fixed mode tabs, the page title/URL, fixed status and footer. Verify the ☰/three-bar control is absent, Settings and `×` remain, and the footer is `© 2026 Denys Oleksiienko · v3.2.0 · GitHub ↗ · Web ↗`. Try shrinking the window; it should stop at 420×560 and still show all three tabs, Start/Stop, status and footer. Enlarging should work.
   - Drag by the header bars or the browser title bar; the window should move.
   - Close with `×`; it should disappear.
   - Click the toolbar icon again; it should reopen/reuse the window for the current tab.
4. Choose **Monitor**, enable a text check matching a phrase on the page, click **Start monitoring**.
5. The status should show live monitoring and a floating QA panel should appear on the page (if enabled). Collapse/expand it, drag it, and verify counters update. Open **Dashboard** to see the same events/statistics.
6. Stop the session (from the panel or popup); verify the final panel summary and the session in History.
7. Open a known 404 page in a monitored session to verify HTTP 404 FAIL; a redirect verifies redirect/final navigation; an unreachable host verifies a network-error FAIL.
8. Test CSV/HTML/JSON export and Quick Clear history from the dashboard. Cancel once, then confirm: completed sessions/events are removed, while the active session, presets, settings and screenshots remain. Verify the popup Last session card also has **Clear history** immediately to the right of **Export CSV**.
9. Test presets: apply a built-in, save a custom preset, export/import JSON.
10. Screenshots: enable “Screenshot on failure”, start from the **toolbar click** (not programmatic), keep the tab visible/focused, cause a FAIL, then check the dashboard gallery. If Chrome refuses, a `screenshot_skipped` event explains why.
11. No account, credentials or network service is required.

---

## 9. Known review-sensitive points

- Broad HTTP/HTTPS host access is required to monitor arbitrary user-chosen pages. It is explained in the listing and `PERMISSIONS.md`.
- `webRequest` is observe-only and filtered to main-frame HTTP/HTTPS; no blocking.
- The extension does not request `<all_urls>`; screenshot capture may be refused and is explicitly logged.
- The extension does not claim to inspect every network request.
- The dashboard is a local extension page; no remote content.
- The privacy policy must be public; bundling `privacy.html` alone is not sufficient for the store listing.
- The footer GitHub link is the owner-supplied profile `https://github.com/odesoftami`, not a repository URL. Do not claim it is a source repository.
- The v3.1.0 and v3.0.0 ZIPs are preserved; do not overwrite them with the v3.2.0 build.
- Toolbar `onClicked` dispatch is a manual check because headless Chromium has no toolbar; window creation, minimum-size enforcement and controls are automated.

---

## 10. After submission

- Respond to reviewer questions with the test instructions and permission rationale.
- Do not claim approval before it is granted.
- If the store requests changes, update the version/package, re-run the test suites, and re-upload.
- Keep the privacy policy URL live for as long as the extension is listed.
- The developer is responsible for the publisher account, listing accuracy, screenshots, support contact and legal compliance.

**No upload, publication or GitHub release was performed by this project.**
