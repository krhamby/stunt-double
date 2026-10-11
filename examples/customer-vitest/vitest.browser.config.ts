import { defineConfig, mergeConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import viteConfig from './vite.config.ts';

// Browser mode: the same tests run in real Chromium. Inherits the plugins (stuntDouble included) from vite.config.
// SD_CHROMIUM_PATH: use a preinstalled Chromium instead of the one `npx playwright install chromium` downloads.
const executablePath = process.env.SD_CHROMIUM_PATH || undefined;

export default mergeConfig(
  { ...viteConfig, test: {} },
  defineConfig({
    test: {
      include: ['src/**/*.dom.test.tsx'],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright({ launchOptions: { executablePath } }),
        instances: [{ browser: 'chromium' }],
      },
    },
  }),
);
