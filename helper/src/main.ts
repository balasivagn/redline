import { mkdirSync } from 'node:fs';
import { encodeFrame, FrameDecoder, FrameError, MAX_OUTBOUND_BYTES } from './framing';
import { createHandler, type Outbound } from './handler';
import { makeEnv } from './env';
import { log, redirectConsole, setLogFile } from './log';

async function main(): Promise<void> {
  const env = makeEnv();
  try {
    mkdirSync(env.redlineDir, { recursive: true });
  } catch {
    // logging/caching degrade gracefully
  }
  setLogFile(env.logFile);
  redirectConsole();
  log(`helper started pid=${process.pid}`);

  process.stdout.on('error', (e) => log('stdout error', e)); // Chrome may close the pipe first

  const handler = createHandler(env);
  const decoder = new FrameDecoder();
  const pending = new Set<Promise<void>>();

  // Serialise writes so concurrent replies never interleave their bytes.
  let writeChain: Promise<void> = Promise.resolve();
  const send = (message: Outbound): void => {
    let frame: Buffer;
    try {
      frame = encodeFrame(message);
    } catch (e) {
      log('reply too large or unencodable', (e as Error).message);
      frame = encodeFrame({
        id: (message as { id: string }).id,
        ok: false,
        error: { code: 'too-large', message: `reply exceeded ${MAX_OUTBOUND_BYTES} bytes` },
      });
    }
    writeChain = writeChain.then(
      () =>
        new Promise<void>((resolve) => {
          process.stdout.write(frame, () => resolve());
        }),
    );
  };

  try {
    for await (const chunk of Bun.stdin.stream()) {
      for (const item of decoder.push(chunk)) {
        if ('error' in item) {
          log('invalid JSON frame', item.error.message);
          continue;
        }
        const p = handler.handle(item.message, send).finally(() => pending.delete(p));
        pending.add(p);
      }
    }
  } catch (e) {
    if (e instanceof FrameError) log('fatal framing error', e.message);
    else log('stdin error', e);
  }

  // stdin closed (Chrome disconnected): abort long jobs (downloads, transcriptions), let quick
  // requests (hello/detect/catalog) finish and flush, then exit.
  log(`stdin closed; ${pending.size} request(s) in flight`);
  handler.shutdown();
  await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, 10_000))]);
  await writeChain;
  process.exit(0);
}

main().catch((e) => {
  log('fatal', e);
  process.exit(1);
});
