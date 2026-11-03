import type { ReactNode } from 'react';
import { Text } from '../../../packages/ui/src/Text';

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main>
      <Text>{title}</Text>
      {children}
    </main>
  );
}
