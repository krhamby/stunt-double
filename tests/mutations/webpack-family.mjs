// Scenarios that only exist for tools configured like webpack (webpack 5, Rspack 2, Rsbuild, craco, Gatsby,
// Storybook webpackFinal): they edit the tool's own config file (suite.toolConfig), which must contain an SSR
// config with `target: 'node',` and a `resolve: {` object. Shared by every suite with family 'webpack'.

/** Insert `snippet` right after the first match of `anchor` in the tool config (throws if there is none). */
function insertAfter(fx, suite, anchor, snippet) {
  fx.edit(suite.toolConfig, (s) => {
    if (!anchor.test(s)) throw new Error(`${suite.toolConfig}: no ${anchor} to extend`);
    return s.replace(anchor, (m) => `${m}${snippet}`);
  });
}

export default [
  {
    id: 'F6c-externals',
    title: 'the SSR config externalizes the SDK (externals: [/^@acme\\/core/]): Node would load the defaults natively',
    family: 'webpack',
    catches: 'AUD (external module check)',
    tags: ['aud'],
    apply: (fx, suite) => insertAfter(fx, suite, /target:\s*'node',/, `\n    externals: [/^@acme\\/core(\\/|$)/],`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F6\][^\n]*@acme\/core is an external module in this build/] },
  },
  {
    // withStuntDouble() spreads its exact-match aliases over the user's, so the socket alias is inert. Should
    // that ever change, the post-bundle audit must fail the build.
    id: 'F6g-alias-webpack',
    title: 'a user alias aims the Button socket at the SDK default: either inert (adapter alias wins) or [F6] from the audit',
    family: 'webpack',
    catches: 'prevented (alias order) / AUD',
    tags: ['aud'],
    apply: (fx, suite) => insertAfter(fx, suite, /resolve:\s*\{/, ` alias: { '@acme/core-slots/Button$': '@acme/core/original/Button' },`),
    expect: { outcome: 'safe', command: 'build', messages: [/\[F6\][^\n]*(imports the SDK default of slot "Button"|Button\.jsx is not in the bundle)/] },
  },
];
