// Next.js 16 with webpack (`next build --webpack`). See tests/next.shared.mjs. The Next-family scenarios fail at
// config load, before Next picks a bundler: the Turbopack suite (tests/next.test.mjs) runs them.
import { nextSuite } from './next.shared.mjs';

nextSuite({ name: 'next-webpack', build: 'next build --webpack', mutations: (list) => list.filter((m) => m.family !== 'next') });
