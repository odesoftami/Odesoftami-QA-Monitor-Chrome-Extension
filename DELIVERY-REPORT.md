# Delivery Report — Odesoftami QA Monitor v3.2.0

Date: **2026-10-17**
Version: **3.2.0**
Source project: `project root`

This report describes the full-project handoff bundle for a **private GitHub repository**. It is not a Chrome Web Store publication and does not claim one.

---

## 1. Full-project bundle

| Item | Value |
|---|---|
| Full bundle | `dist/odesoftami-qa-monitor-v3.2.0-full.zip` |
| Root folder inside ZIP | `odesoftami-qa-monitor-v3.2.0/` |
| SHA-256 | recorded in `dist/SHA256SUMS-v3.2.0-full.txt` (outside the bundle) |
| Extension build included | `dist/odesoftami-qa-monitor-v3.2.0.zip` |
| Existing v3.2.0 ZIP SHA-256 | `f634b8408f6f81fc6c6e69bd39c67ce40afa9ca29ce3b768cec4410037f8e54c` |
| Existing v3.2.0 ZIP size | 134,572 bytes |

The full bundle is intentionally larger than the extension ZIP: it contains source, tests, documentation, release artifacts, screenshots, and preserved previous versions.

---

## 2. Project contents included

```text
odesoftami-qa-monitor-v3.2.0/
├── manifest.json
├── service-worker.js
├── refresh-content.js
├── panel-content.js
├── popup.html / popup.css / popup.js
├── dashboard.html / dashboard.css / dashboard.js
├── options.html / options.css / options.js
├── privacy.html
├── icons/
├── lib/
│   ├── core.js
│   ├── engine.js
│   └── screenshots.js
├── tests/
│   ├── unit/
│   │   ├── core.test.js
│   │   ├── engine.test.js
│   │   ├── manifest.test.js
│   │   └── mock-chrome.js
│   └── e2e/
│       ├── cdp.js
│       ├── run.js
│       ├── server.js
│       └── results.json
├── README.md
├── ARCHITECTURE.md
├── CHANGELOG.md
├── CHANGED-FILES.md
├── DELIVERY.md
├── DELIVERY-REPORT.md
├── KNOWN-LIMITATIONS.md
├── PERMISSIONS.md
├── PRIVACY.md
├── PUBLISHING.md
├── TEST-REPORT.md
├── .gitignore
├── package.json
├── store/
├── dist/
└── _baseline/
    ├── v2.3.0/
    └── v3.0.0/
```

### Included release artifacts (`dist/`)

- `odesoftami-qa-monitor-v3.2.0.zip`
- `odesoftami-qa-monitor-v3.1.0.zip`
- `odesoftami-auto-refresh-v3.0.0.zip`
- `SHA256SUMS-v3.2.0.txt`
- `SHA256SUMS-v3.1.0.txt`
- `SHA256SUMS.txt` (v3.0.0)

The v3.2.0, v3.1.0 and v3.0.0 ZIPs were **not modified**.

### Preserved previous versions

- `_baseline/v2.3.0/` — original source snapshot.
- `_baseline/v3.0.0/` — v3.0.0 source snapshot and screenshots.
- `dist/odesoftami-qa-monitor-v3.1.0.zip` — preserved v3.1.0 package.
- `dist/odesoftami-auto-refresh-v3.0.0.zip` — preserved v3.0.0 package.

---

## 3. Tests actually executed

Commands were run from the source project.

### Syntax

```bash
npm run check
```

Result: **exit 0**. All listed JavaScript files passed `node --check`:

`service-worker.js`, `refresh-content.js`, `panel-content.js`, `popup.js`, `options.js`, `dashboard.js`, `lib/core.js`, `lib/engine.js`, `lib/screenshots.js`.

### Unit tests

```bash
npm test
```

Equivalent to:

```bash
node --test tests/unit/*.test.js
```

Result:

- Tests: **55**
- Passed: **55**
- Failed: **0**
- Skipped: **0**
- Todo: **0**
- Exit code: **0**

### E2E tests

```bash
npm run test:e2e
```

Equivalent to:

```bash
node tests/e2e/run.js
```

Result:

- E2E steps: **28**
- Passed: **28**
- Failed: **0**
- Not tested: **0**
- Exit code: **0**
- Browser: Chromium **153.0.7983.0**, `--headless=new`
- Machine-readable results: `tests/e2e/results.json`
- Real extension loaded unpacked; actual popup window, HTTP fixtures, dashboard, reports, panel and options exercised.

No test was marked passed without execution. `npm` printed only its standard “new major version” notice; it is not a test failure.

### Existing build smoke

The existing v3.2.0 ZIP was extracted and loaded in Chromium:

