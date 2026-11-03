import type { OffscreenMessage } from '../core/messages';
import { SpeechError } from '../speech/engine';
import type { RecorderClient } from '../speech/native';
import type { OffscreenReply } from '../speech/offscreen-protocol';
import type { SpeechEngineStatus } from '../speech/types';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type OffscreenRequest = DistributiveOmit<OffscreenMessage, 'channel'>;

let creating: Promise<void> | null = null;

/** Create the offscreen document if it does not exist yet (single instance, reused). */
export async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL('/offscreen.html');
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType], documentUrls: [url] });
  if (existing.length > 0) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA' as chrome.offscreen.Reason],
        justification: 'Record microphone audio for dictated review comments.',
      })
      .catch((e: unknown) => {
        // A concurrent creator won the race: that is fine.
        if (!/single offscreen/i.test(e instanceof Error ? e.message : String(e))) throw e;
      })
      .finally(() => { creating = null; });
  }
  return creating;
}

const NO_RECEIVER_RE = /receiving end does not exist|could not establish connection/i;

/** Retry schedule while the offscreen page is still wiring its listener (ms). */
export const OFFSCREEN_RETRY_DELAYS = [100, 200, 400, 800];

/**
 * Send to the offscreen document and unwrap its reply (throws SpeechError).
 * A freshly created document may not be listening yet, and Chrome then rejects with
 * "Receiving end does not exist" (or returns undefined): retry with backoff, and if it still
 * does not answer, recreate the document once before giving up with a readable error.
 */
export async function sendOffscreen<T extends object = object>(
  msg: OffscreenRequest,
  deps: { ensure?: () => Promise<void>; recreate?: () => Promise<void>; send?: (m: unknown) => Promise<unknown>; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ ok: true } & T> {
  const ensure = deps.ensure ?? ensureOffscreen;
  const recreate = deps.recreate ?? recreateOffscreen;
  const sendRaw = deps.send ?? ((m: unknown) => chrome.runtime.sendMessage(m));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const send = async (): Promise<OffscreenReply<T> | undefined> => {
    try {
      return (await sendRaw({ channel: 'redline/offscreen', ...msg })) as OffscreenReply<T> | undefined;
    } catch (e) {
      if (NO_RECEIVER_RE.test(e instanceof Error ? e.message : String(e))) return undefined;
      throw e;
    }
  };
  const attempt = async (): Promise<OffscreenReply<T> | undefined> => {
    let reply = await send();
    for (const delay of OFFSCREEN_RETRY_DELAYS) {
      if (reply) break;
      await sleep(delay);
      reply = await send();
    }
    return reply;
  };

  await ensure();
  let reply = await attempt();
  if (!reply) {
    await recreate();
    reply = await attempt();
  }
  if (!reply) {
    throw new SpeechError('mic-unavailable', "Redline's audio recorder page didn't start. Reload the extension at chrome://extensions and try again.");
  }
  if (!reply.ok) throw new SpeechError(reply.code, reply.message);
  return reply;
}

/** Close a stuck offscreen document (if any) and create a fresh one. */
export async function recreateOffscreen(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    /* none open */
  }
  await ensureOffscreen();
}

export function createRecorderClient(): RecorderClient {
  return {
    async start(maxSeconds) {
      await sendOffscreen({ type: 'record/start', maxSeconds });
    },
    async stop() {
      return (await sendOffscreen<{ wavBase64: string }>({ type: 'record/stop' })).wavBase64;
    },
    async cancel() {
      try { await sendOffscreen({ type: 'record/cancel' }); } catch { /* nothing to cancel */ }
    },
  };
}

export function createChromeSpeechTransport(): import('../speech/chrome').ChromeSpeechTransport {
  return {
    async status(lang) {
      const r = await sendOffscreen<{ status: SpeechEngineStatus }>({ type: 'chrome-speech/status', lang });
      return r.status;
    },
    async start(lang) {
      await sendOffscreen({ type: 'chrome-speech/start', lang });
    },
    async stop() {
      return (await sendOffscreen<{ text: string }>({ type: 'chrome-speech/stop' })).text;
    },
    async cancel() {
      // record/cancel also aborts any running Web Speech session in the offscreen doc.
      try { await sendOffscreen({ type: 'record/cancel' }); } catch { /* nothing running */ }
    },
  };
}
