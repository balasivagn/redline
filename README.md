# Redline

Review any page — localhost, staging, prod — by pinning comments to elements or areas, typed or
**dictated with a local speech model**, then copy everything as agent-ready Markdown or JSON with
the DOM context a coding agent needs (selector, text, component, source file:line, styles,
optional screenshot).

## Install (dev)

```bash
bun install
bun run build            # → .output/chrome-mv3
./install-helper         # once: builds + registers the local voice helper (native messaging)
```

Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `redline-extension` (a visible
link to `.output/chrome-mv3`, since dot-folders are hidden in the file picker).
The extension ID is fixed (`oodbmobigjfjcjmjmbaihhpljakkmmgh`) via `.keys/`, which is what the
helper's host manifest allows. Load **`.output/chrome-mv3`** (production build). `.output/chrome-mv3-dev` only works while
`bun run dev` is running (it live-reloads over `ws://localhost:3917`); loaded on its own it goes stale
and logs WebSocket errors.

Then open Redline **Settings → Voice** once and click **Grant mic access** (the offscreen recorder
can't show a permission prompt itself).

## Use

| Action | Default |
|---|---|
| Turn Redline on/off for this site | toolbar icon or `⌘⇧.` (change at `chrome://extensions/shortcuts`) |
| Pin mode / Area mode | `P` / `A` |
| Screenshot with each comment on/off | `S` |
| Open list | `L` |
| Dictate (in the comment box) | `⌥ Space` |
| Save / cancel | `⌘↵` / `Esc` |

In-page shortcuts are configurable under **Settings → Shortcuts**. Comments persist per page
(origin + path) in `chrome.storage.local`; screenshots in IndexedDB. **All reviews** lists every
page. **Copy ▾** exports Selected / This page / All pages as Markdown or JSON, or downloads a
`.zip` with `review.md`, `annotations.json` and `shots/`.

## Voice

The helper (`helper/`, compiled with bun) is started by Chrome only while you dictate. It finds
`whisper-cli` / `parakeet-cli` (Homebrew `whisper-cpp`) and models already on disk (Redline's
`~/.redline/models`, superwhisper, hex, MacWhisper, `~/.cache/whisper`, `ggml-*.bin` under `~/Codes`,
plus `modelDirs` in `~/.redline/config.json`), and can download catalog models with checksum
verification. Fallback engine: Chrome's on-device Web Speech (`processLocally`).
`./install-helper --uninstall` removes the host registration.

## Develop

```bash
npx tsc --noEmit && npx vitest run      # extension unit tests
(cd helper && bun test)                 # helper tests (incl. a real whisper smoke test)
npx wxt build && node tests/e2e/run.mjs # end-to-end in Playwright Chromium with a fake mic
```

Docs: [architecture](docs/ARCHITECTURE.md) · [wireframes](docs/WIREFRAMES.md) · [AGENTS.md](AGENTS.md).
