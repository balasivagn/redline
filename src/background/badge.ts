/** Toolbar badge = number of comments on the tab's page. */
import { pageKeyFor } from '../core/page-key';
import type { AnnotationRepo } from '../core/storage';
import { isInjectableUrl } from './inject';

export const BADGE_COLOR = '#e5484d';

export function createBadge(deps: { repo: Pick<AnnotationRepo, 'list'> }) {
  async function setText(tabId: number, text: string): Promise<void> {
    try {
      await chrome.action.setBadgeText({ tabId, text });
      if (text) await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
    } catch { /* tab closed */ }
  }

  async function updateTab(tabId: number, url: string | undefined): Promise<void> {
    if (!isInjectableUrl(url)) return setText(tabId, '');
    try {
      const count = (await deps.repo.list(pageKeyFor(url!))).length;
      await setText(tabId, count > 0 ? String(count) : '');
    } catch { /* storage or page-key failure: leave badge as is */ }
  }

  return {
    updateTab,
    async updateTabById(tabId: number): Promise<void> {
      try {
        const tab = await chrome.tabs.get(tabId);
        await updateTab(tabId, tab.url);
      } catch { /* gone */ }
    },
    /** After annotation writes: refresh every tab on one of the changed pages. */
    async updateForPageKeys(pageKeys: string[]): Promise<void> {
      const keys = new Set(pageKeys);
      const tabs = await chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[]);
      await Promise.all(
        tabs.map(async (t) => {
          if (t.id === undefined || !isInjectableUrl(t.url)) return;
          try {
            if (keys.has(pageKeyFor(t.url!))) await updateTab(t.id, t.url);
          } catch { /* ignore */ }
        }),
      );
    },
  };
}
