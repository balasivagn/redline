import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

let logFile: string | null = null;
const MAX_LOG_BYTES = 1024 * 1024;

export function setLogFile(path: string | null): void {
  logFile = path;
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (statSync(path).size > MAX_LOG_BYTES) renameSync(path, `${path}.1`);
  } catch {
    // missing file or unwritable dir: logging stays best-effort
  }
}

/** Never writes to stdout: that stream carries only framed native-messaging replies. */
export function log(message: string, extra?: unknown): void {
  if (!logFile) return;
  let line = `${new Date().toISOString()} ${message}`;
  if (extra !== undefined) {
    line += ' ' + (extra instanceof Error ? extra.stack ?? extra.message : safeJson(extra));
  }
  try {
    appendFileSync(logFile, line + '\n');
  } catch {
    // ignore
  }
}

function safeJson(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Route stray console output to the log so it can never corrupt the protocol stream. */
export function redirectConsole(): void {
  const to = (...args: unknown[]): void => log(args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' '));
  console.log = to;
  console.info = to;
  console.warn = to;
  console.error = to;
  console.debug = to;
}
