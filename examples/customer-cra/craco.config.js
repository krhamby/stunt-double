const { withStuntDouble } = require('stunt-double/webpack');

// withStuntDouble() is the whole setup: it validates src/overrides at every start and rebuild, generates
// .stunt-double/ (self-ignoring), aliases each @acme/core-slots/<Slot> to its generated shim, runs the contract
// type check and the bundle audit, and reports every injection mistake through compilation.errors (non-zero
// exit in `craco build`, overlay in `craco start`).
module.exports = {
  webpack: {
    configure: (config, { env }) => withStuntDouble(config, { mode: env, root: __dirname }),
  },
};
