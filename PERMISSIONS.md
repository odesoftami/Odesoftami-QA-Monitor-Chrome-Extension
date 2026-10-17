# Permissions and host access — justification

**Odesoftami QA Monitor 3.2.0** requests the same minimal set of Chrome permissions as v3.0.0/v3.1.0. No new permission was added for the floating QA panel, detached popup, fixed status/footer, minimum-size guard or quick Clear history.

Single purpose: **timed page refresh plus local QA monitoring and reporting for pages the user explicitly starts a session on**.

No permission is used for analytics, advertising, remote services or data sale.

---

## Requested permissions

### `storage`

**Why:** Save local settings, session metadata, bounded QA events, custom presets, floating-panel preferences and the active runtime state.

- `chrome.storage.local`: durable settings/sessions/events/presets plus `qaPanelPrefs` (per-origin panel position/collapsed state).
- `chrome.storage.session`: active runtime state that survives service-worker suspension.
- No data is synced to a Google account or remote server.

### `activeTab`

**Why:** Identify the tab the user explicitly chose and support opt-in screenshots.

- When the user invokes the extension via its toolbar action, Chrome grants temporary host access to that tab.
- The detached popup window receives that tab id and uses it to show the current URL/title and to start/stop the session.
- Opening/moving/enforcing the window uses the permission-free `chrome.windows` API (`create`, `get`, `update`, `onBoundsChanged`); no manifest permission was added.
- `captureVisibleTab` is only attempted after explicit opt-in and only for the active/focused tab. If the grant is unavailable (background tabs, cross-origin redirects, programmatic popup opening in automation), capture is skipped and recorded with the Chrome error. The extension does not request `<all_urls>` just for screenshots.

### `scripting`

**Why:** Inject `refresh-content.js` into an already-open tab when a session starts.

- The content scripts are declared for HTTP/HTTPS pages, but a tab opened before installation/reload may not have them.
- Only packaged files (`refresh-content.js`, and the declared `panel-content.js`) are used; no code strings, no remote code.

### `notifications`

**Why:** Show local desktop notifications when a configured text condition matches or a check fails, if the user enabled notifications.

- Notifications are local OS notifications.
- Clicking one opens the local dashboard.
- No notification content is sent to a server.

### `alarms`

**Why:** Keep refresh sessions functioning when the MV3 service worker is suspended or background tab timers are throttled.

- A single watchdog alarm (30-second minimum period) checks overdue sessions, updates badges and prevents stalls.
- Exact timing is provided by the in-page timer; the alarm is a fallback.
- The alarm is removed when no reloading session remains.
- No user data is stored in alarms beyond the fixed alarm name.

### `webRequest`

**Why:** Read the final HTTP status code, redirect target and network error for main-frame navigations. Chrome’s `webNavigation` API did not expose a status code in Chromium 153, so observe-only `webRequest` is the least-privileged supported API for this requirement.

**Scope and safeguards:**

- **Observe-only.** `webRequestBlocking` is not requested and no request is blocked, modified, paused or redirected.
- Registered with an explicit filter:
  ```js
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] }
  ```
- Only `onBeforeRequest`, `onBeforeRedirect`, `onCompleted` and `onErrorOccurred` are used.
- No headers (`extraHeaders`), cookies, request bodies or response bodies are read.
- The engine resolves the active session by `tabId`; requests for tabs without a session are ignored. Collection stops when the session stops (integration-tested).
- If Chrome does not expose a status, the event is **UNKNOWN**, never fabricated.

### Host permissions: `http://*/*`, `https://*/*`

**Why:** The extension must monitor arbitrary HTTP/HTTPS pages the user chooses, including after reloads and navigation.

- Required to run the declared top-frame content scripts and to receive `webRequest` details for the monitored tab.
- The content scripts are dormant on pages without an active session: no observer, timer, panel or messages until the service worker sends a session state.
- The extension does not inject into `chrome://` pages, the Chrome Web Store, other extensions or `file://` URLs; starting a session there is rejected.
- Broad host access preserves v2.3.0/v3.0.0/v3.1.0 “works on the page you choose” behavior. A per-origin optional-permission flow would require a redesign and an explicit grant for every site; it was not introduced in 3.2.0.

---

## Permissions deliberately not requested

| Permission | Why not |
|---|---|
| `tabs` | Tab id and HTTP/HTTPS URL/title are available through host permissions/activeTab; no broader `tabs` access is needed. |
| `webRequestBlocking` | No request blocking/modification is performed. |
| `webNavigation` | Not needed after status/redirect/error handling moved to observe-only `webRequest`. |
| `downloads` | Reports are downloaded with a Blob + anchor from an extension page. |
| `unlimitedStorage` | History is bounded and quota failures are handled. |
| `debugger` | Not used. |
| `<all_urls>` | HTTP/HTTPS coverage is sufficient; screenshot failures are surfaced instead of requesting file/FTP/all-scheme access. |
| `management`, `cookies`, `identity`, `history`, `bookmarks`, `topSites` | Not used. |

The manifest contains no `externally_connectable`, no remote script hosts, no CSP relaxation, no `eval` and no remote code.

---

## Floating QA panel

No permission was added for the panel or the detached popup window.

- `panel-content.js` is a declared content script in the same isolated world as the existing monitor.
- It creates a Shadow-DOM host on the top-level page and asks the existing service worker for `GET_PANEL_DATA`.
- It does not create a session, collect events, register `webRequest`/observer listeners or open network connections.
- Panel position/collapse state is stored in the existing `storage` permission under `qaPanelPrefs`.
- Panel Stop uses an explicit content-script message handled by the existing session engine; Dashboard opens a local extension page through the service worker.
- Panel disable/failure does not affect monitoring.

---

## Clear history and screenshots

- `CLEAR_HISTORY` removes only completed sessions and their events.
- Active sessions, presets, settings and **stored screenshots** are preserved.
- Screenshots are removed only by the separate “Clear stored screenshots” action, individual screenshot deletion, or automatic retention pruning.
- Deleting an individual session still removes that session’s events and screenshots.

---

## Data handling

- Settings, sessions, events, presets, panel preferences and screenshots are local.
- Full page text is never stored; check events keep results, short values/lengths and bounded details.
- Screenshots are opt-in, local IndexedDB, capped (20 / 40 MB), and never uploaded.
- No telemetry, analytics, advertising identifiers, accounts, cookies, credentials or browsing-history upload.
- Reports are generated locally and downloaded by the user.
- The optional GitHub and Web footer links are normal external hyperlinks; no data is sent by the extension when rendering the footer, and no request is made unless the user clicks one.

---

## Chrome Web Store review notes (short form)

- **Single purpose:** timed page refresh plus local QA monitoring/reporting for pages the user starts a session on.
- **Remote code:** none. All JavaScript is packaged.
- **`webRequest`:** observe-only, main-frame HTTP/HTTPS only; used solely for final status, redirect target and network error. `webRequestBlocking` is not used.
- **Host access:** needed to run the monitor on user-chosen pages and read their main-frame navigation results.
- **Detached window:** `chrome.windows.create/get/update/onBoundsChanged` is used for the floating popup and minimum-size guard; this API requires no manifest permission.
- **Screenshots:** opt-in, active/focused tab only, local storage, explicit skip logging, never uploaded.
- **Floating panel:** UI-only, no additional permissions or data collection.
- **Privacy policy:** bundled as `privacy.html` / `PRIVACY.md`; a public URL must be provided in the store listing.

Full privacy details: `PRIVACY.md`.
Permission test evidence: `tests/unit/manifest.test.js` asserts the exact permission set, absence of `webRequestBlocking`, and no remote-code patterns.
