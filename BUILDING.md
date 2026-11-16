# Building from source

This document describes how to reproduce the release artifacts from source. It is intended for repository reviewers (notably the Mozilla AMO / Firefox Add-ons reviewers) who need to verify that the published extension can be rebuilt from the published sources. The project is a WXT + Vue 3 + TypeScript browser extension; there are no private build steps, no remote keys, and no network calls at build time except dependency installation.

## Prerequisites

- **Node.js 22.12+** (WXT 0.21 requires Node >= 22; Vite 8 requires >= 22.12). The CI workflow uses Node 22.
- **npm** (ships with Node). `package-lock.json` is committed, so `npm ci` reproduces the exact dependency tree.

## Reproduce a release build

```bash
git clone https://github.com/lucky845/new-tab-vue3-chrome-extension.git
cd new-tab-vue3-chrome-extension
npm ci                 # installs exact locked deps; runs `wxt prepare` via postinstall
npm run compile        # vue-tsc --noEmit type check
npm run lint           # eslint src && vue-tsc --noEmit
npm test               # vitest run — 44 unit tests
npm run build          # Chrome MV3 build -> .output/chrome-mv3
npm run build:firefox  # Firefox MV2 build -> .output/firefox-mv2
```

All four verification commands (compile / lint / test / build) are deterministic and must exit 0. The unit tests mock `chrome.storage` and do not require a browser.

## Artifacts

- `.output/chrome-mv3/` — unpacked Chrome/Edge MV3 extension. Load it via `chrome://extensions` -> Developer mode -> "Load unpacked".
- `.output/firefox-mv2/` — unpacked Firefox MV2 extension. The release workflow additionally produces a sources ZIP for AMO review.

To produce distributable ZIPs locally, use `npm run zip` (current target) or `npx wxt zip -b firefox --mv2` (Firefox). The tag-triggered GitHub Actions workflow (`.github/workflows/release.yml`) runs the same commands and publishes the ZIPs plus a `SHA256SUMS.txt` on the GitHub Release page, so the checksums can be compared against a local rebuild.

## Notes for reviewers

- The only classic (non-module) script shipped is `public/theme-preboot.js`, a tiny synchronous theme bootstrap. It is required because the extension CSP forbids inline scripts and an ES module cannot set the theme before first paint. It is not application logic.
- Wallpaper images and personal data are stored locally in `chrome.storage.local`; there is no backend and no embedded API key. Weather uses Open-Meteo (no key) by default; an optional Amap key, if supplied by the user at runtime, is kept only in local storage and is never baked into the build.
- Full data-handling details are in `doc/PRIVACY.md`.
