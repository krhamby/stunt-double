import { mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// `vitest run -c vitest.typecheck.config.ts`: the normal config plus the contract type gate as a globalSetup.
export default mergeConfig(viteConfig, { test: { globalSetup: ['./stunt-double.typecheck.ts'] } });
