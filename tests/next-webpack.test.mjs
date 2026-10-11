// Next.js 16 with webpack (`next build --webpack`). See tests/next.shared.mjs.
import { nextSuite } from './next.shared.mjs';

nextSuite({ name: 'next-webpack', build: 'next build --webpack' });
