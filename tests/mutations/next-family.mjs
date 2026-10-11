// Scenarios that only exist for Next.js: they edit next.config.mjs (suite.toolConfig), which must wrap its config
// in withStuntDouble({ ... }). Shared by every suite with family 'next' (Turbopack and --webpack).

/** Add `snippet` (object members) to the config object passed to withStuntDouble(). */
function addToNextConfig(fx, suite, snippet) {
  fx.edit(suite.toolConfig, (s) => {
    const anchor = /withStuntDouble\(\s*\{/;
    if (!anchor.test(s)) throw new Error(`${suite.toolConfig}: no \`withStuntDouble({\` to extend`);
    return s.replace(anchor, (m) => `${m} ${snippet},`);
  });
}

export default [
  {
    id: 'F6c-server-external',
    title: 'serverExternalPackages lists the SDK: the server would load it natively, without the overrides',
    family: 'next',
    catches: 'CFG (config load)',
    tags: ['cfg'],
    apply: (fx, suite) => addToNextConfig(fx, suite, `serverExternalPackages: ['@acme/core']`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F6\][^\n]*serverExternalPackages lists @acme\/core/] },
  },
  {
    // The adapter runs its own contract gate when `next build` loads the config: Next's ignoreBuildErrors
    // (which only skips Next's own type check) cannot skip it.
    id: 'X1-ignore-build-errors',
    title: 'typescript.ignoreBuildErrors does not skip the contract check (F1 still fails next build)',
    family: 'next',
    catches: 'TYP (adapter gate at config load)',
    tags: ['typegate', 'config'],
    apply: (fx, suite) => {
      addToNextConfig(fx, suite, `typescript: { ignoreBuildErrors: true }`);
      fx.write(fx.override('formatPrice.ts'), `export const formatPrice = (amount: number) => Math.round(amount * 100);\n`);
    },
    expect: { outcome: 'fail', command: 'build', messages: [/\[F1\] formatPrice \([^)\n]*formatPrice\.ts\): does not fit the contract/] },
  },
];
