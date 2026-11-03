import type { OffscreenMessage } from '../../core/messages';
import { OFFSCREEN_PORT, type OffscreenPortEvent } from '../../speech/offscreen-protocol';
import { createChromeSpeech } from './chrome-speech';
import { createOffscreenHandler } from './handler';
import { createRecorder } from './recorder';

let port: chrome.runtime.Port | null = null;

/** The service worker may have restarted since last time: reconnect lazily. */
function post(event: OffscreenPortEvent): void {
  try {
    if (!port) {
      port = chrome.runtime.connect({ name: OFFSCREEN_PORT });
      port.onDisconnect.addListener(() => { port = null; void chrome.runtime.lastError; });
    }
    port.postMessage(event);
  } catch {
    port = null;
  }
}

const recorder = createRecorder({
  onLevel: (level) => post({ type: 'level', level }),
  onMax: () => post({ type: 'record-max' }),
});
const handle = createOffscreenHandler({ recorder, speech: createChromeSpeech() });

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (typeof msg !== 'object' || msg === null || (msg as { channel?: unknown }).channel !== 'redline/offscreen') return false;
  void handle(msg as OffscreenMessage).then(sendResponse);
  return true;
});
