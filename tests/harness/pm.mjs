// Package managers the harness can install a fixture with, and how each one spells the universal-tier link
// (DESIGN.md §4.4). Every row is exercised: npm by tests/vite.test.mjs, pnpm / Yarn PnP / Bun by
// tests/<pm>.test.mjs (they run the Vite fixture and the whole catalogue with that package manager).
//
// Optional per-manager hooks (all exercised by tests/{pnpm,yarn,bun}.test.mjs):
//   keep            entries of the app dir a reset must keep besides node_modules (install state, e.g. Yarn PnP)
//   env(app)        extra environment for every command run in the app
//   afterInstall(app, run)   called after every install of the app (also SDK swaps)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Yarn Plug'n'Play has no node_modules: commands that call a tool by name (`vite build`, `stunt-double check`) or
 * plain `node` must still work, exactly as they do inside `yarn run`. Give them what `yarn run` gives: the PnP
 * runtime in NODE_OPTIONS and the project's binaries on PATH (node_modules/.bin shims to `yarn bin` targets).
 */
const yarnPnp = {
  keep: ['.yarn', '.pnp.cjs', '.pnp.loader.mjs'],
  env: (app) => ({ NODE_OPTIONS: `--require ${path.join(app, '.pnp.cjs')} --experimental-loader ${pathToFileURL(path.join(app, '.pnp.loader.mjs')).href} --no-warnings` }),
  async afterInstall(app, run) {
    const r = await run('yarn bin --json', { cwd: app, env: { NODE_OPTIONS: '' } });
    if (r.code !== 0) throw new Error(`harness: yarn bin failed in ${app}\n${r.output}`);
    const bin = path.join(app, 'node_modules', '.bin');
    fs.mkdirSync(bin, { recursive: true });
    for (const line of r.output.split('\n')) {
      let b;
      try { b = JSON.parse(line); } catch { continue; }
      if (!b?.name || !b.path) continue;
      fs.writeFileSync(path.join(bin, b.name), `#!/bin/sh\nexec node ${JSON.stringify(b.path)} "$@"\n`, { mode: 0o755 });
    }
  },
};
export const PACKAGE_MANAGERS = {
  npm: {
    install: 'npm install --prefer-offline --no-audit --no-fund --loglevel=error',
    lockfile: 'package-lock.json',
    /** dependency spec of the universal-tier link to `rel` (a directory inside the project) */
    link: (rel) => `file:./${rel}`,
    workspaces: false,
    run: (script) => `npm run --silent ${script}`,
    exec: (bin) => `npx --no-install ${bin}`,
    verified: true,
  },
  pnpm: {
    // CI=1 (set by the harness) makes pnpm default to --frozen-lockfile; SDK swaps change package.json
    install: 'pnpm install --prefer-offline --no-frozen-lockfile --config.confirmModulesPurge=false',
    lockfile: 'pnpm-lock.yaml',
    link: (rel) => `link:./${rel}`, // file: would make a stale COPY (the wiring self-test rejects it)
    workspaces: false,
    run: (script) => `pnpm run --silent ${script}`,
    exec: (bin) => `pnpm exec ${bin}`,
    verified: true,
  },
  yarn: {
    install: 'yarn install --no-immutable', // CI=1 makes Yarn 4 immutable by default; SDK swaps change package.json
    lockfile: 'yarn.lock',
    link: (rel) => `portal:./${rel}`, // the stub must declare NO peers, or PnP makes a __virtual__ copy
    workspaces: false,
    run: (script) => `yarn run ${script}`,
    exec: (bin) => `yarn ${bin}`,
    ...yarnPnp,
    verified: true,
  },
  bun: {
    install: 'bun install',
    lockfile: 'bun.lock',
    link: () => 'workspace:*', // link: means Bun's global registry and file: is a copy
    workspaces: true,
    run: (script) => `bun run ${script}`,
    exec: (bin) => `bunx ${bin}`,
    verified: true,
  },
};

export function packageManager(name = 'npm') {
  const pm = PACKAGE_MANAGERS[name];
  if (!pm) throw new Error(`unknown package manager "${name}" (known: ${Object.keys(PACKAGE_MANAGERS).join(', ')})`);
  return { name, ...pm };
}

/** Lockfiles of every package manager (removed from a fixture copy that is installed with another one). */
export const ALL_LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];
