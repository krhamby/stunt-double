// A React Native project's metro.config.js, unchanged except for the withStuntDouble() wrapper.
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withStuntDouble } = require('stunt-double/metro');

// This fixture renders with react-dom/server instead of a device, so it has no `react-native` package:
// skip RN's setup-env prelude. A real app keeps the defaults and only adds withStuntDouble().
const fixture = { serializer: { getModulesRunBeforeMainModule: () => [] } };

// withStuntDouble(): validates src/overrides at config load (a mistake fails `metro build`, `react-native
// bundle`, `expo export`), resolves @acme/core-slots/* to the generated shims, runs the contract type check in
// one-shot bundle commands and audits the bundled module graph.
module.exports = withStuntDouble(mergeConfig(getDefaultConfig(__dirname), fixture));
