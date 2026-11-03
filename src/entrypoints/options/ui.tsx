import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../ui/shared/cn';

export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rl-accent-2';

export function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-rl-line bg-rl-ink-2 p-5', className)}>
      {title && <h2 className="mb-3 text-lg font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-start gap-x-4 gap-y-1 py-3 not-first:border-t not-first:border-rl-line">
      <div className="pt-1 text-rl-text">{label}</div>
      <div className="min-w-0">
        {children}
        {hint && <p className="mt-1.5 text-xs text-rl-muted">{hint}</p>}
      </div>
    </div>
  );
}

export function Button({
  variant = 'default',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm disabled:opacity-50',
        focusRing,
        variant === 'primary' && 'bg-rl-accent font-medium text-white hover:bg-rl-accent-2',
        variant === 'default' && 'border border-rl-line bg-rl-ink text-rl-text hover:border-rl-muted',
        variant === 'ghost' && 'text-rl-muted hover:text-rl-text',
        className,
      )}
    />
  );
}

export function Radio({
  name,
  checked,
  onChange,
  disabled,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={cn('flex items-start gap-2.5 py-1', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <input type="radio" name={name} className={cn('mt-1 accent-rl-accent', focusRing)} checked={checked} onChange={onChange} disabled={disabled} />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

export function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'idle' }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block h-2 w-2 rounded-full', tone === 'ok' && 'bg-rl-ok', tone === 'warn' && 'bg-rl-warn', tone === 'idle' && 'bg-rl-muted')}
    />
  );
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}
