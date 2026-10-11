// Scripts and matchers shared by the esbuild / Rollup / Rolldown / Farm extra tests.

export const WATCH_STEPS = ['initial: ok', 'typo: fail [F2]', 'fix-typo: ok', 'contract: fail [F1]', 'fix-contract: ok'];

/** A Rollup-API watch() driver (Rollup and Rolldown): applies each step after the previous build ended. */
export const watchScript = ({ imports, plugins, extra = '' }) => `import fs from 'node:fs';
${imports}
const BTN = fs.readFileSync('src/overrides/Button.tsx', 'utf8');
const steps = [
  ['typo', () => fs.copyFileSync('src/overrides/Button.tsx', 'src/overrides/Buton.tsx')],
  ['fix-typo', () => fs.rmSync('src/overrides/Buton.tsx')],
  ['contract', () => fs.writeFileSync('src/overrides/Button.tsx', BTN.replace("(props: SlotProps['Button'])", "(props: SlotProps['Button'] & { tone: 'loud' })"))],
  ['fix-contract', () => fs.writeFileSync('src/overrides/Button.tsx', BTN)],
];
const w = watch({ input: 'src/entry-server.tsx', external: [/^react/], output: { dir: 'watch-out', format: 'es' }, ${extra}
  plugins: ${plugins}, watch: { buildDelay: 50 } });
let i = -1, name = 'initial', failed = null;
const timer = setTimeout(() => { console.log(name + ': TIMEOUT'); process.exit(1); }, 60000);
w.on('event', (e) => {
  if (e.code === 'START') failed = null;
  if (e.code === 'ERROR') { failed = [...new Set(e.error.message.match(/\\[F\\d\\]/g) ?? ['other'])].join(','); e.result?.close(); }
  if (e.code === 'BUNDLE_END') e.result?.close();
  if (e.code !== 'END') return;
  console.log(name + ': ' + (failed ? 'fail ' + failed : 'ok'));
  if (++i >= steps.length) { clearTimeout(timer); w.close(); return; }
  setTimeout(() => { name = steps[i][0]; steps[i][1](); }, 300);
});
`;

/** The [F6] line of the external-SDK guard (esbuild: "esbuild leaves", Rollup/Rolldown: "the bundle leaves"). */
export const EXTERNAL_F6 = (what) => new RegExp(`\\[F6\\] (esbuild|the bundle) leaves ${what.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} external: the runtime would load`);
