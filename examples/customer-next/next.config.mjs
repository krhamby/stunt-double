import { withStuntDouble } from 'stunt-double/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

// withStuntDouble() is the whole setup: it validates src/overrides at every start (a mistake fails `next build`
// and `next dev`), generates .stunt-double/ (self-ignoring), aliases @acme/core-slots/* to the generated shims for
// Turbopack and webpack, type-checks the slot contracts in `next build`, and watches the overrides in `next dev`.
export default withStuntDouble(nextConfig);
