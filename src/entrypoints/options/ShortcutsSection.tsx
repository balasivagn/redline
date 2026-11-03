import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, formatShortcut, type Settings, type Shortcuts } from '../../core/settings';
import { cn } from '../../ui/shared/cn';
import { dictateNeedsModifier, findConflicts, recordShortcut, SHORTCUT_NAMES, type ShortcutName } from './shortcut-recorder';
import { Button, Card, Field, focusRing } from './ui';

const LABELS: Record<ShortcutName, { label: string; hint: string }> = {
  pin: { label: 'Pin mode', hint: 'Click an element to comment on it' },
  area: { label: 'Area mode', hint: 'Drag a box to comment on a region' },
  screenshot: { label: '📷 Screenshot', hint: 'Turn screenshots on or off' },
  list: { label: 'List', hint: 'Open the comments drawer' },
  dictate: { label: 'Dictate 🎤', hint: 'Start/stop voice, also inside the comment box' },
};

const isMac = () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

export function ShortcutInput({ id, value, onChange, label }: { id: string; value: string; onChange: (v: string) => void; label: string }) {
  const [recording, setRecording] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const r = recordShortcut(e);
      if (r.kind === 'ignore') return;
      setRecording(false);
      if (r.kind === 'shortcut') onChange(r.value);
      btn.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, onChange]);

  return (
    <button
      ref={btn}
      id={id}
      type="button"
      aria-label={`${label} shortcut: ${formatShortcut(value, isMac())}. Press to record a new one.`}
      onClick={() => setRecording((r) => !r)}
      onBlur={() => setRecording(false)}
      className={cn(
        'min-w-[160px] rounded-md border px-3 py-1.5 text-left font-mono text-sm',
        focusRing,
        recording ? 'border-rl-accent bg-rl-accent/10 text-rl-accent-2' : 'border-rl-line bg-rl-ink text-rl-text hover:border-rl-muted',
      )}
    >
      {recording ? 'Press keys… (Esc cancels)' : formatShortcut(value, isMac())}
    </button>
  );
}

export function ShortcutsSection({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => Promise<void> }) {
  const [globalShortcut, setGlobalShortcut] = useState<string | null>(null);
  const conflicts = findConflicts(settings.shortcuts);
  const isDefault = SHORTCUT_NAMES.every((n) => settings.shortcuts[n] === DEFAULT_SETTINGS.shortcuts[n]);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      try {
        void chrome.commands.getAll().then((cmds) => {
          if (!alive) return;
          const toggle = cmds.find((c) => c.name === 'toggle-redline');
          setGlobalShortcut(toggle?.shortcut ?? '');
        });
      } catch {
        if (alive) setGlobalShortcut('');
      }
    };
    refresh();
    window.addEventListener('focus', refresh); // user may have changed it in the other tab
    return () => {
      alive = false;
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const set = (name: ShortcutName, value: string) => {
    const next: Shortcuts = { ...settings.shortcuts, [name]: value };
    void update({ shortcuts: next });
  };

  return (
    <div className="flex flex-col gap-5">
      <Card title="Shortcuts">
        <p className="mb-2 text-rl-muted">
          Active while Redline is open on a page and focus is not in a text field (dictate also works inside the comment box). Select a
          field, then press the keys you want.
        </p>
        {SHORTCUT_NAMES.map((name) => {
          const conflict = conflicts[name];
          const warnModifier = name === 'dictate' && dictateNeedsModifier(settings.shortcuts.dictate);
          return (
            <Field key={name} label={LABELS[name].label} hint={LABELS[name].hint}>
              <div className="flex flex-wrap items-center gap-3">
                <ShortcutInput id={`sc-${name}`} label={LABELS[name].label} value={settings.shortcuts[name]} onChange={(v) => set(name, v)} />
                {settings.shortcuts[name] !== DEFAULT_SETTINGS.shortcuts[name] && (
                  <Button variant="ghost" onClick={() => set(name, DEFAULT_SETTINGS.shortcuts[name])}>
                    Default ({formatShortcut(DEFAULT_SETTINGS.shortcuts[name], isMac())})
                  </Button>
                )}
              </div>
              {conflict && (
                <p role="alert" className="mt-1.5 text-xs text-rl-warn">
                  ⚠ Same as {conflict.map((c) => LABELS[c].label).join(', ')}. Only one of them will work.
                </p>
              )}
              {warnModifier && (
                <p role="alert" className="mt-1.5 text-xs text-rl-warn">
                  ⚠ Add a modifier (⌥, ⌃, ⌘) so dictate doesn&apos;t fire while you type a comment.
                </p>
              )}
            </Field>
          );
        })}
        <Field label="Enter saves comments" hint="On: ↵ saves, ⇧↵ new line. Off: ↵ new line, ⌘↵ saves.">
          <label className="flex cursor-pointer items-center gap-2.5 py-1">
            <input
              type="checkbox"
              role="switch"
              id="sc-enter-to-save"
              className={cn('h-4 w-4 accent-rl-accent', focusRing)}
              checked={settings.enterToSave}
              onChange={(e) => void update({ enterToSave: e.target.checked })}
            />
            <span>{settings.enterToSave ? 'On' : 'Off'}</span>
          </label>
        </Field>
        <div className="mt-3 flex justify-end">
          <Button disabled={isDefault} onClick={() => void update({ shortcuts: { ...DEFAULT_SETTINGS.shortcuts } })}>
            Reset to defaults
          </Button>
        </div>
      </Card>

      <Card title="Turn Redline on/off">
        <p className="text-rl-muted">
          The global shortcut works on any page, even before Redline is running. Chrome owns it, so it is changed on Chrome&apos;s
          shortcuts page rather than here.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="rounded-md border border-rl-line bg-rl-ink px-3 py-1.5 font-mono text-sm">
            {globalShortcut === null ? '…' : globalShortcut ? globalShortcut : 'Not set'}
          </span>
          <Button onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>Change in Chrome ↗</Button>
        </div>
      </Card>
    </div>
  );
}
