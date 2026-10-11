// Universal tier: NO stunt-double code in the Jest config. @acme/core-slots is linked to ./sdk-slots
// (package.json "file:./sdk-slots") and jest-resolve follows the symlink to the generated shims. Nothing
// validates here, so the script MUST chain it: `stunt-double check && jest -c jest.universal.config.mjs`.
export default {
  testEnvironment: 'jsdom',
  // Transform the ESM SDK, and the slot package too: if the link is ever missing, Jest then prints the registry
  // placeholder's "STUNT-DOUBLE-NOT-WIRED -- run npx stunt-double doctor" instead of a generic ESM error.
  transformIgnorePatterns: ['/node_modules/(?!(\\.pnpm/[^/]+/node_modules/)?@acme/core(-slots)?/)'],
};