- `unzip -t` — **No errors detected**.
- Manifest loaded: **Odesoftami QA Monitor 3.2.0**.
- Permissions: `storage`, `activeTab`, `scripting`, `notifications`, `alarms`, `webRequest`.
- `GET_SETTINGS` and `GET_PRESETS` succeeded; four built-in presets returned.
- No extension-page exceptions.

This smoke test applies to the existing v3.2.0 ZIP. The full-project bundle itself was validated with `unzip -t` and an archive-content audit, not loaded as an extension (it contains `dist/`, tests, baselines and documentation that are not part of the runtime package).

---

## 4. Documentation and link check

The following referenced materials exist in the full bundle:

- `tests/unit/`, `tests/e2e/`, `tests/e2e/results.json`
- `TEST-REPORT.md`
- `PUBLISHING.md`
- `.gitignore`
- `dist/` and all three release ZIPs/checksums
- `_baseline/v2.3.0/`, `_baseline/v3.0.0/`
- `store/` listing screenshots referenced by README/PUBLISHING/TEST-REPORT
- `DELIVERY.md`, `CHANGED-FILES.md`

Documentation was audited against the v3.2.0 implementation. The previous audit corrected:

- Refresh description (HTTP/navigation and load timing are recorded internally; legacy text UI is hidden);
- ARCHITECTURE check/totals and redirect handling;
- AVG LOAD exclusions;
- footer GitHub/Web wording;
- store dashboard screenshot description.

No functional changes were made as part of that audit.

---

## 5. Known limitations and discrepancies

1. **The existing v3.2.0 extension ZIP predates the latest Markdown documentation audit.** Its runtime code is the same v3.2.0 code, but its included README/ARCHITECTURE/PERMISSIONS are older than the root Markdown files. It was **not rebuilt**, to preserve the verified artifact and its SHA-256. The full-project bundle contains the current root documentation.
2. `dist/odesoftami-qa-monitor-v3.1.0/` was an extracted working copy of the old v3.1.0 ZIP, not a release artifact. It is excluded from the full bundle; the v3.1.0 ZIP itself is included.
3. `dist/odesoftami-auto-refresh-v3.0.0 — копия.zip` is a duplicate of the v3.0.0 release. It is excluded from the full bundle; the canonical v3.0.0 ZIP is included.
4. No new Chrome Web Store submission, upload or approval was performed.
5. Toolbar `onClicked` dispatch in a real Chrome window, successful screenshot-on-failure capture, panel initialization-failure injection, notification click, real browser restart/long soak and store review were not performed in this handoff audit. These remain manual/known limitations.
6. No `node_modules` are included; the project uses Node built-ins and has no npm dependency install step.
7. No Git repository, commit, tag or remote push was created.

---

## 6. Exclusions and safety

Excluded from the full bundle:

- `.tmp/` (local browser/test profiles, temporary results)
- `.DS_Store` and other macOS metadata
- `node_modules/`
- local logs and temporary files
- extracted old `dist/odesoftami-qa-monitor-v3.1.0/` working copy
- duplicate `odesoftami-auto-refresh-v3.0.0 — копия.zip`
- the full-project ZIP itself (to avoid recursion)
- `.git/` (none was created)

No API tokens, passwords, credentials or personal data files were found or intentionally included. Test fixtures use local `127.0.0.1` URLs.

The `.gitignore` was updated so `node_modules`, `.tmp`, OS/editor files and local secrets are ignored, while release ZIPs and checksums in `dist/` remain trackable. Extracted directories under `dist/` and the full transfer bundle are ignored.

---

## 7. Functional-change confirmation

- `manifest.json` remains **3.2.0**; permissions and Chrome identifiers were not changed.
- Application source code, UI behavior, architecture and dependencies were **not modified** for this handoff.
- Only documentation and `.gitignore` were changed; the full-project bundle adds `DELIVERY-REPORT.md` and packaging files.
- Existing v3.2.0/v3.1.0/v3.0.0 ZIPs were preserved byte-for-byte.

## 8. Verification checklist

- [x] Source extension files present.
- [x] Unit tests present and executed: 55/55.
- [x] E2E tests present and executed: 28/28.
- [x] `TEST-REPORT.md`, `PUBLISHING.md`, `.gitignore` present.
- [x] `dist/` with v3.2.0, v3.1.0 and v3.0.0 builds present.
- [x] `_baseline/v2.3.0` and `_baseline/v3.0.0` present.
- [x] `manifest.json` version 3.2.0.
- [x] v3.2.0 extension ZIP integrity and Chromium smoke checked.
- [x] Full ZIP `unzip -t` and content audit completed.
- [x] No `node_modules`, `.tmp`, `.DS_Store`, secrets or duplicate extracted build included.
- [x] No Git commit/tag/push or publication performed.
