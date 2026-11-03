# Working on Redline

- Read `docs/ARCHITECTURE.md` and `docs/WIREFRAMES.md` first.
- Stack: WXT 0.21 (MV3) + React 19 + TypeScript (strict, noUncheckedIndexedAccess) + Tailwind v4
  (px-based theme in `src/ui/shared/styles.css`; use `rl-*` color tokens). bun for installs.
- Contracts listed in ARCHITECTURE.md are owned by the integrator. If you need a change, do the
  minimal additive change and call it out in your final report.
- Stay inside the files your task owns. Do not edit another task's folder.
- Checks before you finish: `npx tsc --noEmit`, `npx vitest run`, `npx wxt build` — all green.
- Tests: vitest + happy-dom (`src/**/*.test.ts(x)`), `fake-indexeddb` is auto-loaded,
  `wxt/testing/fake-browser` provides a fake `browser`/`chrome` storage. Helper tests use `bun test`.
- No commits; the integrator commits.
