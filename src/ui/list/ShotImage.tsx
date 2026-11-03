import { useEffect, useRef, useState } from 'react';
import { cn } from '../shared/cn';
import { dataUrlToBlob } from './copy';
import { cachedShot, loadShot } from './shots';

/** Data URL for a shotId (loaded lazily through rpc, cached per shotId). */
export function useShotUrl(shotId: string): { url: string | null; state: 'loading' | 'ready' | 'missing' } {
  const [s, setS] = useState<{ id: string; url: string | null; done: boolean }>(() => {
    const url = cachedShot(shotId) ?? null;
    return { id: shotId, url, done: !!url };
  });
  useEffect(() => {
    if (cachedShot(shotId)) {
      setS({ id: shotId, url: cachedShot(shotId) ?? null, done: true });
      return;
    }
    let live = true;
    setS({ id: shotId, url: null, done: false });
    void loadShot(shotId).then((url) => {
      if (live) setS({ id: shotId, url, done: true });
    });
    return () => {
      live = false;
    };
  }, [shotId]);
  const cur = s.id === shotId ? s : { url: null, done: false };
  return { url: cur.url, state: cur.url ? 'ready' : cur.done ? 'missing' : 'loading' };
}

/**
 * The screenshot as an <img>. Some pages' CSP (`img-src`) blocks data: images in the injected UI;
 * when the <img> errors we paint the same bytes into a <canvas>, which CSP does not govern.
 */
export function ShotImage({ shotId, alt, className, testId }: { shotId: string; alt: string; className?: string; testId?: string }) {
  const { url, state } = useShotUrl(shotId);
  const [broken, setBroken] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => setBroken(false), [url]);
  useEffect(() => {
    if (!broken || !url || !canvas.current) return;
    let live = true;
    void createImageBitmap(dataUrlToBlob(url)).then((bmp) => {
      const el = canvas.current;
      if (!live || !el) return bmp.close();
      el.width = bmp.width;
      el.height = bmp.height;
      el.getContext('2d')?.drawImage(bmp, 0, 0);
      bmp.close();
    }).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [broken, url]);

  if (state === 'loading') return <span aria-hidden="true" className={cn('block animate-pulse bg-rl-line/60', className)} />;
  if (!url || state === 'missing') {
    return (
      <span role="img" aria-label="Screenshot unavailable" title="Screenshot unavailable" className={cn('flex items-center justify-center bg-rl-line/40 text-rl-muted', className)}>
        <span aria-hidden="true">🖼</span>
      </span>
    );
  }
  if (broken) return <canvas ref={canvas} role="img" aria-label={alt} className={className} />;
  return <img src={url} alt={alt} draggable={false} data-testid={testId} className={className} onError={() => setBroken(true)} />;
}

/** 56×40 clickable thumbnail used in list rows. */
export function ShotThumb({ shotId, label, onOpen }: { shotId: string; label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      title="View screenshot"
      data-testid="shot-thumb"
      className="block h-10 w-14 shrink-0 overflow-hidden rounded-md border border-rl-line bg-rl-ink-2 hover:border-rl-muted focus-visible:outline-2 focus-visible:outline-rl-accent-2"
    >
      <ShotImage shotId={shotId} alt="" testId="shot-thumb-img" className="h-full w-full object-cover" />
    </button>
  );
}
