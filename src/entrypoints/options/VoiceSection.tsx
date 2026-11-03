import { useCallback, useEffect, useState } from 'react';
import type { BinaryInfo, CatalogEntry, ModelInfo } from '../../../helper/protocol';
import { onRedlineEvent, rpc } from '../../core/rpc';
import type { HelperStatus } from '../../core/messages';
import { formatShortcut, type Settings } from '../../core/settings';
import type { SpeechEngineStatus } from '../../speech/types';
import { cn } from '../../ui/shared/cn';
import { MIC_HEARD_THRESHOLD, useMicPermission, useMicTest } from './useMic';
import { Button, Card, Field, formatBytes, Radio, StatusDot } from './ui';

export const INSTALL_COMMAND = '~/Codes/personal-projects/redline/install-helper';

const LANGUAGES: Array<[string, string]> = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['nl', 'Dutch'],
  ['hi', 'Hindi'],
  ['ja', 'Japanese'],
  ['zh', 'Chinese'],
];

interface DownloadState {
  receivedBytes: number;
  totalBytes: number;
  phase: 'starting' | 'downloading' | 'verifying';
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isMac = () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

export function VoiceSection({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => Promise<void> }) {
  const [engines, setEngines] = useState<SpeechEngineStatus[]>([]);
  const [helper, setHelper] = useState<HelperStatus | null>(null);
  const [helperError, setHelperError] = useState('');
  const [rescanning, setRescanning] = useState(false);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [downloadError, setDownloadError] = useState<Record<string, string>>({});
  const mic = useMicPermission();
  const micTest = useMicTest();

  const installed = helper?.installed === true;

  const refreshHelper = useCallback(async (refresh: boolean) => {
    try {
      const s = await rpc('helper/status', { refresh });
      setHelper(s);
      setHelperError(s.error ?? '');
      return s;
    } catch (e) {
      setHelperError(errText(e));
      setHelper((h) => h ?? { installed: false, binaries: [], models: [] });
      return null;
    }
  }, []);

  const refreshEngines = useCallback(() => {
    rpc('speech/status', {})
      .then((s) => setEngines(s.engines))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void refreshHelper(false);
    refreshEngines();
  }, [refreshHelper, refreshEngines]);

  // W12: poll every 2 s until the helper shows up.
  useEffect(() => {
    if (helper === null || installed) return;
    const t = setInterval(() => void refreshHelper(true), 2000);
    return () => clearInterval(t);
  }, [helper, installed, refreshHelper]);

  useEffect(() => {
    if (!installed) return;
    refreshEngines();
    rpc('helper/catalog', {})
      .then((c) => {
        setCatalog(c);
        setCatalogError('');
      })
      .catch((e) => setCatalogError(errText(e)));
  }, [installed, refreshEngines]);

  useEffect(
    () =>
      onRedlineEvent((e) => {
        if (e.type !== 'helper/downloadProgress') return;
        setDownloads((d) => ({
          ...d,
          [e.catalogId]: { receivedBytes: e.receivedBytes, totalBytes: e.totalBytes, phase: e.phase },
        }));
      }),
    [],
  );

  const rescan = async () => {
    setRescanning(true);
    await refreshHelper(true);
    setRescanning(false);
  };

  const chooseModel = (id: string) => void update({ voice: { ...settings.voice, modelId: id } });

  const startDownload = async (entry: CatalogEntry) => {
    setDownloadError(({ [entry.catalogId]: _, ...rest }) => rest);
    setDownloads((d) => ({ ...d, [entry.catalogId]: { receivedBytes: 0, totalBytes: entry.sizeBytes, phase: 'starting' } }));
    try {
      const model = await rpc('helper/download', { catalogId: entry.catalogId });
      await refreshHelper(true);
      if (!settings.voice.modelId) chooseModel(model.id);
    } catch (e) {
      const msg = errText(e);
      if (!/cancel/i.test(msg)) setDownloadError((d) => ({ ...d, [entry.catalogId]: msg }));
    } finally {
      setDownloads(({ [entry.catalogId]: _, ...rest }) => rest);
    }
  };

  const cancelDownload = (catalogId: string) => {
    rpc('helper/cancelDownload', { catalogId }).catch((e) => setDownloadError((d) => ({ ...d, [catalogId]: errText(e) })));
  };

  const nativeStatus = engines.find((e) => e.id === 'native');
  const chromeStatus = engines.find((e) => e.id === 'chrome');
  const models = helper?.models ?? [];
  const installedIds = new Set(models.map((m) => m.id));
  const selectedModel = models.find((m) => m.id === settings.voice.modelId);
  const englishOnly = selectedModel ? /\.en\b/i.test(selectedModel.id) : false;

  return (
    <div className="flex flex-col gap-5">
      {helper && !installed && (
        <HelperSetup
          mic={mic}
          error={helperError}
          onUseChrome={() => void update({ voice: { ...settings.voice, engine: 'chrome' } })}
        />
      )}

      <Card title="Voice">
        <Field label="Engine">
          <div role="radiogroup" aria-label="Speech engine">
            <Radio
              name="engine"
              checked={settings.voice.engine === 'native'}
              onChange={() => void update({ voice: { ...settings.voice, engine: 'native' } })}
            >
              Local helper{' '}
              <span className="ml-1 inline-flex items-center gap-1.5 text-xs text-rl-muted">
                <StatusDot tone={installed ? 'ok' : helper ? 'warn' : 'idle'} />
                {helper === null ? 'checking…' : installed ? 'connected' : 'not installed'}
              </span>
              <span className="block text-xs text-rl-muted">
                {nativeStatus?.available ? nativeStatus.label : (nativeStatus?.detail ?? 'Runs a speech model on your machine. Nothing leaves it.')}
              </span>
            </Radio>
            <Radio
              name="engine"
              checked={settings.voice.engine === 'chrome'}
              onChange={() => void update({ voice: { ...settings.voice, engine: 'chrome' } })}
            >
              Chrome on-device speech
              <span className="block text-xs text-rl-muted">
                {chromeStatus ? (chromeStatus.available ? chromeStatus.label : (chromeStatus.detail ?? 'Unavailable')) : 'No helper needed; quality varies.'}
              </span>
            </Radio>
          </div>
        </Field>

        {installed && (
          <>
            <Field label="Installed on this machine">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-rl-muted">{binarySummary(helper?.binaries ?? [])}</span>
                <Button onClick={() => void rescan()} disabled={rescanning}>
                  <span aria-hidden="true" className={cn(rescanning && 'animate-spin')}>↻</span> Rescan
                </Button>
              </div>
              {models.length === 0 ? (
                <p className="py-1 text-rl-muted">No models found. Download one below.</p>
              ) : (
                <div role="radiogroup" aria-label="Installed models" className="rounded-md border border-rl-line bg-rl-ink px-3 py-1">
                  {models.map((m) => (
                    <ModelRow key={m.id} model={m} checked={settings.voice.modelId === m.id} onChoose={() => chooseModel(m.id)} />
                  ))}
                </div>
              )}
              {models.length > 0 && !selectedModel && (
                <p className="mt-1.5 text-xs text-rl-warn">Pick the model to use for dictation.</p>
              )}
            </Field>

            <Field label="Download a model">
              {catalogError && <p className="text-xs text-rl-accent-2">Couldn&apos;t load the catalog: {catalogError}</p>}
              <ul className="divide-y divide-rl-line rounded-md border border-rl-line bg-rl-ink">
                {catalog.map((c) => (
                  <CatalogRow
                    key={c.catalogId}
                    entry={c}
                    installed={installedIds.has(`${c.engine}:${c.fileName}`)}
                    download={downloads[c.catalogId]}
                    error={downloadError[c.catalogId]}
                    onGet={() => void startDownload(c)}
                    onCancel={() => cancelDownload(c.catalogId)}
                  />
                ))}
              </ul>
            </Field>
          </>
        )}

        <Field
          label="Language"
          hint={englishOnly && settings.voice.language !== 'en' ? '⚠ The selected model is English-only. Pick a multilingual model for other languages.' : undefined}
        >
          <select
            aria-label="Language"
            value={settings.voice.language}
            onChange={(e) => void update({ voice: { ...settings.voice, language: e.target.value } })}
            className="rounded-md border border-rl-line bg-rl-ink px-2.5 py-1.5 text-sm text-rl-text focus-visible:outline-2 focus-visible:outline-rl-accent-2"
          >
            {LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
            {!LANGUAGES.some(([c]) => c === settings.voice.language) && <option value={settings.voice.language}>{settings.voice.language}</option>}
          </select>
        </Field>

        <Field label="Dictate shortcut" hint={<>Change it under <a className="underline" href="#shortcuts">Shortcuts</a>.</>}>
          <span className="inline-block rounded-md border border-rl-line bg-rl-ink px-3 py-1.5 font-mono text-sm">
            {formatShortcut(settings.shortcuts.dictate, isMac())}
          </span>
        </Field>

        <Field label="Microphone" hint="Checks permission and that the mic picks up sound. Nothing is transcribed or saved.">
          <div className="flex flex-wrap items-center gap-3">
            {mic.permission === 'granted' ? (
              <span className="text-sm text-rl-ok">✓ Access granted</span>
            ) : (
              <Button onClick={() => void mic.grant()} disabled={mic.busy}>
                Grant mic access
              </Button>
            )}
            <Button onClick={() => void micTest.start()} disabled={micTest.state.phase === 'recording'}>
              ▶ Test mic
            </Button>
          </div>
          {mic.error && <p className="mt-2 text-xs text-rl-accent-2">{mic.error}</p>}
          <MicMeter state={micTest.state} />
        </Field>
      </Card>
    </div>
  );
}

function binarySummary(binaries: BinaryInfo[]): string {
  if (binaries.length === 0) return 'No speech engines found (whisper.cpp / parakeet).';
  return binaries.map((b) => `${b.engine}${b.version ? ` ${b.version}` : ''}`).join(' · ');
}

function ModelRow({ model, checked, onChoose }: { model: ModelInfo; checked: boolean; onChoose: () => void }) {
  return (
    <Radio name="model" checked={checked} onChange={onChoose}>
      <span className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-medium">{model.label}</span>
        <span className="text-xs text-rl-muted">{formatBytes(model.sizeBytes)}</span>
        <span className="text-xs text-rl-muted">
          {model.source}
          {model.readOnly ? ' (read-only)' : ''}
        </span>
        {!model.tested && <span className="text-xs text-rl-warn">⚠ untested</span>}
      </span>
    </Radio>
  );
}

function CatalogRow({
  entry,
  installed,
  download,
  error,
  onGet,
  onCancel,
}: {
  entry: CatalogEntry;
  installed: boolean;
  download?: DownloadState;
  error?: string;
  onGet: () => void;
  onCancel: () => void;
}) {
  const pct = download && download.totalBytes > 0 ? Math.min(100, Math.round((download.receivedBytes / download.totalBytes) * 100)) : 0;
  const verifying = download?.phase === 'verifying';
  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="font-medium">{entry.label}</span>
          <span className="ml-3 text-xs text-rl-muted">{formatBytes(entry.sizeBytes)}</span>
          <span className="ml-3 text-xs text-rl-muted">{entry.note}</span>
        </span>
        {installed ? (
          <span className="text-xs text-rl-ok">✓ Installed</span>
        ) : download ? (
          <Button onClick={onCancel}>Cancel</Button>
        ) : (
          <Button onClick={onGet} aria-label={`Get ${entry.label}`}>
            ⬇ Get
          </Button>
        )}
      </div>
      {download && (
        <div className="mt-2 flex items-center gap-3">
          <div
            role="progressbar"
            aria-label={`Downloading ${entry.label}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={verifying ? 100 : pct}
            className="h-2 flex-1 overflow-hidden rounded-full bg-rl-line"
          >
            <div className="h-full bg-rl-accent transition-[width]" style={{ width: `${verifying ? 100 : pct}%` }} />
          </div>
          <span className="w-44 shrink-0 text-right text-xs text-rl-muted">
            {verifying ? 'verifying checksum…' : download.phase === 'starting' ? 'starting…' : `${pct}%`}
          </span>
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-rl-accent-2">{error}</p>}
    </li>
  );
}

function MicMeter({ state }: { state: ReturnType<typeof useMicTest>['state'] }) {
  if (state.phase === 'idle') return null;
  if (state.phase === 'error') return <p className="mt-2 text-xs text-rl-accent-2">{state.message}</p>;
  const level = state.phase === 'recording' ? state.level : state.peak;
  return (
    <div className="mt-3">
      <div
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        className="h-2.5 w-full max-w-[320px] overflow-hidden rounded-full bg-rl-line"
      >
        <div
          className={cn('h-full transition-[width] duration-75', level > 0.85 ? 'bg-rl-warn' : 'bg-rl-ok')}
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-rl-muted">
        {state.phase === 'recording'
          ? `Listening… speak now (${state.secondsLeft}s)`
          : state.peak >= MIC_HEARD_THRESHOLD
            ? '✓ Mic works. Sound was picked up.'
            : '⚠ No sound detected. Check the input device and your system volume settings.'}
      </p>
    </div>
  );
}

function HelperSetup({
  mic,
  error,
  onUseChrome,
}: {
  mic: ReturnType<typeof useMicPermission>;
  error: string;
  onUseChrome: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the command is selectable text too */
    }
  };
  return (
    <Card title="Set up local voice" className="border-rl-accent/40">
      <p className="text-rl-muted">
        Redline transcribes on your machine. A small helper program runs the speech model. Chrome starts it only while you dictate.
      </p>
      <ol className="mt-4 flex flex-col gap-4">
        <li>
          <p className="mb-1.5">
            <b>1.</b> Run once in Terminal:
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 select-all overflow-x-auto rounded-md border border-rl-line bg-rl-ink px-3 py-2 font-mono text-xs">
              {INSTALL_COMMAND}
            </code>
            <Button onClick={() => void copy()} aria-label="Copy install command">
              {copied ? '✓ Copied' : '⧉'}
            </Button>
          </div>
        </li>
        <li>
          <p className="mb-1.5">
            <b>2.</b> Allow microphone access
          </p>
          {mic.permission === 'granted' ? (
            <span className="text-sm text-rl-ok">✓ Access granted</span>
          ) : (
            <Button onClick={() => void mic.grant()} disabled={mic.busy}>
              Grant mic access
            </Button>
          )}
          {mic.error && <p className="mt-1.5 text-xs text-rl-accent-2">{mic.error}</p>}
        </li>
        <li>
          <p>
            <b>3.</b> <StatusDot tone="warn" /> Waiting for helper…{' '}
            <span className="text-xs text-rl-muted">(checks every 2 s, updates on its own)</span>
          </p>
          {error && <p className="mt-1 text-xs text-rl-muted">{error}</p>}
        </li>
      </ol>
      <p className="mt-4 border-t border-rl-line pt-3 text-rl-muted">
        Not now? <Button variant="ghost" className="text-rl-text underline" onClick={onUseChrome}>Use Chrome on-device speech instead</Button>
      </p>
    </Card>
  );
}
