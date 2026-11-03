import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
const root = new URL('../..', import.meta.url).pathname;
const ext = join(root, '.output/chrome-mv3');
const profile = mkdtempSync(join(tmpdir(), 'redline-dbg-'));
mkdirSync(join(profile, 'NativeMessagingHosts'));
copyFileSync(join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.redline.helper.json'), join(profile, 'NativeMessagingHosts/com.redline.helper.json'));
const cache = join(homedir(), 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const ctx = await chromium.launchPersistentContext(profile, { executablePath: cache, headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + join(root, 'tests/e2e/artifacts/speech.wav')] });
const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
sw.on('console', (m) => console.log('[sw]', m.text()));
const withTimeout = (label, ms) => `Promise.race([__P__, new Promise((_, r) => setTimeout(() => r(new Error('${label} timeout')), ${ms}))])`;
const run = async (label, fnSrc) => {
  try { console.log(label, JSON.stringify(await sw.evaluate(`(async () => { const __P__ = (${fnSrc})(); return await ${withTimeout(label, 8000)}; })()`)).slice(0, 600)); }
  catch (e) { console.log(label, 'ERR', e.message.split('\n')[0]); }
};
await run('native hello', `() => new Promise((ok, bad) => { const p = chrome.runtime.connectNative('com.redline.helper'); p.onMessage.addListener((m) => { ok(m); p.disconnect(); }); p.onDisconnect.addListener(() => bad(new Error('disconnect: ' + chrome.runtime.lastError?.message))); p.postMessage({ id: '1', type: 'hello' }); })`);
const extId = new URL(sw.url()).host;
const pg = await ctx.newPage(); pg.on('console', (m) => console.log('[page]', m.text()));
await pg.goto(`chrome-extension://${extId}/reviews.html`);
const prpc = async (type, payload = {}, ms = 15000) => { const t = Date.now(); try { const r = await pg.evaluate(([type, payload, ms]) => Promise.race([chrome.runtime.sendMessage({ channel: 'redline/rpc', type, payload }), new Promise((_, b) => setTimeout(() => b(new Error('timeout')), ms))]), [type, payload, ms]); console.log(type, Date.now() - t + 'ms', JSON.stringify(r).slice(0, 700)); } catch (e) { console.log(type, Date.now() - t + 'ms', 'ERR', e.message.split('\n')[0]); } };
await prpc('helper/status');
await prpc('speech/status');
await prpc('speech/start');
await run('contexts', `async () => (await chrome.runtime.getContexts({})).map(c => c.contextType + ' ' + c.documentUrl)`);
await pg.waitForTimeout(3000);
await prpc('speech/stop', {}, 40000);
await prpc('speech/start');
await pg.waitForTimeout(1000);
await prpc('speech/cancel');
await run('direct offscreen record/start', `async () => { const t = Date.now(); const r = await chrome.runtime.sendMessage({ channel: 'redline/offscreen', type: 'record/start', maxSeconds: 5 }); const t1 = Date.now() - t; await chrome.runtime.sendMessage({ channel: 'redline/offscreen', type: 'record/cancel' }); return { r, ms: t1 }; }`);
await ctx.close(); process.exit(0);
await run('rpc speech/status', `() => new Promise((ok) => chrome.runtime.sendMessage({ channel: 'redline/rpc', type: 'speech/status', payload: {} }, ok))`);
await run('rpc helper/status', `() => new Promise((ok) => chrome.runtime.sendMessage({ channel: 'redline/rpc', type: 'helper/status', payload: {} }, ok))`);
await run('offscreen contexts', `async () => (await chrome.runtime.getContexts({})).map(c => c.contextType + ' ' + c.documentUrl)`);
await ctx.close();
