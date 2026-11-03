/** One handler for every RpcMap key. The service worker is the only storage writer. */
import type { HelperStatus, RpcMap, RpcRequest, RpcResult, RpcType } from '../core/messages';
import { isRpcRequest } from '../core/messages';
import type { Annotation } from '../core/schema';
import type { AnnotationRepo, ShotStore } from '../core/storage';
import { bytesToBase64 } from '../speech/wav';
import type { EventInput } from './broadcast';
import type { HelperClient } from './helper-client';
import { shotRelPath } from './shot-files';
import type { SettingsStore } from './settings-store';
import type { SpeechController, SpeechTarget } from './speech';

export const SHOT_DELETE_DELAY_MS = 10_000;

export interface RouterDeps {
  repo: AnnotationRepo;
  shots: ShotStore;
  settings: SettingsStore;
  helper: HelperClient;
  speech: SpeechController;
  broadcast(event: EventInput): void | Promise<void>;
  /** Grab the visible tab and crop it. */
  captureShot(args: { windowId: number; rect: RpcMap['shot/capture']['req']['rect']; dpr: number }): Promise<{ blob: Blob; width: number; height: number }>;
  getUrl(path: string): string;
  openTab(url: string): Promise<unknown>;
  /** Called after annotation writes (badge refresh). */
  onAnnotationsChanged?(pageKeys: string[]): void;
}

export interface MessageSenderLike {
  tab?: { id?: number; windowId?: number; url?: string };
  /** URL of the frame that sent the message. */
  url?: string;
}

type Handler<K extends RpcType> = (payload: RpcMap[K]['req'], sender: MessageSenderLike) => Promise<RpcMap[K]['res']>;

const unique = (xs: string[]) => [...new Set(xs)];

