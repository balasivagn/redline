import { useState } from 'react';
import { rpc } from '../../core/rpc';
import type { Corner, Settings } from '../../core/settings';
import { cn } from '../../ui/shared/cn';
import { Button, Card, Field, focusRing, Radio } from './ui';

const CORNERS: Array<{ id: Corner; label: string; cls: string }> = [
  { id: 'tl', label: 'Top left', cls: 'top-1.5 left-1.5' },
  { id: 'tr', label: 'Top right', cls: 'top-1.5 right-1.5' },
  { id: 'bl', label: 'Bottom left', cls: 'bottom-1.5 left-1.5' },
  { id: 'br', label: 'Bottom right', cls: 'bottom-1.5 right-1.5' },
];

export function GeneralSection({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => Promise<void> }) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const removeSite = async (origin: string) => {
    setRemoving(origin);
    setError('');
    try {
      const { enabledOrigins } = await rpc('site/setEnabled', { origin, enabled: false });
      await update({ enabledOrigins });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Card title="General">
      <Field label="Pill corner" hint="You can also drag the pill on any page; it snaps to the nearest corner.">
        <div role="radiogroup" aria-label="Pill corner" className="flex items-center gap-4">
          <div className="relative h-[72px] w-[112px] rounded-md border border-rl-line bg-rl-ink">
            {CORNERS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={settings.pillCorner === c.id}
                aria-label={c.label}
                title={c.label}
                onClick={() => void update({ pillCorner: c.id })}
                className={cn(
                  'absolute h-4 w-7 rounded-full border',
                  c.cls,
                  focusRing,
                  settings.pillCorner === c.id ? 'border-rl-accent bg-rl-accent' : 'border-rl-line bg-rl-ink-2 hover:border-rl-muted',
                )}
              />
            ))}
          </div>
          <span className="text-rl-muted">{CORNERS.find((c) => c.id === settings.pillCorner)?.label}</span>
        </div>
      </Field>

      <Field label="Screenshots" hint="Attach a 📷 screenshot of the commented area to each new comment. Can be changed per comment.">
        <label className="flex cursor-pointer items-center gap-2.5 py-1">
          <input
            type="checkbox"
            className={cn('h-4 w-4 accent-rl-accent', focusRing)}
            checked={settings.screenshotByDefault}
            onChange={(e) => void update({ screenshotByDefault: e.target.checked })}
          />
          <span>📷 on by default</span>
        </label>
      </Field>

      <Field label="Copy format" hint="Used by quick copy (⧉) and as the first choice in the Copy menu.">
        <div role="radiogroup" aria-label="Copy format">
          <Radio name="copyFormat" checked={settings.copyFormat === 'markdown'} onChange={() => void update({ copyFormat: 'markdown' })}>
            Markdown <span className="text-rl-muted">(for coding agents)</span>
          </Radio>
          <Radio name="copyFormat" checked={settings.copyFormat === 'json'} onChange={() => void update({ copyFormat: 'json' })}>
            JSON <span className="text-rl-muted">(full annotations)</span>
          </Radio>
        </div>
      </Field>

      <Field label="Enabled sites" hint="Redline mounts automatically on these origins, and on any page that already has comments.">
        {settings.enabledOrigins.length === 0 ? (
          <p className="py-1 text-rl-muted">None yet. Turn Redline on from the toolbar icon to add a site.</p>
        ) : (
          <ul className="divide-y divide-rl-line rounded-md border border-rl-line bg-rl-ink">
            {settings.enabledOrigins.map((origin) => (
              <li key={origin} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{origin}</span>
                <Button variant="ghost" disabled={removing === origin} onClick={() => void removeSite(origin)} aria-label={`Remove ${origin}`}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="mt-2 text-xs text-rl-accent-2">{error}</p>}
      </Field>
    </Card>
  );
}
