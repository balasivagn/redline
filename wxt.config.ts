import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, existsSync } from 'node:fs';

// Stable dev key → stable extension ID (oodbmobigjfjcjmjmbaihhpljakkmmgh), which the
// native voice helper's host manifest must list in allowed_origins.
const keyFile = new URL('./.keys/pub.b64', import.meta.url);
const key = existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : undefined;

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // Dev-only live-reload server. Pinned off 3000 so it never collides with the apps being reviewed.
  dev: { server: { port: 3917, origin: 'http://localhost:3917' } },
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'Redline',
    description: 'Review any page: pin comments, dictate locally, copy for coding agents.',
    ...(key ? { key } : {}),
    permissions: [
      'storage',
      'unlimitedStorage',
      'scripting',
      'activeTab',
      'tabs',
      'offscreen',
      'nativeMessaging',
      'webNavigation',
    ],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Redline: toggle review mode' },
    commands: {
      'toggle-redline': {
        suggested_key: { default: 'Ctrl+Shift+Period', mac: 'Command+Shift+Period' },
        description: 'Turn Redline on/off for this page',
      },
    },
  },
});
