// webpack 5 + webpack-dev-server: examples/customer-webpack with stunt-double/webpack. See tests/webpack-family/suite.mjs.
import { defineSuite } from './webpack-family/suite.mjs';

defineSuite({
  tool: 'webpack',
  packageName: 'webpack',
  configFile: 'webpack.config.mjs',
  build: ['webpack', '--mode', 'production'],
  dev: ['webpack', 'serve', '--mode', 'development'],
  overlay: '#webpack-dev-server-client-overlay',
});
