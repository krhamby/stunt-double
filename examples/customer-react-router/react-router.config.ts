import type { Config } from '@react-router/dev/config';

// Prerender "/" at build time: build/client/index.html is the page the render probe reads.
export default {
  ssr: true,
  prerender: ['/'],
} satisfies Config;
