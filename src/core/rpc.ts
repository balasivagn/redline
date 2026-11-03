import type { RedlineEvent, RpcMap, RpcRequest, RpcResult, RpcType } from './messages';
import { isRedlineEvent } from './messages';

/** Call the service worker. Throws Error(message) when the handler fails. */
export async function rpc<T extends RpcType>(type: T, payload: RpcMap[T]['req']): Promise<RpcMap[T]['res']> {
  const req: RpcRequest<T> = { channel: 'redline/rpc', type, payload };
  const result = (await chrome.runtime.sendMessage(req)) as RpcResult<T> | undefined;
  if (!result) throw new Error(`No response for ${type}`);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

/** Subscribe to background events. Returns an unsubscribe function. */
export function onRedlineEvent(handler: (e: RedlineEvent) => void): () => void {
  const listener = (m: unknown) => {
    if (isRedlineEvent(m)) handler(m);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
