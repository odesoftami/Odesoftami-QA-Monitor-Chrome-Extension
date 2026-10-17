# Delivery — Odesoftami QA Monitor v3.2.0

## Product

- **Name:** Odesoftami QA Monitor
- **Short description:** Browser QA & Monitoring Tool
- **Version:** 3.2.0 (Manifest V3)
- **Author:** Denys Oleksiienko
- **Source:** `project root`
- **Window type:** detached Chrome extension popup window (`chrome.windows.create`, type `popup`), not Electron and not an anchored action popup

## Artifacts

| Artifact | Path / value |
|---|---|
| **v3.2.0 installable ZIP** | [`dist/odesoftami-qa-monitor-v3.2.0.zip`](dist/odesoftami-qa-monitor-v3.2.0.zip) |
| **v3.2.0 size** | **134,572 bytes** |
| **v3.2.0 SHA-256** | **`f634b8408f6f81fc6c6e69bd39c67ce40afa9ca29ce3b768cec4410037f8e54c`** |
| v3.2.0 checksum file | [`dist/SHA256SUMS-v3.2.0.txt`](dist/SHA256SUMS-v3.2.0.txt) |
| **v3.1.0 ZIP (preserved)** | [`dist/odesoftami-qa-monitor-v3.1.0.zip`](dist/odesoftami-qa-monitor-v3.1.0.zip) |
| v3.1.0 SHA-256 | `2fc2f291f8f8fafeafdc34bc403115c6e78ba1c6c140b7a8ad79ec52afa1512e` |
| **v3.0.0 ZIP (preserved)** | [`dist/odesoftami-auto-refresh-v3.0.0.zip`](dist/odesoftami-auto-refresh-v3.0.0.zip) |
| v3.0.0 SHA-256 | `c14cf13b6a212f3bf62f37395fca28113d892a2e8f131b145e3eeeb616c5cb8d` |
| Source snapshot v3.0.0 | [`_baseline/v3.0.0/`](_baseline/v3.0.0/) |
| Original v2.3.0 | [`_baseline/v2.3.0/`](_baseline/v2.3.0/) |
| Install/usage | [`README.md`](README.md) |
| Changelog | [`CHANGELOG.md`](CHANGELOG.md) |
| Test report | [`TEST-REPORT.md`](TEST-REPORT.md) |
| Permissions | [`PERMISSIONS.md`](PERMISSIONS.md) |
| Architecture | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Known limitations | [`KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md) |
| Changed files | [`CHANGED-FILES.md`](CHANGED-FILES.md) |
| Privacy | [`PRIVACY.md`](PRIVACY.md) / [`privacy.html`](privacy.html) |
| Publishing checklist | [`PUBLISHING.md`](PUBLISHING.md) |
| Listing screenshots | [`store/`](store/) |

`manifest.json` is at the ZIP root. Tests, store assets, baselines, all `dist/` archives and test docs are excluded.

## Install

1. Extract `dist/odesoftami-qa-monitor-v3.2.0.zip`.
2. Open `chrome://extensions` → Developer mode → **Load unpacked** → select the folder containing `manifest.json`.
3. Requires Chrome 120+.

The v3.1.0 and v3.0.0 ZIPs remain separately extractable; they were not modified.

## Automated verification actually executed

- **Unit:** **55 / 55 PASS** (`node --test tests/unit/*.test.js`).
- **Real Chromium E2E:** **28 / 28 PASS** (`node tests/e2e/run.js`), Chromium 153 headless, real unpacked extension.
- **Minimum window size:** E2E used CDP `Browser.setWindowBounds` to shrink the popup to **320×400**; the app restored it to **≥420×560**. At minimum, tabs, Start/Stop, status and footer remained visible; no horizontal overflow.
- **Enlargement:** 640×720 tested; no overflow, tabs/footer/status remain visible.
- **Status:** Not monitoring, Refreshing, Monitoring, QA Session running and Paused tested; status remains fixed while the middle scrolls and is not duplicated.
- **Refresh:** legacy Text condition card hidden; Presets and Last session remain; refresh start/stop and settings tested.
- **QA:** optional-refresh note/toggle; QA with autoRefresh=false records checks without reload; QA with reload tested.
- **Check states:** Text/DOM/URL ON/OFF and Session options DEFAULTS tested, including collapsed details.
- **Last session:** shared across Refresh/Monitor/QA, with type chip; Clear history beside Export CSV; no reset on tab switch.
- **Footer:** `© 2026 Denys Oleksiienko · v3.2.0 · GitHub ↗ · Web ↗`; dynamic version, 10 px, grey, one line; GitHub/Web links.
- **Floating panel regression:** counters/collapse/drag/hide/stop/final/disabled/SPA/Refresh exclusion retained.
- **ZIP:** `unzip -t` clean; extracted ZIP loaded in Chromium; manifest/settings/presets/popup smoke verified; no page exceptions.

## Manual tests executed

**None beyond the automated Chromium runs.** No separate human-driven session was performed.

### Manual checks still required

1. **Toolbar `onClicked` dispatch in a real Chrome window.** E2E creates the same window through `chrome.windows.create`; headless has no toolbar. Click the toolbar icon and verify the detached window opens/reuses.
2. **Successful screenshot-on-failure capture.** Only refusal/skip is automated; programmatic window opening does not grant `activeTab`.
3. **Floating panel initialization-failure injection.** try/catch reviewed, not injected.
4. **OS-specific physical window resize/drag feel.** Min-size enforcement was verified via CDP; the OS window manager's resize behavior can still vary.
5. **Notification click, browser restart, long soak, real quota pressure, branded Chrome 155, accessibility/CSV visual rendering.** Not automated.

## Tests NOT executed / unverified

1. Toolbar `onClicked` actual dispatch (manual only).
2. Successful screenshot-on-failure capture.
3. Panel initialization-failure fault injection.
4. Panel Dashboard button actual click (engine path unit-tested).
5. Notification click → dashboard.
6. Real browser restart (simulated by clearing `chrome.storage.session`).
7. Background-tab throttling / multi-hour soak.
8. Real storage-quota pressure.
9. Very large pages / high-frequency DOM mutation CPU benchmark.
10. Chrome Web Store upload/review/approval.
11. Branded Google Chrome 155 (integration used Chromium 153).
12. Cross-origin iframes / closed shadow DOM.
13. Real physical mouse resize (CDP bounds used).
14. Accessibility screen-reader audit / spreadsheet visual rendering.

## Permissions changes

**No permission changes from v3.1.0/v3.0.0.**

- `storage`, `activeTab`, `scripting`, `notifications`, `alarms`, `webRequest`.
- Hosts: `http://*/*`, `https://*/*`.
- No `tabs`, `downloads`, `unlimitedStorage`, `webRequestBlocking`, `webNavigation`, `<all_urls>`.
- Detached window/min-size guard uses the permission-free `chrome.windows.create/get/update/onBoundsChanged`.
- Floating panel remains UI-only, no new permission.

Full rationale: `PERMISSIONS.md`.

## Footer and links

- Footer: `© 2026 Denys Oleksiienko · v3.2.0 · GitHub ↗ · Web ↗`.
- Version is read dynamically from `manifest.json`.
- GitHub: `https://github.com/odesoftami` (owner-supplied profile URL, not asserted as a source repository).
- Web: `https://odesoftami.com/apk`.
- Both are grey external links with `target=_blank`/`rel=noreferrer`; no network request is made while rendering.

## Owner actions still required

1. Host the privacy policy at a public URL for the Chrome Web Store listing.
2. Perform the manual toolbar-click and screenshot-success checks in a real Chrome window.
3. Review/submit the store listing if desired.
4. Do not overwrite the preserved v3.1.0/v3.0.0 ZIPs.

## Known limitations

See [`KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md). Key points:

- HTTP status only for observed main-frame navigations; otherwise UNKNOWN.
- Client-side redirects have no redirect status; URL checks detect destination changes.
- Load timing is navigation/DOMContentLoaded/load, not server TTFB.
- Cross-origin iframes/closed shadow DOM not inspectable.
- Background tabs can be throttled; 30 s alarm minimum.
- Browser restart finalizes sessions; no auto-resume.
- Chrome has no native extension-window min-size; 420×560 is best-effort via `onBoundsChanged`/`update`.
- Toolbar action dispatch and screenshot success are manual checks.
- Chrome Web Store approval is not claimed.

## Prohibited actions

- No GitHub push, commit, tag or release.
- No Chrome Web Store upload or publication.
- No modification of v3.1.0 or v3.0.0 ZIPs.
- No new permissions.
