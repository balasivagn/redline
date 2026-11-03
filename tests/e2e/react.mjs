// Redline e2e for the React call-site / path / Markdown v2 work. Generic: a tiny React 19 app
// served by Vite in dev mode (react-fixture/), with a shared primitive outside the Vite root so
// source URLs look like /@fs/<abs>/packages/ui/src/Text.tsx?t=…, router-less Suspense + provider
// wrappers around the page. Pins the "Login" heading and checks the copied Markdown.
// Usage: npx wxt build && node tests/e2e/react.mjs
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const ext = join(root, '.output/chrome-mv3');
const artifacts = join(here, 'artifacts');
mkdirSync(artifacts, { recursive: true });

const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try { const r = await fn(); results.push(['PASS', name, Date.now() - t]); console.log(`✔ ${name}`); return r; }
  catch (e) { results.push(['FAIL', name, Date.now() - t, e.message]); console.log(`✖ ${name}: ${e.message}`); throw e; }
};

// 1. Vite dev server for the React fixture
const vite = await createServer({ configFile: join(here, 'react-fixture/vite.config.mjs'), server: { port: 0, host: '127.0.0.1', hmr: false } });
await vite.listen();
const base = `http://127.0.0.1:${vite.httpServer.address().port}`;

// 2. browser with the extension (same executable fallback as run.mjs)
const profile = mkdtempSync(join(tmpdir(), 'redline-e2e-react-'));
let executablePath;
if (!existsSync(chromium.executablePath())) {
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  for (const d of readdirSync(cache).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const app = readdirSync(join(cache, d, 'chrome-mac-arm64')).find((n) => n.endsWith('.app'));
    if (app) { executablePath = join(cache, d, 'chrome-mac-arm64', app, 'Contents/MacOS', app.replace(/\.app$/, '')); break; }
  }
}
const context = await chromium.launchPersistentContext(profile, {
  ...(executablePath ? { executablePath } : { channel: 'chromium' }),
  headless: process.env.HEADED ? false : true,
  viewport: { width: 1280, height: 860 },
  permissions: ['clipboard-read', 'clipboard-write'],
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let page;
try {
  const sw = await step('service worker starts', async () =>
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10000 })));
  const logs = [];
  process.on('exit', () => { if (process.env.LOGS) console.log(logs.join('\n')); });

  page = await context.newPage();
  page.on('console', (m) => logs.push('[page] ' + m.text()));
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto(base + '/');
  await page.getByRole('heading', { name: 'Login' }).waitFor({ timeout: 15000 });
  const ui = page.locator('redline-ui');

  await step('toolbar toggle injects the pill', async () => {
    await sw.evaluate(async () => {
      const [t] = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
      await globalThis.__redlineTest.toggleTab(t.id);
    });
    await ui.getByRole('button', { name: /Redline: 0 comments/ }).or(ui.getByRole('toolbar', { name: 'Redline toolbar' })).first().waitFor({ timeout: 5000 });
  });

  const openToolbar = async () => {
    const pill = ui.getByRole('button', { name: /Redline: \d+ comments?/ });
    if (await pill.isVisible().catch(() => false)) await pill.click();
    await ui.getByRole('toolbar', { name: 'Redline toolbar' }).waitFor();
  };

  await step('pin the "Login" heading and save with Enter', async () => {
    await openToolbar();
    await ui.getByRole('button', { name: 'Pin' }).click();
    await page.locator('main > h2').hover(); await page.waitForTimeout(200);
    await page.locator('main > h2').click();
    const box = ui.getByLabel('Comment text');
    await box.waitFor({ timeout: 3000 });
    await box.fill('Make the page title larger.');
    await box.focus();
    await page.keyboard.press('Enter');
    await ui.getByRole('button', { name: 'Comment 1' }).waitFor({ timeout: 5000 });
    await page.screenshot({ path: join(artifacts, 'react-1-pinned.png') });
  });

  let md = '';
  await step('list → Copy as Markdown', async () => {
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    await openToolbar();
    await ui.getByRole('button', { name: /^List/ }).click();
    await ui.getByTestId('review-row').first().waitFor();
    await ui.locator('button[aria-haspopup="menu"]').first().click();
    await ui.getByRole('menuitem', { name: /Markdown/ }).or(ui.getByRole('button', { name: /Copy as Markdown/ })).first().click();
    await page.waitForTimeout(300);
    md = await page.evaluate(() => navigator.clipboard.readText());
    console.log('----- copied markdown -----\n' + md + '---------------------------');
  });

  await step('Markdown v2 content is generic and human', async () => {
    const heading = md.split('\n').find((l) => l.startsWith('## 1.')) ?? '';
    if (!heading.includes('"Login"') || !heading.includes('Text')) throw new Error('heading: ' + heading);
    const line = (key) => md.split('\n').find((l) => l.startsWith(`- ${key}:`)) ?? '';
    const where = line('where');
    if (!where.includes('AuthLayout › Text')) throw new Error('where: ' + where);
    if (/Suspense|ThemeProvider/.test(where)) throw new Error('where has plumbing: ' + where);
    const editAt = line('edit at');
    if (!/src\/layouts\/AuthLayout\.tsx:\d+/.test(editAt) && !/src\/pages\/LoginPage\.tsx:\d+/.test(editAt)) throw new Error('edit at: ' + editAt);
    // Line numbers are source-mapped back to the real file (the fixture's <Text> is on line 7).
    if (!/AuthLayout\.tsx:7\b/.test(editAt)) throw new Error('edit at line is not source-mapped: ' + editAt);
    if (!/renders .*packages\/ui\/src\/Text\.tsx:\d+/.test(editAt)) throw new Error('renders: ' + editAt);
    for (const bad of ['/@fs', 'http://127.0.0.1', '?t=']) {
      // The page line/url legitimately never contain these; the item must not either.
      if (md.includes(bad)) throw new Error('markdown still contains ' + bad);
    }
  });
} catch {
  if (page) await page.screenshot({ path: join(artifacts, 'react-fail.png') }).catch(() => {});
} finally {
  await context.close(); await vite.close();
  console.log('\n' + results.map((r) => `${r[0]}  ${r[1]}${r[3] ? ' — ' + r[3] : ''}`).join('\n'));
  process.exitCode = results.some((r) => r[0] === 'FAIL') ? 1 : 0;
}
