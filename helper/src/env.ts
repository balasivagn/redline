import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const HELPER_VERSION = '0.1.0';

/** Everything that touches the user's machine is rooted here so tests can point it at a temp dir. */
export interface HelperEnv {
  home: string;
  /** ~/.redline (override with REDLINE_HOME). */
  redlineDir: string;
  modelsDir: string;
  /** Saved screenshots: ~/.redline/shots. */
  shotsDir: string;
  logFile: string;
  cacheFile: string;
  configFile: string;
  /** Directories searched for engine binaries, in order (PATH first, then fixed fallbacks). */
  binDirs: string[];
  /** ~/Library/Application Support (parent of the app model folders). */
  appSupportDir: string;
  /** Extra read-only app folders: [dir, source label]. */
  knownModelDirs: Array<{ dir: string; source: string }>;
  /** Root of the bounded recursive scan (~/Codes). */
  codesDir: string;
  tmpDir: string;
  cacheTtlMs: number;
  /** Time budget for the ~/Codes scan. */
  scanBudgetMs: number;
}

export function makeEnv(overrides: Partial<HelperEnv> = {}): HelperEnv {
  const home = overrides.home ?? homedir();
  const redlineDir = overrides.redlineDir ?? process.env['REDLINE_HOME'] ?? join(home, '.redline');
  const appSupportDir = overrides.appSupportDir ?? join(home, 'Library', 'Application Support');
  const pathDirs = (process.env['PATH'] ?? '').split(':').filter(Boolean);
  return {
    home,
    redlineDir,
    modelsDir: join(redlineDir, 'models'),
    shotsDir: join(redlineDir, 'shots'),
    logFile: join(redlineDir, 'helper.log'),
    cacheFile: join(redlineDir, 'cache.json'),
    configFile: join(redlineDir, 'config.json'),
    binDirs: [...new Set([...pathDirs, '/opt/homebrew/bin', '/usr/local/bin'])],
    appSupportDir,
    knownModelDirs: [
      { dir: join(appSupportDir, 'superwhisper'), source: 'superwhisper' },
      { dir: join(appSupportDir, 'hex', 'models'), source: 'hex' },
      { dir: join(home, '.cache', 'whisper'), source: 'whisper' },
    ],
    codesDir: join(home, 'Codes'),
    tmpDir: tmpdir(),
    cacheTtlMs: 10 * 60 * 1000,
    scanBudgetMs: 5000,
    ...overrides,
  };
}
