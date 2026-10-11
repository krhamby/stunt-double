// Expectation helpers and scripts shared by the esbuild / Rollup / Rolldown / Farm suites.
import fs from 'node:fs';
import path from 'node:path';
import { run, packs, readJson, writeJson, POSITIVE } from './lib.mjs';

/** A static (STA) or type-gate (TYP) mistake: the adapter build and the check chain both fail with `code`. */
export const STA = (code) => ({ t1: { fail: [code] }, chain: { fail: [code] } });

/** PriceTag override deleted: the SDK default renders (correctly) in all three positions. */
export const DEFAULT_PRICE = { app: POSITIVE.app, sdk: { BRAND_PRICE: 0, SDK_DEFAULT_PRICETAG: 3, BRAND_LOGO: 1, 'BRAND_BUTTON(dark)': 3 } };

/** forwardRef Button + class Logo still render. */
export const F1C_RENDER = { app: POSITIVE.app, sdk: { BRAND_LOGO: 1, 'BRAND_BUTTON(dark)': 3, BRAND_PRICE: 3 } };

/** `stunt-double check && <cmd>` */
export const chainOf = (cmd) => (dir) => {
  const c = run(process.execPath, [path.join(dir, 'node_modules/stunt-double/bin/stunt-double.mjs'), 'check'], dir);
  if (c.code !== 0) return c;
  const r = cmd(dir);
  return { ...r, out: `${c.out}${r.out}`, ms: c.ms + r.ms };
};

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

/**
 * Adapter-only project (the default setup): no @acme/core-slots dependency, the registry placeholder answers the
 * SDK's peer (supplied by the fixture's npm `overrides`, standing in for the registry). A no-op on the default
 * project; on a universal-tier copy it removes the link again.
 */
export function placeholderOnly(d, ws) {
  const file = path.join(d, 'package.json');
  const pkg = readJson(file);
  if (!pkg.dependencies['@acme/core-slots'] && pkg.overrides?.['@acme/core-slots']) return;
  delete pkg.dependencies['@acme/core-slots'];
  pkg.overrides = { ...pkg.overrides, '@acme/core-slots': `file:${packs}/acme-core-slots-0.0.1.tgz` };
  writeJson(file, pkg);
  fs.rmSync(path.join(d, 'node_modules/@acme/core-slots'), { recursive: true, force: true });
  ws.npm(d, 'install');
}

/** The [F6] line of the external-SDK guard (esbuild: "esbuild leaves", Rollup/Rolldown: "the bundle leaves"). */
export const EXTERNAL_F6 = (what) => new RegExp(`\\[F6\\] (esbuild|the bundle) leaves ${what.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} external: Node would load`);
