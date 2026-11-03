# Redline — architecture (agreed 2026-11-03)

Chrome MV3 extension for reviewing any page (localhost, staging, prod): pin or area
comments, typed or dictated with a local speech model, saved per page across sessions,
edited/deleted/selected, copied as agent-ready Markdown or JSON with DOM context.

## Surfaces
- **Content overlay** (`src/entrypoints/content`, `src/ui/overlay`): React inside a Shadow DOM
  (WXT `createShadowRootUi`). Collapsed pill → toolbar (Pin / Area / 📷 / List / ⚙ / ✕) →
  drawer list. Pin + area modes intercept pointer events in the capture phase so the page
  never receives them. Pins are re-anchored on load, scroll, resize, DOM mutation and SPA
  route changes.
- **MAIN-world probe** (`src/entrypoints/probe.content.ts`): reads React/Vue/Svelte/Angular
  component + source info that the isolated content script cannot see. DOM CustomEvent bridge.
- **Service worker** (`src/entrypoints/background.ts`, `src/background`): the only writer of
  storage; injects content scripts at runtime (dormant until turned on for an origin with the
  toolbar icon / `toggle-redline` command, which adds the origin to `enabledOrigins`; ✕ removes it;
  pages with comments on non-enabled origins only show the count on the toolbar badge); screenshots via captureVisibleTab; speech router;
  native messaging client.
- **Offscreen document** (`src/entrypoints/offscreen`): mic recording → 16 kHz mono WAV,
  Chrome on-device Web Speech fallback, screenshot cropping (OffscreenCanvas).
- **Extension pages**: `options` (Settings: General, Shortcuts, Voice incl. W11/W12 setup and
  mic permission grant) and `reviews` (All pages, W10).
- **Local voice helper** (`helper/`, bun → single binary, native messaging host
  `com.redline.helper`): detects whisper.cpp / parakeet binaries and models on disk, downloads
  catalog models to `~/.redline/models` with checksum check, transcribes WAV. Chrome starts it
  on demand; nothing runs at login.

## Contracts (do not change without the integrator)
- `src/core/schema.ts` — `redline/v1` annotation schema, export document.
- `src/core/messages.ts` + `src/core/rpc.ts` — every content/page ↔ background call.
- `src/core/settings.ts` — settings + shortcut matching (all shortcuts user-configurable;
  the global toggle is Chrome's `toggle-redline` command, changed at chrome://extensions/shortcuts).
- `src/speech/types.ts` — speech states/errors/engine interface.
- `helper/protocol.ts` — native messaging protocol.
- Module signatures in `src/core/{page-key,anchor,capture,storage,export}`, `src/ui/list/ReviewList.tsx`.

## Storage
- `chrome.storage.local` (+unlimitedStorage): `settings`, `page:<pageKey>` → PageRecord.
- IndexedDB `redline/shots`: PNG blobs keyed by shotId (service worker side).

## Page key
origin + pathname (trailing slash trimmed); query/hash ignored except hash routes (`#/…`, `#!/…`).

## Export format
Markdown (default copy) — grouped by page, ordered by number. Generic rules, any stack:
component chain without library frames (node_modules / framework internals), "edit at" = call
site of the nearest app component (React `_debugSource` / `_debugStack`, mapped through inline
source maps), dev-server prefixes stripped (`/@fs`, `webpack-internal:///`, `(app-pages-browser)`…)
and paths shortened at `packages/|apps/|libs/|src/`. Raw locations stay in JSON.
```md
# Redline review — localhost:5173/login
Page: "Login" · 1512×862 @1x · 2026-11-03 11:04

## 1. "Login" heading: <Text> in AuthLayout
Make the page title larger.

- where: LoginPage › AuthLayout › Text
- edit at: src/layouts/AuthLayout.tsx:7  (renders packages/ui/src/Text.tsx:5)
- element: h2 · `h2.font-display.font-semibold.leading-tight`
- style: Syne 36/45 · 600 · #000000 · 400×45
- screenshot: /Users/<you>/.redline/shots/localhost-5173/login/<ts>-<shotId>.png
```
HTML is included only when short (≤400 chars) or with `detail: 'detailed'`.
JSON — `ExportDocument` (`redline/export/v1`) with full annotations.
Screenshots — cropped with 60 px context + red outline, saved by the local helper to
`~/.redline/shots/<host>/<page>/` (path in the export), shown as thumbnails, "Copy image" per comment.
Without the helper: thumbnails + Copy image still work; "Export .zip (for sharing)" bundles
`review.md`, `annotations.json`, `shots/`.

## Backlog (not v1)
Project grouping across origins/envs · MCP server for agents · type/status fields ·
in-browser speech model · sync/sharing.
