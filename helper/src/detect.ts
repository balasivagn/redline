import { constants } from 'node:fs';
import { access, mkdir, open, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import type { BinaryInfo, EngineKind, ModelInfo } from '../protocol';
import type { HelperEnv } from './env';
import { log } from './log';
import { runCommand } from './util';

// ---------------------------------------------------------------- classification

const MIN_MODEL_BYTES = 20 * 1024 * 1024;
/** whisper.cpp ggml files start with the magic 0x67676d6c ("lmgg" little-endian). */
const WHISPER_MAGIC = Buffer.from('lmgg');

export interface Classified {
  engine: EngineKind;
  label: string;
  tested: boolean;
}

/** Decide engine/label/tested from the file name alone. null = not a speech model. */
export function classifyFileName(fileName: string): Classified | null {
  const lower = fileName.toLowerCase();
  if (/silero|vad|coreml|encoder/.test(lower)) return null;
  if (lower.includes('parakeet')) {
    // whisper.cpp's parakeet-cli loads `ggml-parakeet-*.bin`; other containers (.gguf) are untested.
    if (lower.endsWith('.bin')) {
      return { engine: 'parakeet', label: prettyLabel('parakeet', fileName), tested: lower.startsWith('ggml-parakeet') };
    }
    if (lower.endsWith('.gguf')) return { engine: 'parakeet', label: prettyLabel('parakeet', fileName), tested: false };
    return null;
  }
  if (lower.startsWith('ggml-') && lower.endsWith('.bin')) {
    return { engine: 'whisper.cpp', label: prettyLabel('whisper', fileName), tested: true };
  }
  return null;
}

/** "ggml-large-v3-turbo-q5_0.bin" -> "whisper large-v3-turbo q5_0" */
function prettyLabel(prefix: string, fileName: string): string {
  let core = fileName.replace(/\.(bin|gguf)$/i, '').replace(/^ggml-/i, '');
  if (prefix === 'parakeet') core = core.replace(/^parakeet-?/i, '');
  const quant = /[-_](q\d(?:_[0-9a-z]+)?|f16|f32)$/i.exec(core);
  if (quant) core = core.slice(0, quant.index);
  return `${prefix} ${core}${quant ? ' ' + quant[1] : ''}`.trim();
}

export function modelIdFor(engine: EngineKind, fileName: string): string {
  return `${engine}:${fileName}`;
}

async function readMagic(path: string): Promise<Buffer | null> {
  try {
    const fh = await open(path, 'r');
    try {
      const buf = Buffer.alloc(4);
      const { bytesRead } = await fh.read(buf, 0, 4, 0);
      return bytesRead === 4 ? buf : null;
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

/** Build a ModelInfo for one file, or null when it is not a usable model. */
export async function modelInfoForFile(
  path: string,
  source: string,
  readOnly: boolean,
): Promise<ModelInfo | null> {
  const fileName = basename(path);
  const cls = classifyFileName(fileName);
  if (!cls) return null;
  let size: number;
  try {
    const st = await stat(path);
    if (!st.isFile()) return null;
    size = st.size;
  } catch {
    return null;
  }
  if (size < MIN_MODEL_BYTES) return null;
  if (cls.engine === 'whisper.cpp') {
    const magic = await readMagic(path);
    if (!magic || !magic.equals(WHISPER_MAGIC)) return null; // e.g. a llama ggml file
  }
  let tested = cls.tested;
  if (cls.engine === 'parakeet' && tested) {
    // parakeet-cli reads the same ggml container as whisper.cpp; anything else is rejected ("bad magic").
    const magic = await readMagic(path);
    tested = Boolean(magic?.equals(WHISPER_MAGIC));
  }
  return {
    id: modelIdFor(cls.engine, fileName),
    engine: cls.engine,
    label: cls.label,
    path,
    sizeBytes: size,
    source,
    readOnly,
    tested,
  };
}

// ---------------------------------------------------------------- binaries

const BINARY_NAMES: Array<{ engine: EngineKind; names: string[] }> = [
  { engine: 'whisper.cpp', names: ['whisper-cli', 'whisper-cpp'] },
  { engine: 'parakeet', names: ['parakeet-cli'] },
];

async function isExecutable(path: string): Promise<boolean> {
  try {
    const st = await stat(path);
    if (!st.isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findBinary(engine: EngineKind, binDirs: string[]): Promise<BinaryInfo | null> {
  const entry = BINARY_NAMES.find((b) => b.engine === engine);
  if (!entry) return null;
  for (const name of entry.names) {
    for (const dir of binDirs) {
      const candidate = join(dir, name);
      if (await isExecutable(candidate)) {
        return { engine, name, path: candidate, version: await binaryVersion(candidate) };
      }
    }
  }
  return null;
}

const versionCache = new Map<string, string | undefined>();

/** Homebrew path first (free), then a short `--version` probe. */
async function binaryVersion(path: string): Promise<string | undefined> {
  if (versionCache.has(path)) return versionCache.get(path);
  let version: string | undefined;
  try {
    const real = await realpath(path);
    version = /\/Cellar\/[^/]+\/([^/]+)\//.exec(real)?.[1];
  } catch {
    // fall through to probe
  }
  if (!version) {
    try {
      const res = await runCommand([path, '--version'], { timeoutMs: 3000 });
      version = /version[:\s]+v?(\d[\w.+-]*)/i.exec(`${res.stdout}\n${res.stderr}`)?.[1];
    } catch {
      // ignore
    }
  }
  versionCache.set(path, version);
  return version;
}

export async function detectBinaries(env: HelperEnv): Promise<BinaryInfo[]> {
  const found = await Promise.all(BINARY_NAMES.map((b) => findBinary(b.engine, env.binDirs)));
  return found.filter((b): b is BinaryInfo => b !== null);
}

// ---------------------------------------------------------------- models

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', '__pycache__', 'site-packages', '.next', '.nuxt', '.turbo',
  'target', '.cache', '.gradle', 'Pods', '.dart_tool', 'DerivedData', '.pnpm-store', 'coverage',
]);
const READDIR_CONCURRENCY = 24;

interface ScanOptions {
  maxDepth: number;
  deadline: number;
  skipDirs?: Set<string>;
}

/** Bounded breadth-first walk (parallel readdir, never follows symlinked directories). */
async function findCandidateFiles(root: string, opts: ScanOptions): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const skip = opts.skipDirs ?? SKIP_DIRS;
  let truncated = false;
  let level = [root];
  for (let depth = 0; depth <= opts.maxDepth && level.length && !truncated; depth++) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += READDIR_CONCURRENCY) {
      if (Date.now() > opts.deadline) {
        truncated = true;
        break;
      }
      await Promise.all(
        level.slice(i, i + READDIR_CONCURRENCY).map(async (dir) => {
          let entries;
          try {
            entries = await readdir(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const e of entries) {
            if (e.isDirectory()) {
              if (depth < opts.maxDepth && !skip.has(e.name)) next.push(join(dir, e.name));
            } else if ((e.isFile() || e.isSymbolicLink()) && classifyFileName(e.name)) {
              files.push(join(dir, e.name));
            }
          }
        }),
      );
    }
    level = next;
  }
  return { files, truncated };
}

interface ModelRoot {
  dir: string;
  source: string;
  readOnly: boolean;
  maxDepth: number;
}

export interface UserConfig {
  modelDirs: string[];
}

export async function readConfig(env: HelperEnv): Promise<UserConfig> {
  try {
    const raw = JSON.parse(await readFile(env.configFile, 'utf8')) as { modelDirs?: unknown };
    const dirs = Array.isArray(raw.modelDirs) ? raw.modelDirs.filter((d): d is string => typeof d === 'string') : [];
    return { modelDirs: dirs.map((d) => (d.startsWith('~/') ? join(env.home, d.slice(2)) : d)) };
  } catch {
    return { modelDirs: [] };
  }
}

async function quickRoots(env: HelperEnv): Promise<ModelRoot[]> {
  const roots: ModelRoot[] = [{ dir: env.modelsDir, source: 'redline', readOnly: false, maxDepth: 1 }];
  for (const k of env.knownModelDirs) roots.push({ ...k, readOnly: true, maxDepth: 3 });
  try {
    for (const name of await readdir(env.appSupportDir)) {
      if (name.toLowerCase().startsWith('macwhisper')) {
        roots.push({ dir: join(env.appSupportDir, name), source: 'MacWhisper', readOnly: true, maxDepth: 3 });
      }
    }
  } catch {
    // no Application Support dir
  }
  for (const dir of (await readConfig(env)).modelDirs) {
    roots.push({ dir, source: basename(dir) || dir, readOnly: !isInside(dir, env.modelsDir), maxDepth: 3 });
  }
  return roots;
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + sep);
}

const PROJECT_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'];

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Friendly source name for a file under ~/Codes: nearest ancestor that looks like a project. */
export async function projectNameFor(file: string, codesDir: string): Promise<string> {
  let dir = dirname(file);
  while (isInside(dir, codesDir) && dir !== codesDir) {
    for (const marker of PROJECT_MARKERS) {
      if (await exists(join(dir, marker))) return basename(dir);
    }
    dir = dirname(dir);
  }
  const rel = file.slice(codesDir.length + 1);
  return rel.split(sep)[0] || basename(codesDir);
}

interface CacheFile {
  scannedAt: number;
  codesDir: string;
  models: ModelInfo[];
}

async function readCache(env: HelperEnv): Promise<CacheFile | null> {
  try {
    const c = JSON.parse(await readFile(env.cacheFile, 'utf8')) as CacheFile;
    if (typeof c.scannedAt !== 'number' || !Array.isArray(c.models)) return null;
    return c;
  } catch {
    return null;
  }
}

async function writeCache(env: HelperEnv, cache: CacheFile): Promise<void> {
  try {
    await mkdir(env.redlineDir, { recursive: true });
    await writeFile(env.cacheFile, JSON.stringify(cache));
  } catch (e) {
    log('cache write failed', e);
  }
}

async function scanCodes(env: HelperEnv): Promise<ModelInfo[]> {
  const { files, truncated } = await findCandidateFiles(env.codesDir, {
    maxDepth: 5,
    deadline: Date.now() + env.scanBudgetMs,
  });
  if (truncated) log(`codes scan hit its ${env.scanBudgetMs} ms budget; results may be partial`);
  const out: ModelInfo[] = [];
  for (const f of files) {
    const info = await modelInfoForFile(f, await projectNameFor(f, env.codesDir), true);
    if (info) out.push(info);
  }
  return out;
}

export async function detectModels(env: HelperEnv, opts: { fresh?: boolean } = {}): Promise<ModelInfo[]> {
  const all: ModelInfo[] = [];

  for (const root of await quickRoots(env)) {
    const { files } = await findCandidateFiles(root.dir, { maxDepth: root.maxDepth, deadline: Date.now() + 3000 });
    for (const f of files) {
      const info = await modelInfoForFile(f, root.source, root.readOnly);
      if (info) all.push(info);
    }
  }

  let codes: ModelInfo[];
  const cache = opts.fresh ? null : await readCache(env);
  if (cache && cache.codesDir === env.codesDir && Date.now() - cache.scannedAt < env.cacheTtlMs) {
    // trust the cache for discovery, but drop files that have since disappeared
    const alive = await Promise.all(cache.models.map(async (m) => ((await exists(m.path)) ? m : null)));
    codes = alive.filter((m): m is ModelInfo => m !== null);
  } else {
    codes = await scanCodes(env);
    await writeCache(env, { scannedAt: Date.now(), codesDir: env.codesDir, models: codes });
  }
  all.push(...codes);

  // De-duplicate: same real file, or same id (first/most trusted location wins).
  const seenReal = new Set<string>();
  const seenId = new Set<string>();
  const result: ModelInfo[] = [];
  for (const m of all) {
    let real = m.path;
    try {
      real = await realpath(m.path);
    } catch {
      // keep path
    }
    if (seenReal.has(real) || seenId.has(m.id)) continue;
    seenReal.add(real);
    seenId.add(m.id);
    result.push(m);
  }
  return result;
}
