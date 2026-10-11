// Helpers for the package-manager suites: generate a customer-vite-equivalent project for a package manager
// and tier, install it, run scripts. Package managers are pinned and installed once into a cache directory
// from the npm registry (no corepack: works offline-proxied CI and locally alike).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PACKS = path.join(REPO, '.packs');
export const VERSIONS = { pnpm: '12.11.2', yarn: '4.18.1', bun: '1.4' };
const WORK = process.env.SD_PM_WORKDIR ?? path.join(os.tmpdir(), 'stunt-double-pm');
const TOOLS = path.join(WORK, 'tools');

/** Install pnpm and Yarn (cli-dist) once; find Bun (BUN_BIN, PATH, ~/.bun). Returns { [pm]: argv prefix } or null entries. */
export function packageManagers() {
  fs.mkdirSync(TOOLS, { recursive: true });
  const want = { pnpm: `pnpm@${VERSIONS.pnpm}`, '@yarnpkg/cli-dist': `@yarnpkg/cli-dist@${VERSIONS.yarn}` };
  const have = (n) => fs.existsSync(path.join(TOOLS, 'node_modules', n, 'package.json'));
  if (!Object.keys(want).every(have)) {
    if (!fs.existsSync(path.join(TOOLS, 'package.json'))) fs.writeFileSync(path.join(TOOLS, 'package.json'), '{"private":true}');
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--no-save', ...Object.values(want)], { cwd: TOOLS, stdio: 'ignore' });
  }
  const bun = [process.env.BUN_BIN, path.join(os.homedir(), '.bun/bin/bun')].find((b) => b && fs.existsSync(b))
    ?? (spawnSync('bun', ['--version']).status === 0 ? 'bun' : null);
  return {
    npm: ['npm'],
    pnpm: [path.join(TOOLS, 'node_modules/.bin/pnpm')],
    yarn: [process.execPath, path.join(TOOLS, 'node_modules/@yarnpkg/cli-dist/bin/yarn.js')],
    bun: bun ? [bun] : null,
  };
}

export const LINK = { npm: 'file:./sdk-slots', pnpm: 'link:./sdk-slots', yarn: 'portal:./sdk-slots', bun: 'workspace:*' };
export const YARN_TS5 = 'patch:typescript@npm%3A5.9.3#optional!builtin<compat/typescript>';

export const projectDir = (name) => path.join(WORK, 'projects', name);

export const PLACEHOLDER = () => `file:${path.join(PACKS, 'acme-core-slots-0.0.1.tgz')}`;

/** The committed stub `stunt-double init --universal` writes (the linked slot package; it becomes the outDir). */
export function writeUniversalStub(dir, rel = 'sdk-slots') {
  fs.mkdirSync(path.join(dir, rel), { recursive: true });
  fs.writeFileSync(path.join(dir, rel, 'package.json'), JSON.stringify({
    name: '@acme/core-slots', version: '0.0.0', private: true, type: 'module', sideEffects: false,
    exports: { './package.json': './package.json', './*': { types: './gen/*.d.ts', default: './gen/*.jsx' } },
  }, null, 2) + '\n');
}

/**
 * The registry placeholder for the SDK's required peer. A real project gets it from the company registry
 * (npm, pnpm and Bun auto-install required peers); this repository has no registry, so each package manager's
 * own override mechanism points the peer at the tarball, as examples/customer-vite does with npm "overrides".
 */
export function providePlaceholder(dir, pm, pkg) {
  if (pm === 'npm' || pm === 'bun') pkg.overrides = { ...pkg.overrides, '@acme/core-slots': PLACEHOLDER() };
  else if (pm === 'yarn') pkg.resolutions = { ...pkg.resolutions, '@acme/core-slots': PLACEHOLDER() };
  else if (pm === 'pnpm') fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), `overrides:\n  '@acme/core-slots': '${PLACEHOLDER()}'\n`);
}

/**
 * Create a project from examples/customer-vite.
 * tier: 'adapter'   stuntDouble() in vite.config.ts, no link (the default setup; the placeholder is installed)
 *       'universal' no plugin; sdk-slots/ stub linked per package manager; build = stunt-double check && …,
 *                   build:bare without the prefix
 * opts.sdk: @acme/core variant; opts.link: a dependency spec for @acme/core-slots (adapter tier + link: wiring tests)
 */
