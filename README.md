# Yukari Rubi

A browser extension that overlays furigana (ruby reading aids) on Japanese text in any web page, powered by [Sudachi](https://github.com/f3liz-dev/sudachi.rs) morphological analysis compiled to WebAssembly.

Supported on Firefox 115+ and Chromium 116+.

## Features

- **Per-page toggle** — enable/disable from the toolbar popup or via a configurable keyboard shortcut (default `Alt+F`).
- **Sudachi-powered tokenization** — runs entirely in the browser; no network requests, no telemetry.
- **Live updating** — optional `MutationObserver` mode adds furigana to dynamically loaded content.
- **Auto-enable site patterns** — glob-style patterns (`*` for any string, `**` for entire path) to switch furigana on automatically for chosen sites.
- **User dictionary** — override readings for proper nouns, gikun (e.g. 超電磁砲 → レールガン), or technical terms. Any characters allowed in the reading.
- **Adjustable ruby size** — tune the overlay to taste.
- **Scrapbox support** (beta) — handles per-character `<span>` rendering used inside the Scrapbox editor.
- **Localized UI** — English, Japanese, Korean.

## Install

Pre-built artifacts land in `artifacts/` after `npm run package` / `npm run package:chrome`. From-source builds work as below.

## Development

```sh
npm install
npm run fetch-dict   # one-time: downloads system_core.xdic
npm run dev          # build + launch Firefox with the extension loaded
npm run dev:chrome   # same, but Chromium
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Build the Firefox bundle into `dist/` |
| `npm run build:chrome` | Build the Chrome bundle into `dist-chrome/` |
| `npm run package` | `fetch-dict` + build + `web-ext build` → signed-ready `.zip` in `artifacts/` |
| `npm run package:chrome` | Same, for Chrome |
| `npm run lint` | `oxlint` |
| `npm run fmt` | `oxfmt --write src/` |

## Project layout

```
src/
  background.ts   # Sudachi worker host + cross-context RPC
  content.ts      # DOM walker, ruby injection, Scrapbox shim
  popup.ts        # Toolbar popup UI
  options.ts      # Settings page (shortcut, user dict, auto-enable list)
  lib/furigana.ts # Kana alignment between surface form and reading
  rpc.ts, types.ts
static/
  manifest.json         # Firefox (MV2)
  manifest.chrome.json  # Chrome (MV3)
  _locales/             # en, ja, ko
  icons/, *.html, content.css
scripts/
  build.mjs       # esbuild driver, copies manifest + WASM + dictionary
  fetch-dict.mjs  # downloads the Sudachi system dictionary
dict/system_core.xdic  # populated by fetch-dict
```

## Upstream / dependencies

The pieces this extension is built on:

- **[f3liz-dev/sudachi.rs](https://github.com/f3liz-dev/sudachi.rs)** — Rust port of [WorksApplications/Sudachi](https://github.com/WorksApplications/Sudachi), the Japanese morphological analyzer. Published as the `@f3liz/sudachi-wasm` npm package (the WASM build) and as the `system_core.xdic` release asset that `npm run fetch-dict` pulls down.
- **[antfu/birpc](https://github.com/antfu/birpc)** — typed bidirectional RPC, used to bridge the content script ↔ background page.
- **[mozilla/webextension-polyfill](https://github.com/mozilla/webextension-polyfill)** — browser API shim so the same source builds for Firefox (MV2) and Chrome (MV3).
- **[evanw/esbuild](https://github.com/evanw/esbuild)** — bundler for the four entry points (content / background / popup / options).
- **[mozilla/web-ext](https://github.com/mozilla/web-ext)** — `web-ext run` for live-reload dev, `web-ext build` for packaging.
- **[oxc-project/oxc](https://github.com/oxc-project/oxc)** — `oxlint` + `oxfmt` for linting and formatting.

The original Sudachi project ([WorksApplications/Sudachi](https://github.com/WorksApplications/Sudachi)) and its dictionary ([WorksApplications/SudachiDict](https://github.com/WorksApplications/SudachiDict)) sit upstream of `sudachi.rs`.

Algorithmic reference:

- **[kampersanda/xcdat](https://github.com/kampersanda/xcdat)** — compressed double-array trie. Referenced for the dictionary lookup data structure used inside `sudachi.rs` (the `.xdic` format).

## Permissions

`storage` (settings + user dictionary) and `tabs` (apply state per active tab). No host permissions beyond the content script's `<all_urls>` match — required to inject ruby on whichever page you choose to enable it on.

## License

Apache-2.0 — see [LICENSE](LICENSE).
