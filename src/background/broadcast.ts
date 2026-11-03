import type { RedlineEvent } from '../core/messages';

/** Event without the channel field (added here). */
export type EventInput = RedlineEvent extends infer E ? (E extends RedlineEvent ? Omit<E, 'channel'> : never) : never;

const ignore = () => undefined;

export function sendToTab(tabId: number, event: EventInput): Promise<unknown> {
  return Promise.resolve(chrome.tabs.sendMessage(tabId, { channel: 'redline/event', ...event })).catch(ignore);
}

/** Tabs + extension pages. Missing receivers are expected and ignored. */
export async function broadcast(event: EventInput): Promise<void> {
  const msg = { channel: 'redline/event', ...event };
  const extBase = chrome.runtime.getURL('/');
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs
        // extension pages in tabs already get the runtime.sendMessage below
        .filter((t) => t.id !== undefined && !t.url?.startsWith(extBase))
        .map((t) => Promise.resolve(chrome.tabs.sendMessage(t.id!, msg)).catch(ignore)),
    );
  } catch { /* ignore */ }
  try {
    await Promise.resolve(chrome.runtime.sendMessage(msg)).catch(ignore);
  } catch { /* ignore */ }
}

/** Send an event to the target of a speech session. */
export function sendToTarget(target: number | 'extension', event: EventInput): Promise<unknown> {
  if (target === 'extension') {
    return Promise.resolve(chrome.runtime.sendMessage({ channel: 'redline/event', ...event })).catch(ignore);
  }
  return sendToTab(target, event);
}
