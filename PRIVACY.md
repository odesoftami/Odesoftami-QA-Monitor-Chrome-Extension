# Privacy Policy — Odesoftami QA Monitor

**Publisher:** Denys Oleksiienko (Odesoftami)
**Product:** Odesoftami QA Monitor, version 3.2.0
**Effective date:** 17 October 2026

> This Markdown file is intended to be hosted at a public URL for the Chrome Web Store listing (for example `https://odesoftami.com/privacy/`). The extension also bundles the same policy as `privacy.html`. Hosting the public URL is a publisher step and is not performed by this project.

---

## 1. Summary

Odesoftami QA Monitor is a local-first browser QA and monitoring extension. It does **not** collect, transmit, sell or share browsing data, page contents, QA logs or screenshots.

There is no telemetry, analytics, advertising, user account, cloud sync or remote code. Monitoring data stays in your browser profile until you delete it.

---

## 2. What is stored locally

| Data | Where | Purpose |
|---|---|---|
| Settings | `chrome.storage.local` | Bypass cache, badge visibility, default mode, stabilization, history limit, notification/screenshot defaults |
| Active runtime | `chrome.storage.session` | Session id, tab id, mode, phase, next action, dedupe/throttle state; survives service-worker suspension, cleared by browser restart |
| Session metadata | `chrome.storage.local` | Session id, tab id, mode, start/end times, stop reason, tested URL, expected URL, configuration |
| QA events | `chrome.storage.local` | Timestamps, check type, PASS/FAIL/WARN/UNKNOWN, URL, expected/actual short values, HTTP status when exposed, load duration, reasons, bounded technical details |
| Text/DOM results | `chrome.storage.local` | Whether text/element was found, lengths, short result values; **not full page text** |
| Presets | `chrome.storage.local` | User names, descriptions and check configuration |
| Floating-panel preferences | `chrome.storage.local` | Per-origin panel position and collapsed state |
| Screenshots | IndexedDB | Opt-in images of the visible viewport of the active/focused tab |

Full page text is read in the page to evaluate checks but is not written to event history. User-entered patterns, selectors and expected text are stored as configuration.

URLs can contain query parameters or tokens. Exported reports and screenshots can be sensitive; store and share them deliberately.

---

## 3. What the extension does not do

- No network requests to Odesoftami or third parties.
- No analytics, tracking, telemetry, advertising identifiers or fingerprinting.
- No collection of passwords, authentication tokens, cookies or form values.
- No upload of screenshots, page text, browsing history or QA reports.
- No remote executable code; all logic ships in the extension package.
- No inspection of Chrome internal pages, other extensions, cross-origin iframe content or closed shadow DOM.
- No bypassing of Chrome access controls or security boundaries.
- No sale or sharing of user data.
- No use of data for creditworthiness, lending, advertising or profiling.

---

## 4. Permissions

| Permission | Why |
|---|---|
| `storage` | Save settings, sessions, events, presets; active runtime in `chrome.storage.session` |
| `activeTab` | Identify the tab you explicitly monitor; support opt-in screenshots after user invocation |
| `scripting` | Inject the packaged monitor into an already-open tab at session start |
| `notifications` | Local alerts for configured conditions/failures |
| `alarms` | Service-worker-safe fallback timer/watchdog |
| `webRequest` | **Observe-only** main-frame HTTP/HTTPS access to read final status, redirect target and network error; requests are never blocked or changed; `webRequestBlocking` is not used |
| `http://*/*`, `https://*/*` host access | Run the monitor on pages you choose and receive main-frame navigation details for them |

No `tabs`, `downloads`, `unlimitedStorage`, `webRequestBlocking`, `webNavigation` or `<all_urls>` permission is requested. The floating QA panel uses the same content script and permissions; no new permission was added in v3.2.0. See `PERMISSIONS.md` for the full justification.

`webRequest` callbacks are filtered to `main_frame` HTTP/HTTPS navigations. The engine ignores them unless the tab has an active monitoring session; collection stops when the session stops.

---

## 5. Screenshots

- Disabled by default; explicit opt-in per session or as a Settings default.
- Chrome only allows `captureVisibleTab` for an active/focused tab with `activeTab` or `<all_urls>`. The extension intentionally does not request `<all_urls>`.
- If capture is refused, the extension records a `screenshot_skipped` WARN with Chrome’s reason; it never captures silently.
- Screenshots are stored locally (IndexedDB), capped at 20 entries / 40 MB, never uploaded, and can be cleared by session or all at once.
- Reports do not embed screenshots.

---

## 6. Data retention and deletion

- Event history is bounded: 50–2,000 events per session (default 500), up to 30 sessions.
- Oldest completed sessions/events are pruned automatically when limits are reached.
- Screenshots are capped and pruned oldest-first.
- Settings → **Clear completed session history** deletes only completed sessions and their events; active sessions, presets, settings and **stored screenshots are preserved**. Screenshots are removed only by the separate **Clear stored screenshots** action or individual deletion.
- Settings → **Clear stored screenshots** deletes all local screenshots.
- Dashboard → delete an individual session (its own events and screenshots are removed).
- Removing the extension removes extension storage and IndexedDB according to Chrome’s behavior.

---

## 7. Chrome Web Store data disclosure

The Chrome Web Store requires publishers to disclose data collection. For this extension:

- **Does it collect or use user data?** No. Data is processed and stored locally on the user’s device to provide the monitoring, history, preset and report features.
- **Is data sold or shared?** No.
- **Is data used for advertising, creditworthiness or lending?** No.
- **Does it use remote code?** No.
- **Does it collect authentication information, cookies or browsing history?** No. URLs of pages the user chooses to monitor are stored locally as part of the QA session record.
- **Are screenshots uploaded?** No. They are opt-in local files.

A public privacy policy URL must be supplied in the Chrome Web Store listing. Host this document (or an equivalent page) on the publisher’s site. The optional GitHub and Web footer links are normal external hyperlinks; the extension does not send data when rendering them and makes no request unless the user clicks one.

---

## 8. Security

- MV3, no remote scripts, no `eval`/`new Function`, no inline scripts.
- Reports escape HTML; CSV neutralizes formula injection; imported presets are strictly validated and never executed.
- Dynamic page values are inserted into the UI with `textContent`.
- Data is not encrypted at rest beyond the browser profile’s normal protections; treat local reports/screenshots as sensitive.

---

## 9. Changes

Material changes will be reflected in a new extension version and in this policy. Continued use after an update constitutes acceptance of the updated policy where permitted by law.

---

## 10. Contact

Publisher: **Denys Oleksiienko** (Odesoftami)
Website: <https://odesoftami.com/apk/>
Privacy questions: use the contact details published on the Odesoftami website.

This document is provided for transparency and Chrome Web Store compliance. It is not legal advice; the publisher is responsible for ensuring it meets applicable law and store requirements.
