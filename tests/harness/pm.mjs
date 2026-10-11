// Package managers the harness can install a fixture with, and how each one spells the universal-tier link
// (DESIGN.md §4.4). npm (every suite) and pnpm (tests/vite-pnpm.test.mjs) are exercised; the yarn and bun rows
// are the documented commands, ready for a package-manager suite to use (and correct if reality differs).
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
    install: 'pnpm install --prefer-offline --config.confirmModulesPurge=false',
    lockfile: 'pnpm-lock.yaml',
    link: (rel) => `link:./${rel}`, // file: would make a stale COPY (the wiring self-test rejects it)
    workspaces: false,
    run: (script) => `pnpm run --silent ${script}`,
    exec: (bin) => `pnpm exec ${bin}`,
    verified: true,
  },
  yarn: {
    install: 'yarn install',
    lockfile: 'yarn.lock',
    link: (rel) => `portal:./${rel}`, // the stub must declare NO peers, or PnP makes a __virtual__ copy
    workspaces: false,
    run: (script) => `yarn run ${script}`,
    exec: (bin) => `yarn ${bin}`,
    verified: false,
  },
  bun: {
    install: 'bun install',
    lockfile: 'bun.lock',
    link: () => 'workspace:*', // link: means Bun's global registry and file: is a copy
    workspaces: true,
    run: (script) => `bun run ${script}`,
    exec: (bin) => `bunx ${bin}`,
    verified: false,
  },
};

export function packageManager(name = 'npm') {
  const pm = PACKAGE_MANAGERS[name];
  if (!pm) throw new Error(`unknown package manager "${name}" (known: ${Object.keys(PACKAGE_MANAGERS).join(', ')})`);
  return { name, ...pm };
}

/** Lockfiles of every package manager (removed from a fixture copy that is installed with another one). */
export const ALL_LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];
