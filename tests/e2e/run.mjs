// Redline end-to-end smoke test in Playwright Chromium with the built extension, a fake
// microphone fed with synthesized speech, and the real native voice helper.
// Usage: npx wxt build && node tests/e2e/run.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const ext = join(root, '.output/chrome-mv3');
const artifacts = join(here, 'artifacts');
mkdirSync(artifacts, { recursive: true });
const PHRASE = 'Make the price bigger than the plan name.';

const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try { const r = await fn(); results.push(['PASS', name, Date.now() - t]); console.log(`✔ ${name}`); return r; }
  catch (e) { results.push(['FAIL', name, Date.now() - t, e.message]); console.log(`✖ ${name}: ${e.message}`); throw e; }
};

// 1. speech fixture
const aiff = join(artifacts, 'speech.aiff'); const wav = join(artifacts, 'speech.wav');
execFileSync('say', ['-o', aiff, PHRASE]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-af', 'apad=pad_dur=3', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);

// 2. fixture server
const html = readFileSync(join(here, 'fixture.html'));
const server = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(html); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

// 3. browser with extension + native host manifest in the temp profile
const profile = mkdtempSync(join(tmpdir(), 'redline-e2e-'));
const hostManifest = join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.redline.helper.json');
if (existsSync(hostManifest)) {
  mkdirSync(join(profile, 'NativeMessagingHosts'), { recursive: true });
  copyFileSync(hostManifest, join(profile, 'NativeMessagingHosts/com.redline.helper.json'));
}
// Use Playwright's own Chromium when installed, else any cached Playwright Chromium build.
let executablePath;
if (!existsSync(chromium.executablePath())) {
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const { readdirSync } = await import('node:fs');
  for (const d of readdirSync(cache).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const app = readdirSync(join(cache, d, 'chrome-mac-arm64')).find((n) => n.endsWith('.app'));
    if (app) { executablePath = join(cache, d, 'chrome-mac-arm64', app, 'Contents/MacOS', app.replace(/\.app$/, '')); break; }
  }
}
const context = await chromium.launchPersistentContext(profile, {
  ...(executablePath ? { executablePath } : { channel: 'chromium' }),
  headless: process.env.HEADED ? false : true,
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: Number(process.env.DPR ?? 1),
  permissions: ['clipboard-read', 'clipboard-write'],
  args: [
    `--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`,
  ],
});
let page;
let savedShot; // annotation.screenshot of comment 1 from the JSON export
const pngSize = (file) => { const b = readFileSync(file); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), magic: b.subarray(1, 4).toString() }; };
try {
  const sw = await step('service worker starts with the stable extension id', async () => {
    const w = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10000 }));
    const id = new URL(w.url()).host;
    if (id !== readFileSync(join(root, '.keys/extension-id.txt'), 'utf8').trim()) throw new Error('unexpected id ' + id);
    return w;
  });
  const extId = new URL(sw.url()).host;
  const logs = [];
  sw.on('console', (m) => logs.push('[sw] ' + m.text()));
  context.on('page', (p) => p.on('console', (m) => logs.push('[page] ' + m.text())));
  process.on('exit', () => { if (process.env.LOGS) console.log(logs.join('\n')); });

  page = await context.newPage();
  page.on('console', (m) => logs.push('[page] ' + m.text()));
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto(base + '/pricing');
  const ui = page.locator('redline-ui');

  await step('dormant: no UI before enabling', async () => {
    await page.waitForTimeout(800);
    if (await ui.count()) throw new Error('UI mounted while dormant');
  });

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

  await step('pin mode: clicking a card does not reach the page and opens the comment box', async () => {
    await openToolbar();
    await ui.getByRole('button', { name: 'Pin' }).click();
    const btn = page.locator('.card--pro button');
    await btn.hover(); await page.waitForTimeout(200);
    await page.screenshot({ path: join(artifacts, '1-hover.png') });
    await page.locator('.card--pro h2').click();
    await ui.getByLabel('Comment text').waitFor({ timeout: 3000 });
    const clicks = await page.evaluate(() => window.__clicks ?? 0);
    if (clicks) throw new Error('page received click');
  });

  await step('typed comment + dictation via local helper', async () => {
    const box = ui.getByLabel('Comment text');
    await box.fill('Typed: align the button.');
    await ui.getByRole('button', { name: 'Dictate' }).click();
    await page.waitForTimeout(3500);
    await page.screenshot({ path: join(artifacts, '2-listening.png') });
    await ui.getByRole('button', { name: /Dictate|Stop/ }).first().click();
    await page.waitForFunction(() => {
      const ta = document.querySelector('redline-ui')?.shadowRoot?.querySelector('textarea');
      return ta && /price/i.test(ta.value);
    }, null, { timeout: 30000 }).catch(async (e) => {
      await page.screenshot({ path: join(artifacts, 'fail-dictation.png') });
      const txt = await ui.locator('body, div').first().innerText().catch(() => '');
      throw new Error('dictated text never arrived. UI says: ' + txt.slice(0, 300));
    });
    const value = await box.inputValue();
    console.log('   textarea →', JSON.stringify(value));
    if (!value.startsWith('Typed: align the button.')) throw new Error('typed text was overwritten');
  });

  await step('save with screenshot', async () => {
    const shot = ui.getByRole('button', { name: /No screenshot|Screenshot will be attached/ });
    if (await shot.getAttribute('aria-label') === 'No screenshot') await shot.click();
    await ui.getByLabel('Comment text').focus();
    await page.screenshot({ path: join(artifacts, '3-comment-box.png') });
    const hint = await ui.getByTestId('comment-hint').innerText();
    if (!/↵ save/.test(hint) || !/⇧↵ new line/.test(hint)) throw new Error('footer hint missing: ' + hint);
    // Tab from the textarea lands on Save; Tab from Save wraps to the first control (focus trap).
    const active = () => page.evaluate(() => {
      const a = document.querySelector('redline-ui').shadowRoot.activeElement;
      return a ? `${a.tagName}|${a.getAttribute('aria-label') ?? ''}|${a.textContent.trim()}` : 'none';
    });
    await page.keyboard.press('Tab');
    const afterTab = await active();
    if (!/^BUTTON\|\|Save$/.test(afterTab)) throw new Error('Tab from textarea did not focus Save: ' + afterTab);
    await page.keyboard.press('Tab');
    const wrapped = await active();
    if (!/^BUTTON\|Dictate\|/.test(wrapped)) throw new Error('Tab from Save did not wrap to the first control: ' + wrapped);
    await page.keyboard.press('Shift+Tab');
    const back = await active();
    if (!/^BUTTON\|\|Save$/.test(back)) throw new Error('Shift+Tab from the first control did not wrap to Save: ' + back);
    await page.keyboard.press('Shift+Tab');
    if (!(await active()).startsWith('TEXTAREA')) throw new Error('Shift+Tab from Save did not return to the textarea');
    await page.keyboard.press('Enter'); // enterToSave defaults on
    await ui.getByRole('button', { name: 'Comment 1' }).waitFor({ timeout: 5000 });
  });

  await step('area comment', async () => {
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    await openToolbar();
    await ui.getByRole('button', { name: 'Area' }).click();
    const a = await page.locator('.card--starter').boundingBox();
    const b = await page.locator('.card--business').boundingBox();
    await page.mouse.move(a.x + 10, a.y + a.height - 50); await page.mouse.down();
    await page.mouse.move(b.x + b.width - 10, b.y + b.height - 10, { steps: 8 }); await page.mouse.up();
    await ui.getByLabel('Comment text').fill('Buttons do not line up across cards.');
    await page.keyboard.press('Meta+Enter');
    await ui.getByRole('button', { name: 'Comment 2' }).waitFor({ timeout: 5000 });
    await page.keyboard.press('Escape');
  });

  await step('persists across reload (auto-mount on enabled origin)', async () => {
    await page.reload();
    await ui.getByRole('button', { name: /Redline: 2 comments/ }).waitFor({ timeout: 8000 });
    await ui.getByRole('button', { name: 'Comment 1' }).waitFor();
    await page.screenshot({ path: join(artifacts, '4-after-reload.png') });
  });

  await step('drawer: edit inline, copy markdown + json', async () => {
    await openToolbar();
    await ui.getByRole('button', { name: /^List/ }).click();
    await ui.getByTestId('review-row').first().waitFor();
    if ((await ui.getByTestId('review-row').count()) !== 2) throw new Error('expected 2 rows');
    await ui.getByRole('button', { name: 'Edit comment 2' }).click();
    const ed = ui.locator('textarea').last();
    await ed.fill('Buttons do not line up across the three cards.');
    await page.keyboard.press('Meta+Enter');
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(artifacts, '5-drawer.png') });
    await ui.locator('button[aria-haspopup="menu"]').first().click();
    await ui.getByRole('menuitem', { name: /Markdown/ }).or(ui.getByRole('button', { name: /Copy as Markdown/ })).first().click();
    await page.waitForTimeout(300);
    const md = await page.evaluate(() => navigator.clipboard.readText());
    console.log('----- copied markdown -----\n' + md.split('\n').slice(0, 40).join('\n') + '\n---------------------------');
    for (const must of ['# Redline review', 'card--pro', 'price', 'three cards', 'selector:']) if (!md.includes(must)) throw new Error('markdown missing ' + must);
    await ui.locator('button[aria-haspopup="menu"]').first().click();
    await ui.getByRole('menuitem', { name: /JSON/ }).or(ui.getByRole('button', { name: /Copy as JSON/ })).first().click();
    await page.waitForTimeout(300);
    const json = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    if (json.schema !== 'redline/export/v1' || json.pages[0].annotations.length !== 2) throw new Error('bad json export');
    const a1 = json.pages[0].annotations.find((a) => a.number === 1);
    if (!a1.screenshot) throw new Error('comment 1 has no screenshot');
    savedShot = a1.screenshot;
    if (a1.comment.source !== 'mixed') throw new Error('expected source mixed, got ' + a1.comment.source);
    console.log('   json: anchor', a1.anchor.selector, '| dom.tag', a1.dom.tag, '| styles', Object.keys(a1.dom.styles).length);
  });

  await step('screenshot: file on disk, thumbnail, lightbox, copy image', async () => {
    // 1. the helper wrote a real PNG under ~/.redline/shots and the export carries its path
    const shotsRoot = join(homedir(), '.redline', 'shots');
    if (!savedShot?.path) throw new Error('JSON export has no screenshot.path (is the helper installed?): ' + JSON.stringify(savedShot));
    if (!savedShot.path.startsWith(shotsRoot + '/')) throw new Error('path not under ~/.redline/shots: ' + savedShot.path);
    if (!existsSync(savedShot.path)) throw new Error('screenshot file missing: ' + savedShot.path);
    const png = pngSize(savedShot.path);
    if (png.magic !== 'PNG') throw new Error('not a PNG file');
    const el = await page.locator('.card--pro h2').boundingBox();
    console.log(`   file ${savedShot.path}\n   png ${png.width}x${png.height} (element ${Math.round(el.width)}x${Math.round(el.height)})`);
    copyFileSync(savedShot.path, join(artifacts, '9-saved-shot.png')); // the file an agent would open by path
    if (png.width <= el.width + 40 || png.height <= el.height + 40) throw new Error('crop has no surrounding context');
    if (png.width !== savedShot.width || png.height !== savedShot.height) throw new Error('export dimensions differ from the file');
    // 2. thumbnail in the drawer row
    const row = ui.getByTestId('review-row').first();
    const thumb = row.getByTestId('shot-thumb-img');
    await thumb.waitFor({ timeout: 5000 });
    const loaded = await thumb.evaluate((i) => i.complete && i.naturalWidth > 0);
    if (!loaded) throw new Error('thumbnail <img> did not load');
    if (await ui.getByTestId('review-row').nth(1).getByTestId('shot-thumb').count()) throw new Error('row without a screenshot shows a thumbnail');
    // 3. lightbox: opens on click, shows the path, closes on Esc and leaves the drawer open
    await row.getByTestId('shot-thumb').click();
    const box = ui.getByTestId('shot-lightbox');
    await box.waitFor({ timeout: 3000 });
    if ((await box.getByLabel('Screenshot file path').inputValue()) !== savedShot.path) throw new Error('lightbox shows the wrong path');
    await box.getByTestId('shot-full').waitFor();
    // 4. copy image → image/png on the system clipboard
    await box.getByRole('button', { name: 'Copy image' }).click();
    await ui.getByText('Image copied').waitFor({ timeout: 3000 });
    const clip = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const out = [];
      for (const it of items) for (const type of it.types) out.push({ type, size: type.startsWith('image/') ? (await it.getType(type)).size : 0 });
      return out;
    });
    console.log('   clipboard:', JSON.stringify(clip));
    if (!clip.some((c) => c.type === 'image/png' && c.size > 100)) throw new Error('no image/png on the clipboard: ' + JSON.stringify(clip));
    await page.screenshot({ path: join(artifacts, '9-lightbox.png') });
    await page.keyboard.press('Escape');
    await box.waitFor({ state: 'detached', timeout: 3000 });
    if (!(await ui.getByTestId('review-row').first().isVisible())) throw new Error('Esc closed the drawer too');
    // 5. pin hover card also shows the thumbnail
    await ui.getByRole('button', { name: /^Comment 1:/ }).hover();
    await ui.getByTestId('pin-shot').waitFor({ timeout: 3000 });
    await page.screenshot({ path: join(artifacts, '9b-pin-card.png') });
    await page.mouse.move(5, 5);
  });

  await step('single delete + undo, then select-all delete', async () => {
    await ui.getByRole('button', { name: 'Delete comment 2' }).click();
    await page.waitForTimeout(300);
    if ((await ui.getByTestId('review-row').count()) !== 1) throw new Error('row not removed');
    await ui.getByRole('button', { name: /Undo/ }).click();
    await page.waitForTimeout(500);
    if ((await ui.getByTestId('review-row').count()) !== 2) throw new Error('undo failed');
    await ui.getByRole('checkbox', { name: /Select all/ }).check();
    await ui.getByRole('button', { name: /Delete 2/ }).click();
    await ui.getByRole('button', { name: 'Confirm delete' }).or(ui.getByRole('button', { name: /^Delete$/ })).first().click();
    await page.waitForTimeout(500);
    if ((await ui.getByTestId('review-row').count()) !== 0) throw new Error('bulk delete failed');
  });

  await step('extension pages render (settings voice, all reviews)', async () => {
    const p2 = await context.newPage();
    await p2.goto(`chrome-extension://${extId}/options.html#voice`);
    await p2.waitForTimeout(2500);
    await p2.screenshot({ path: join(artifacts, '6-settings-voice.png'), fullPage: true });
    const text = await p2.locator('body').innerText();
    console.log('   voice page mentions:', ['connected', 'base.en', 'small', 'parakeet'].filter((w) => text.toLowerCase().includes(w)).join(', '));
    await p2.goto(`chrome-extension://${extId}/options.html#shortcuts`);
    await p2.waitForTimeout(800);
    await p2.screenshot({ path: join(artifacts, '7-settings-shortcuts.png'), fullPage: true });
    await p2.goto(`chrome-extension://${extId}/reviews.html`);
    await p2.waitForTimeout(800);
    await p2.screenshot({ path: join(artifacts, '8-reviews.png'), fullPage: true });
    await p2.close();
  });

  await step('deleting comments removes the saved file (after the 10 s undo window)', async () => {
    const deadline = Date.now() + 20000;
    while (existsSync(savedShot.path) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
    if (existsSync(savedShot.path)) throw new Error('file still on disk: ' + savedShot.path);
  });
} catch {
  if (page) await page.screenshot({ path: join(artifacts, 'fail.png') }).catch(() => {});
} finally {
  await context.close(); server.close();
  console.log('\n' + results.map((r) => `${r[0]}  ${r[1]}${r[3] ? ' — ' + r[3] : ''}`).join('\n'));
  process.exitCode = results.some((r) => r[0] === 'FAIL') ? 1 : 0;
}
