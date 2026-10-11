// Package managers the harness can install a fixture with, and how each one spells the universal-tier link
// (DESIGN.md §4.4). npm (every suite), pnpm (tests/vite-pnpm.test.mjs) and Yarn 4 PnP (tests/vite-yarn-pnp.test.mjs)
// are exercised; the bun row is the documented commands, ready for a suite to use (and correct if reality differs).
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
    /** what an install leaves next to package.json, kept across per-scenario resets; the first one marks it */
    installState: ['node_modules'],
  },
  pnpm: {
    install: 'pnpm install --prefer-offline --config.confirmModulesPurge=false',
    lockfile: 'pnpm-lock.yaml',
    link: (rel) => `link:./${rel}`, // file: would make a stale COPY (the wiring self-test rejects it)
    workspaces: false,
    run: (script) => `pnpm run --silent ${script}`,
    exec: (bin) => `pnpm exec ${bin}`,
    verified: true,
    installState: ['node_modules'],
  },
  yarn: {
    // Yarn 4 through Corepack (the fixture's "packageManager" field picks the version; a global `yarn` is often 1.x)
    install: 'corepack yarn install --no-immutable', // CI=true makes Yarn immutable; fixtures install fresh
    lockfile: 'yarn.lock',
    link: (rel) => `portal:./${rel}`, // the stub must declare NO peers, or PnP makes a __virtual__ copy
    workspaces: false,
    run: (script) => `corepack yarn run ${script}`,
    exec: (bin) => `corepack yarn ${bin}`,
    verified: true, // Plug'n'Play: tests/vite-yarn-pnp.test.mjs
    installState: ['.pnp.cjs', '.pnp.loader.mjs', '.yarn', 'yarn.lock', 'node_modules'], // Yarn refuses to run without its lockfile
  },
  bun: {
    install: 'bun install',
    lockfile: 'bun.lock',
    link: () => 'workspace:*', // link: means Bun's global registry and file: is a copy
    workspaces: true,
    run: (script) => `bun run ${script}`,
    exec: (bin) => `bunx ${bin}`,
    verified: false,
    installState: ['node_modules'],
  },
};

export function packageManager(name = 'npm') {
  const pm = PACKAGE_MANAGERS[name];
  if (!pm) throw new Error(`unknown package manager "${name}" (known: ${Object.keys(PACKAGE_MANAGERS).join(', ')})`);
  return { name, ...pm };
}

/** Lockfiles of every package manager (removed from a fixture copy that is installed with another one). */
export const ALL_LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];
