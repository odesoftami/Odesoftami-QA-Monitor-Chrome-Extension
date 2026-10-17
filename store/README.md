# Store assets — Odesoftami QA Monitor v3.2.0

These files are **optional Chrome Web Store listing assets**, not part of the extension runtime and not included in the release ZIP.

They were generated from the real extension running in Chromium 153 with local HTTP fixtures. No fake counters or hardcoded sample data were used.

| File | Size | Contents |
|---|---|---|
| `dashboard-1280x800.png` / `screenshot-1-dashboard-1280x800.png` | 1280×800 | Real dashboard overview with a completed monitoring session, HTTP 200, network-error FAIL and UNKNOWN status; new Odesoftami QA Monitor branding |
| `floating-panel.png` | 1280×813 | Real floating QA panel over a monitored page |
| `floating-panel-1280x800.png` / `screenshot-2-floating-panel-1280x800.png` | 1280×800 | Store-size crop of the floating-panel screenshot |
| `popup-400.png` | 400×600 | Real detached popup window: fixed header + mode tabs, scrolling middle, Settings/Close controls, fixed Start/Stop + status + footer |
| `popup-active.png` | 400×600 | Real detached popup window with an active Monitor session and fixed Monitoring status |
| `popup-640x400.png` | 640×400 | Store-size composition built from the real detached-window screenshot; highlights simple Refresh, optional QA refresh, fixed status and minimum size |
| `popup-summary.png` | 400×600 | Detached popup scrolled to Last session, showing the MONITOR type chip, Clear history right of Export CSV, and fixed status/footer |
| `popup-qa.png` | 400×600 | QA Session tab showing Optional page refresh, explanation and reload toggle |
| `dashboard-390.png` | 390×844 | Responsive dashboard at a narrow width |
| `options-760.png` | 760×900 | Settings page including floating-panel options |

Chrome Web Store screenshots must be 1280×800 or 640×400. Use `screenshot-1-dashboard-1280x800.png` as the primary screenshot and `screenshot-2-floating-panel-1280x800.png` / `popup-640x400.png` as secondary ones.

Notes:

- The popup footer text is `© 2026 Denys Oleksiienko · v3.2.0 · GitHub ↗ · Web ↗`; GitHub and Web are clickable external links. Version is dynamic from the manifest.
- The dashboard shows actual recorded events; the URL is a local test fixture. The popup screenshot was captured from a detached window created through `chrome.windows.create` (the production toolbar path uses the same API).
- Successful screenshot-on-failure capture is not depicted because it could not be verified headlessly (programmatic popup opening does not grant `activeTab`). See `KNOWN-LIMITATIONS.md`.
- The previous v3.0.0 screenshots are preserved under `_baseline/v3.0.0/store/`.
- Replace or add assets as desired for the final listing. Keep the UI claims consistent with the implementation.