export function makeProject(name, pm, tier, opts = {}) {
  const dir = projectDir(name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(REPO, 'examples/customer-vite');
  for (const f of ['src', 'probes', 'index.html', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json'])
    fs.cpSync(path.join(src, f), path.join(dir, f), { recursive: true });
  fs.rmSync(path.join(dir, 'src/__tests__'), { recursive: true, force: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
  pkg.name = name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  delete pkg.overrides;
  const tgz = (n) => `file:${path.join(PACKS, n)}`;
  pkg.dependencies['@acme/core'] = tgz(`acme-core-${opts.sdk ?? '1.0.0'}.tgz`);
  pkg.devDependencies['stunt-double'] = tgz('stunt-double-0.1.0.tgz');
  delete pkg.devDependencies.vitest;
  for (const k of ['test', 'dev', 'preview', 'typecheck']) delete pkg.scripts[k];
  const link = opts.link !== undefined ? opts.link : tier === 'universal' ? LINK[pm] : null;
  if (link) {
    pkg.dependencies['@acme/core-slots'] = link;
    if (/^(file|link|portal):\.\/sdk-slots$|^workspace:/.test(link)) writeUniversalStub(dir);
    if (pm === 'bun' && link.startsWith('workspace:')) pkg.workspaces = ['sdk-slots'];
  } else providePlaceholder(dir, pm, pkg);
  const build = 'vite build && vite build --ssr src/entry-server.tsx --outDir dist-ssr';
  pkg.scripts.build = build;
  if (tier === 'universal') {
    pkg.scripts.build = `stunt-double check && ${build}`;
    pkg.scripts['build:bare'] = build;
    // fresh clones and bare tools need the shims before anything runs (what `init --universal --editor` adds)
    pkg.scripts.postinstall = 'stunt-double gen --no-fail';
    fs.writeFileSync(path.join(dir, 'vite.config.ts'), `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Universal tier: no stunt-double plugin. @acme/core-slots resolves through the package link (sdk-slots/).
export default defineConfig({ plugins: [react()], ssr: { noExternal: ['@acme/core'] } });
`);
  } else {
    fs.writeFileSync(path.join(dir, 'vite.config.ts'), `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { stuntDouble } from 'stunt-double/vite';

export default defineConfig({ plugins: [react(), stuntDouble()] });
`);
  }
  const cfg = {};
  if (pm === 'yarn') {
    pkg.packageManager = `yarn@${VERSIONS.yarn}`;
    fs.writeFileSync(path.join(dir, '.yarnrc.yml'), 'nodeLinker: pnp\nenableGlobalCache: false\nenableTelemetry: false\n');
    fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
    if (opts.yarnTs5 !== false) { pkg.devDependencies.typescript5 = YARN_TS5; cfg.typescript = 'typescript5'; }
  }
  if (pm === 'pnpm') pkg.packageManager = `pnpm@${VERSIONS.pnpm}`;
  Object.assign(cfg, opts.config);
  if (Object.keys(cfg).length) fs.writeFileSync(path.join(dir, 'stunt-double.config.json'), JSON.stringify(cfg, null, 2) + '\n');
  opts.edit?.(dir, pkg);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  return dir;
}

const strip = (s) => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '');

/** Run a command (async, so suites for different package managers really run in parallel). */
export function run(cmd, args, cwd, { timeout = 300_000, env = {} } = {}) {
  const t0 = Date.now();
  return new Promise((done) => {
    const child = spawn(cmd[0], [...cmd.slice(1), ...args], { cwd, env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { out += '\n[timeout]'; child.kill('SIGKILL'); }, timeout);
    child.on('error', (e) => { out += String(e); });
    child.on('close', (code) => { clearTimeout(timer); done({ code: code ?? 1, out: strip(out), ms: Date.now() - t0 }); });
  });
}

export const install = (pms, pm, dir) => run(pms[pm], pm === 'npm' ? ['install', '--no-audit', '--no-fund'] : ['install'], dir, { env: pm === 'yarn' ? { YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' } : {} });
export const script = (pms, pm, dir, name) => run(pms[pm], ['run', name], dir);
/** node in the project's module context (Yarn PnP needs `yarn node`). */
export const node = (pms, pm, dir, args, o) => run(pm === 'yarn' ? [...pms.yarn, 'node'] : [process.execPath], args, dir, o);

/** First stunt-double / resolver diagnostic line of a build output. */
export function firstProblem(out) {
  return (out.match(/^\s*\[(F\d\w*|TS-PNP|TS|STALE|UNRESOLVED_IMPORT|MISSING_EXPORT)\][^\n]*/m)?.[0] ?? out.match(/[^\n]*(?:Error|error)[^\n]*/)?.[0] ?? '').trim();
}
