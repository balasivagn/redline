import { useEffect, useState } from 'react';
import { cn } from '../../ui/shared/cn';
import { useSettings } from '../../ui/list/useSettings';
import { GeneralSection } from './GeneralSection';
import { ShortcutsSection } from './ShortcutsSection';
import { focusRing } from './ui';
import { VoiceSection } from './VoiceSection';

export const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'voice', label: 'Voice' },
] as const;
export type SectionId = (typeof SECTIONS)[number]['id'];

export function sectionFromHash(hash: string): SectionId {
  const id = hash.replace(/^#/, '');
  return SECTIONS.find((s) => s.id === id)?.id ?? 'general';
}

export function App() {
  const { settings, loaded, update } = useSettings();
  const [section, setSection] = useState<SectionId>(() => sectionFromHash(location.hash));

  useEffect(() => {
    const onHash = () => setSection(sectionFromHash(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const current = SECTIONS.find((s) => s.id === section)!;
  useEffect(() => {
    document.title = `Redline — Settings › ${current.label}`;
  }, [current.label]);

  return (
    <div className="mx-auto flex min-h-screen max-w-[960px] gap-8 px-6 py-8">
      <nav aria-label="Settings sections" className="w-[180px] shrink-0">
        <h1 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <span aria-hidden="true" className="text-rl-accent">✎</span> Redline
        </h1>
        <ul className="flex flex-col gap-1">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={s.id === section ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-2',
                  focusRing,
                  s.id === section ? 'bg-rl-ink-2 text-rl-text' : 'text-rl-muted hover:bg-rl-ink-2/60 hover:text-rl-text',
                )}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        <a
          href="reviews.html"
          className={cn('mt-6 block rounded-md px-3 py-2 text-rl-muted hover:text-rl-text', focusRing)}
        >
          All reviews ↗
        </a>
      </nav>
      <main className="min-w-0 flex-1">
        <p className="mb-4 text-xs uppercase tracking-wide text-rl-muted">Settings › {current.label}</p>
        {!loaded ? (
          <p className="text-rl-muted">Loading…</p>
        ) : section === 'general' ? (
          <GeneralSection settings={settings} update={update} />
        ) : section === 'shortcuts' ? (
          <ShortcutsSection settings={settings} update={update} />
        ) : (
          <VoiceSection settings={settings} update={update} />
        )}
      </main>
    </div>
  );
}
