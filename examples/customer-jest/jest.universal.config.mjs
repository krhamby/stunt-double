// Universal tier (not this project's default setup; tests/jest.test.mjs covers it): NO stunt-double code in the
// Jest config. It needs @acme/core-slots LINKED to ./sdk-slots (package.json "file:./sdk-slots" instead of the
// registry placeholder); jest-resolve then follows the symlink to the generated shims. Nothing validates here,
// so chain the check: `stunt-double check && jest -c jest.universal.config.mjs`. Without the link, every test
// file fails on the placeholder's STUNT-DOUBLE-NOT-WIRED import.
export default {
  testEnvironment: 'jsdom',
  // Transform the ESM SDK, and the slot package too: if the link is ever missing, Jest then prints the registry
  // placeholder's "STUNT-DOUBLE-NOT-WIRED -- run npx stunt-double doctor" instead of a generic ESM error.
  transformIgnorePatterns: ['/node_modules/(?!(\\.pnpm/[^/]+/node_modules/)?@acme/core(-slots)?/)'],
};
