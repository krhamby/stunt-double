import { withStuntDouble } from 'stunt-double/next';

// withStuntDouble() is the whole setup: it validates src/overrides and runs the contract type check when
// `next build` loads this config (any injection mistake fails the build before compiling), aliases
// @acme/core-slots/* to the generated shims for Turbopack and webpack, and regenerates them live in `next dev`.
export default withStuntDouble({});