export function createRouter(deps: RouterDeps) {
  const { repo, shots, settings, helper, speech } = deps;
  /** shotId → pending delete timer (cancelled when the annotation is restored). */
  const pendingShotDeletes = new Map<string, ReturnType<typeof setTimeout>>();
  /** shotId → saved file path, deleted together with the blob. */
  const pendingFileDeletes = new Map<string, string>();

  const annChanged = (pageKeys: string[]) => {
    const keys = unique(pageKeys);
    void deps.broadcast({ type: 'ann/changed', pageKeys: keys });
    deps.onAnnotationsChanged?.(keys);
  };

  const targetOf = (s: MessageSenderLike): SpeechTarget => s.tab?.id ?? 'extension';

  /** Best effort: write the PNG through the helper. Never fails the capture. */
  async function saveShotFile(blob: Blob, shotId: string, pageUrl: string | undefined): Promise<string | undefined> {
    try {
      if (!(await helper.status()).installed) return undefined;
      const pngBase64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
      const res = await helper.request({ type: 'save-shot', relPath: shotRelPath(pageUrl, shotId), pngBase64 });
      return res.path;
    } catch (e) {
      console.warn('[redline] could not save the screenshot file', e);
      return undefined;
    }
  }

  const handlers: { [K in RpcType]: Handler<K> } = {
    'ann/list': ({ pageKey }) => repo.list(pageKey),
    'ann/listAll': () => repo.listAll(),
    'ann/listPages': ({ pageKeys }) => repo.listPages(pageKeys),

    async 'ann/save'({ annotation }) {
      const saved = await repo.save(annotation);
      annChanged([saved.pageKey]);
      return saved;
    },

    async 'ann/delete'({ ids }) {
      const deleted = await repo.delete(ids);
      for (const a of deleted) {
        const shotId = a.screenshot?.shotId;
        if (!shotId) continue;
        clearTimeout(pendingShotDeletes.get(shotId));
        const path = a.screenshot?.path;
        if (path) pendingFileDeletes.set(shotId, path);
        pendingShotDeletes.set(
          shotId,
          setTimeout(() => {
            pendingShotDeletes.delete(shotId);
            const file = pendingFileDeletes.get(shotId);
            pendingFileDeletes.delete(shotId);
            void shots.delete([shotId]).catch(() => undefined);
            if (file) {
              void helper.request({ type: 'delete-shots', paths: [file] }).catch((e) => console.warn('[redline] could not delete screenshot file', e));
            }
          }, SHOT_DELETE_DELAY_MS),
        );
      }
      if (deleted.length) annChanged(deleted.map((a) => a.pageKey));
      return { deleted };
    },

    async 'ann/restore'({ annotations }) {
      for (const a of annotations) {
        const shotId = a.screenshot?.shotId;
        if (!shotId) continue;
        clearTimeout(pendingShotDeletes.get(shotId));
        pendingShotDeletes.delete(shotId);
        pendingFileDeletes.delete(shotId);
      }
      const restored = await repo.restore(annotations);
      if (annotations.length) annChanged(annotations.map((a: Annotation) => a.pageKey));
      return { restored };
    },

    async 'shot/capture'({ rect, dpr }, sender) {
      const windowId = sender.tab?.windowId;
      if (windowId === undefined) throw new Error('Screenshots need a browser tab.');
      const { blob, width, height } = await deps.captureShot({ windowId, rect, dpr });
      const shotId = await shots.put(blob);
      const path = await saveShotFile(blob, shotId, sender.tab?.url ?? sender.url);
      return { shotId, width, height, ...(path ? { path } : {}) };
    },

    async 'shot/get'({ shotId }) {
      const blob = await shots.get(shotId);
      if (!blob) return null;
      return { dataUrl: `data:${blob.type || 'image/png'};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}` };
    },

    'settings/get': () => settings.get(),
    async 'settings/set'({ patch }) {
      const next = await settings.patch(patch);
      void deps.broadcast({ type: 'settings/changed', settings: next });
      return next;
    },

    async 'site/setEnabled'({ origin, enabled }) {
      const next = await settings.update((cur) => {
        const rest = cur.enabledOrigins.filter((o) => o !== origin);
        return { ...cur, enabledOrigins: enabled ? [...rest, origin] : rest };
      });
      void deps.broadcast({ type: 'settings/changed', settings: next });
      return { enabledOrigins: next.enabledOrigins };
    },

    'speech/status': () => speech.status(),
    async 'speech/start'(_p, sender) {
      await speech.start(targetOf(sender));
      return { ok: true };
    },
    'speech/stop': (_p, sender) => speech.stop(targetOf(sender)),
    async 'speech/cancel'(_p, sender) {
      await speech.cancel(targetOf(sender));
      return { ok: true };
    },

    'helper/status': ({ refresh }): Promise<HelperStatus> => helper.status(refresh),
    'helper/catalog': () => helper.catalog(),
    'helper/download': ({ catalogId }) => helper.download(catalogId),
    async 'helper/cancelDownload'({ catalogId }) {
      await helper.cancelDownload(catalogId);
      return { ok: true };
    },

    async 'open/reviews'({ pageKey }) {
      const base = deps.getUrl('/reviews.html');
      await deps.openTab(pageKey ? `${base}#page=${encodeURIComponent(pageKey)}` : base);
      return { ok: true };
    },
    async 'open/settings'({ section }) {
      const base = deps.getUrl('/options.html');
      await deps.openTab(section ? `${base}#${section}` : base);
      return { ok: true };
    },
  };

  async function handle(req: RpcRequest, sender: MessageSenderLike = {}): Promise<RpcResult<RpcType>> {
    const handler = handlers[req.type] as Handler<RpcType> | undefined;
    if (!handler) return { ok: false, error: `Unknown request: ${String(req.type)}` };
    try {
      return { ok: true, data: await handler(req.payload as never, sender) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** chrome.runtime.onMessage listener. */
  function listener(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void): boolean {
    if (!isRpcRequest(message)) return false;
    void handle(message, sender).then(sendResponse);
    return true;
  }

  return { handle, listener, pendingShotDeletes };
}
