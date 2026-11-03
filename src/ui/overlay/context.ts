import { createContext, useContext } from 'react';

/** Our shadow host element (events from inside it must be ignored by page interceptors). */
export const HostContext = createContext<HTMLElement | null>(null);
export const useHost = () => useContext(HostContext);

/** True when an event was dispatched from inside our own shadow tree. */
export function eventInHost(e: Event, host: HTMLElement | null): boolean {
  if (!host) return false;
  if (e.target === host) return true;
  const path = e.composedPath?.();
  return !!path && path.includes(host);
}
