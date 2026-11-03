import { migrateAnnotation, pageRecordSchema } from '../schema';
import type { Annotation, PageRecord, PageSummary } from '../schema';

export interface AnnotationRepo {
  list(pageKey: string): Promise<Annotation[]>;
  listAll(): Promise<PageSummary[]>;
  listPages(pageKeys: string[]): Promise<Annotation[]>;
  /** Insert or update by id. number 0 → assign the page's next number. Sets updatedAt. */
  save(annotation: Annotation): Promise<Annotation>;
  delete(ids: string[]): Promise<Annotation[]>;
  restore(annotations: Annotation[]): Promise<number>;
}

const PAGE_PREFIX = 'page:';
const recordShellSchema = pageRecordSchema.omit({ annotations: true });

const pageStorageKey = (pageKey: string) => `${PAGE_PREFIX}${pageKey}`;
const byNumber = (a: Annotation, b: Annotation) => a.number - b.number;

/**
 * Validate a stored record leniently: a corrupt annotation is skipped (with a warning)
 * instead of poisoning the whole page. A corrupt record shell yields undefined.
 */
function parseRecord(key: string, raw: unknown): PageRecord | undefined {
  const shell = recordShellSchema.safeParse(raw);
  if (!shell.success) {
    console.warn(`[redline] ignoring invalid page record "${key}"`, shell.error.message);
    return undefined;
  }
  const rawList = (raw as { annotations?: unknown }).annotations;
  const annotations: Annotation[] = [];
  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      try {
        annotations.push(migrateAnnotation(item));
      } catch (error) {
        console.warn(`[redline] skipping invalid annotation in "${key}"`, error);
      }
    }
  }
  return { ...shell.data, annotations };
}

function pageFields(annotation: Annotation) {
  const { url, origin, path, title } = annotation.page;
  return { url, origin, path, title };
}

/** chrome.storage.local-backed repo. Keys: `page:<pageKey>` → PageRecord. */
export function createAnnotationRepo(area: chrome.storage.StorageArea = chrome.storage.local): AnnotationRepo {
  // All reads and writes run through one promise chain so read-modify-write cycles never interleave.
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  }

  async function readRecord(pageKey: string): Promise<PageRecord | undefined> {
    const key = pageStorageKey(pageKey);
    const stored = (await area.get(key)) as Record<string, unknown>;
    if (stored[key] === undefined) return undefined;
    return parseRecord(key, stored[key]);
  }

  async function readAllRecords(): Promise<PageRecord[]> {
    const stored = (await area.get(null)) as Record<string, unknown>;
    const records: PageRecord[] = [];
    for (const [key, value] of Object.entries(stored)) {
      if (!key.startsWith(PAGE_PREFIX)) continue;
      const record = parseRecord(key, value);
      if (record) records.push(record);
    }
    return records;
  }

  async function writeRecord(record: PageRecord): Promise<void> {
    if (record.annotations.length === 0) {
      await area.remove(pageStorageKey(record.pageKey));
    } else {
      await area.set({ [pageStorageKey(record.pageKey)]: record });
    }
  }

  function emptyRecord(annotation: Annotation, now: string): PageRecord {
    return { pageKey: annotation.pageKey, ...pageFields(annotation), updatedAt: now, nextNumber: 1, annotations: [] };
  }

  return {
    list: (pageKey) =>
      enqueue(async () => {
        const record = await readRecord(pageKey);
        return record ? [...record.annotations].sort(byNumber) : [];
      }),

    listAll: () =>
      enqueue(async () => {
        const records = await readAllRecords();
        return records
          .filter((r) => r.annotations.length > 0)
          .map<PageSummary>((r) => ({
            pageKey: r.pageKey,
            url: r.url,
            origin: r.origin,
            path: r.path,
            title: r.title,
            count: r.annotations.length,
            updatedAt: r.updatedAt,
          }))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }),

    listPages: (pageKeys) =>
      enqueue(async () => {
        const out: Annotation[] = [];
        for (const pageKey of pageKeys) {
          const record = await readRecord(pageKey);
          if (record) out.push(...[...record.annotations].sort(byNumber));
        }
        return out;
      }),

    save: (annotation) =>
      enqueue(async () => {
        const now = new Date().toISOString();
        const record = (await readRecord(annotation.pageKey)) ?? emptyRecord(annotation, now);
        const index = record.annotations.findIndex((a) => a.id === annotation.id);
        const existing = index >= 0 ? record.annotations[index] : undefined;

        let number = annotation.number;
        if (existing) {
          if (number <= 0) number = existing.number;
        } else if (number <= 0 || record.annotations.some((a) => a.number === number)) {
          number = record.nextNumber;
        }

        const stored = migrateAnnotation({
          ...annotation,
          number,
          createdAt: existing?.createdAt ?? (annotation.createdAt || now),
          updatedAt: now,
        });

        if (index >= 0) record.annotations[index] = stored;
        else record.annotations.push(stored);

        record.nextNumber = Math.max(record.nextNumber, number + 1);
        Object.assign(record, pageFields(annotation));
        record.updatedAt = now;
        await writeRecord(record);
        return stored;
      }),

    delete: (ids) =>
      enqueue(async () => {
        const wanted = new Set(ids);
        const deleted: Annotation[] = [];
        if (wanted.size === 0) return deleted;
        const now = new Date().toISOString();
        for (const record of await readAllRecords()) {
          const removed = record.annotations.filter((a) => wanted.has(a.id));
          if (removed.length === 0) continue;
          deleted.push(...removed);
          record.annotations = record.annotations.filter((a) => !wanted.has(a.id));
          record.updatedAt = now;
          await writeRecord(record);
        }
        return deleted;
      }),

    restore: (annotations) =>
      enqueue(async () => {
        const byPage = new Map<string, Annotation[]>();
        for (const annotation of annotations) {
          const group = byPage.get(annotation.pageKey);
          if (group) group.push(annotation);
          else byPage.set(annotation.pageKey, [annotation]);
        }
        const now = new Date().toISOString();
        let restored = 0;
        for (const [pageKey, group] of byPage) {
          const first = group[0];
          if (!first) continue;
          const record = (await readRecord(pageKey)) ?? emptyRecord(first, now);
          const known = new Set(record.annotations.map((a) => a.id));
          let added = 0;
          for (const annotation of group) {
            if (known.has(annotation.id)) continue;
            known.add(annotation.id);
            record.annotations.push(migrateAnnotation(annotation));
            record.nextNumber = Math.max(record.nextNumber, annotation.number + 1);
            added++;
          }
          if (added === 0) continue;
          record.annotations.sort(byNumber);
          record.updatedAt = now;
          await writeRecord(record);
          restored += added;
        }
        return restored;
      }),
  };
}
