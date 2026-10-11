// Rspack 2 + @rspack/dev-server: examples/customer-rspack with stunt-double/webpack. See tests/webpack-family/suite.mjs.
import { defineSuite } from './webpack-family/suite.mjs';

defineSuite({
  tool: 'rspack',
  packageName: '@rspack/core',
  configFile: 'rspack.config.mjs',
  build: ['rspack', 'build', '--mode', 'production'],
  dev: ['rspack', 'dev', '--mode', 'development'],
  overlay: '#rspack-dev-server-client-overlay',
});
