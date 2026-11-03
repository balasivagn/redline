import type { ReactNode } from 'react';

/** Shared primitive: every heading in the app is written here. */
export function Text({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-[2.25rem] font-semibold leading-tight" style={{ fontFamily: 'Syne, sans-serif', fontSize: 36, lineHeight: '45px', fontWeight: 600, margin: 0 }}>{children}</h2>;
}
