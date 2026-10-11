import { withStuntDouble } from 'stunt-double/webpack';

// withStuntDouble() wraps Gatsby's final webpack config for every stage (develop, develop-html,
// build-javascript, build-html): it validates src/overrides, aliases each @acme/core-slots/<Slot> to its
// generated shim, runs the contract type check and the bundle audit, and reports every injection mistake
// through compilation.errors (non-zero exit in `gatsby build`, error overlay in `gatsby develop`).
export const onCreateWebpackConfig = ({ actions, getConfig }) => {
  actions.replaceWebpackConfig(withStuntDouble(getConfig()));
};
