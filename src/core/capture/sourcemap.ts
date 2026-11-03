/**
 * Minimal source-map reader. React 19 reports where an element was created through
 * `Error.stack`, and V8 stack positions refer to the TRANSFORMED module the dev server sent
 * (types stripped, helper code injected), so line numbers drift from the file on disk. Dev
 * servers such as Vite inline the source map in that module, so we can map the position back.
 * Pure (no DOM, no fetch) apart from the injected `fetchText`.
 */
import type { SourceLocation } from '../schema';

export interface SourceMapLike {
  sources?: string[];
  mappings?: string;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode one generated line's segments: [genCol, srcIdx, srcLine, srcCol] (absolute values). */
function decodeSegments(mappings: string): Array<Array<[number, number, number, number]>> {
  const lines: Array<Array<[number, number, number, number]>> = [];
  let srcIdx = 0;
  let srcLine = 0;
  let srcCol = 0;
  for (const lineStr of mappings.split(';')) {
    const segs: Array<[number, number, number, number]> = [];
    let genCol = 0;
    for (const seg of lineStr.split(',')) {
      if (!seg) continue;
      const fields: number[] = [];
      let value = 0;
      let shift = 0;
      for (const ch of seg) {
        const digit = B64.indexOf(ch);
        if (digit < 0) break;
        value += (digit & 31) << shift;
        if (digit & 32) {
          shift += 5;
        } else {
          fields.push(value & 1 ? -(value >> 1) : value >> 1);
          value = 0;
          shift = 0;
        }
      }
      if (fields.length < 4) {
        if (fields.length >= 1) genCol += fields[0]!;
        continue;
      }
      genCol += fields[0]!;
      srcIdx += fields[1]!;
      srcLine += fields[2]!;
      srcCol += fields[3]!;
      segs.push([genCol, srcIdx, srcLine, srcCol]);
    }
    lines.push(segs);
  }
  return lines;
}

/** Map a 1-based generated line / column to the original 1-based line / column. */
export function originalPosition(map: SourceMapLike, line: number, column: number): { line: number; column: number } | undefined {
  if (!map.mappings || line < 1) return undefined;
  const lines = decodeSegments(map.mappings);
  const segs = lines[line - 1];
  if (!segs?.length) return undefined;
  const genCol = Math.max(0, column - 1);
  let best: [number, number, number, number] | undefined;
  for (const s of segs) {
    if (s[0] <= genCol) best = s;
    else break;
  }
  best ??= segs[0];
  return best ? { line: best[2] + 1, column: best[3] + 1 } : undefined;
}

/** Extract the source map referenced by a module's trailing `//# sourceMappingURL=` comment. */
export async function loadSourceMap(
  moduleUrl: string,
  code: string,
  fetchText: (url: string) => Promise<string>,
): Promise<SourceMapLike | undefined> {
  const m = /\/\/[#@]\s*sourceMappingURL=([^\s]+)\s*$/.exec(code.trimEnd());
  if (!m) return undefined;
  const ref = m[1]!;
  try {
    if (ref.startsWith('data:')) {
      const comma = ref.indexOf(',');
      const meta = ref.slice(0, comma);
      const body = ref.slice(comma + 1);
      const text = /;base64/i.test(meta) ? new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))) : decodeURIComponent(body);
      return JSON.parse(text) as SourceMapLike;
    }
    return JSON.parse(await fetchText(new URL(ref, moduleUrl).href)) as SourceMapLike;
  } catch {
    return undefined;
  }
}

/** `http(s)://…/file.tsx:12:5`-style raw locations produced from stack frames. */
const STACK_RAW = /^(https?:\/\/.+?):(\d+):(\d+)$/;

/**
 * Replace the line/column of stack-derived locations with the position in the original file.
 * Locations whose `raw` is not an http(s) stack frame (React <= 18 `_debugSource`, Vue/Svelte
 * metadata) are already exact and returned unchanged. Never throws; falls back to the input.
 */
export async function resolveStackLocations(
  locations: Array<SourceLocation | undefined>,
  fetchText: (url: string) => Promise<string>,
  cache: Map<string, Promise<SourceMapLike | undefined>>,
): Promise<Map<SourceLocation, SourceLocation>> {
  const out = new Map<SourceLocation, SourceLocation>();
  await Promise.all(
    locations.map(async (loc) => {
      if (!loc?.raw || out.has(loc)) return;
      const m = STACK_RAW.exec(loc.raw);
      if (!m) return;
      const url = m[1]!; // keep ?t= : it is part of the module id
      let pending = cache.get(url);
      if (!pending) {
        pending = fetchText(url).then((code) => loadSourceMap(url, code, fetchText)).catch(() => undefined);
        cache.set(url, pending);
      }
      const map = await pending;
      if (!map) return;
      const pos = originalPosition(map, Number(m[2]), Number(m[3]));
      if (pos) out.set(loc, { ...loc, line: pos.line, column: pos.column });
    }),
  );
  return out;
}
