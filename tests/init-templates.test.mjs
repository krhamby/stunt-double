// `npx stunt-double init` on FRESH official templates: npm create vite (react-ts), create-react-router, npm create
// astro (+ astro add react). OPT-IN, needs the network (npm registry, and GitHub for the Astro template):
//
//   npm run setup && STUNT_DOUBLE_TEMPLATES=1 node --test tests/init-templates.test.mjs     (~3-4 min)
//
// Flow per template (every expectation observed for real, see docs/tools/react-router.md and astro.md):
//   scaffold -> npm install -> install the packed @acme/core + its registry placeholder @acme/core-slots (what a
//   registry install leaves) + stunt-double -> init -> init again (no-op) -> npm install -> build fails [F3]
//   (required Logo) -> add Logo + a page rendering <Checkout> -> build passes, overrides in the output ->
//   contract mistake fails [F1] -> typo'd file name fails [F2].
// Templates are fetched at their latest version on purpose (that is what a new user gets): set
// STUNT_DOUBLE_TEMPLATE_TAG=<npm tag or version> to pin all three create-* packages.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { ENV, PACKS, requirePacks, tmpRoot, npm, runScript, firstDiagnostic, grepFiles, cleanup } from './frameworks/lib.mjs';

const ENABLED = process.env.STUNT_DOUBLE_TEMPLATES === '1';
const TAG = process.env.STUNT_DOUBLE_TEMPLATE_TAG ?? 'latest';
const TMP = ENABLED ? tmpRoot('init-templates') : null;
const sh = (cwd, cmd, args, timeout = 600_000) => execFileSync(cmd, args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout });
const init = (dir) => spawnSync(process.execPath, [path.join(dir, 'node_modules/stunt-double/bin/stunt-double.mjs'), 'init'], { cwd: dir, env: ENV, encoding: 'utf8' });

const LOGO = `import type { SlotProps } from '@acme/core/contracts';

export function Logo({ size = 32 }: SlotProps['Logo']) {
  return <svg data-sd="BRAND_LOGO" width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="brand" />;
}
`;
const BAD_BUTTON = `import type { SlotProps } from '@acme/core/contracts';

export function Button(props: SlotProps['Button'] & { tone: 'loud' }) {
  return <button data-sd="BRAND_BUTTON">{props.children}</button>;
}
`;
const SHOP = `import { Checkout } from '@acme/core';

export function Shop() {
  return <Checkout products={[{ id: 'tee', name: 'T-shirt', price: 19.99 }]} />;
}
`;

const TEMPLATES = [
  {
    name: 'vite-react-ts',
    scaffold: (dir) => sh(path.dirname(dir), 'npm', ['create', '-y', `vite@${TAG}`, path.basename(dir), '--', '--template', 'react-ts', '--no-interactive']),
    ov: 'src/overrides',
    usePage: (dir) => {
      fs.writeFileSync(path.join(dir, 'src/Shop.tsx'), SHOP);
      fs.writeFileSync(path.join(dir, 'src/App.tsx'), "import { Shop } from './Shop';\n\nexport default function App() {\n  return <Shop />;\n}\n");
    },
    output: 'dist',
    initLines: [/\+ tsconfig\.app\.json: paths "@acme\/core-slots\/\*", files "src\/stunt-double\.check\.ts"/, /\+ vite\.config\.ts: added stuntDouble\(\) to plugins/, /\+ script build: stunt-double check && tsc -b && vite build/],
  },
  {
    name: 'react-router',
    scaffold: (dir) => sh(path.dirname(dir), 'npx', ['-y', `create-react-router@${TAG}`, path.basename(dir), '--yes', '--no-git-init', '--no-install']),
    ov: 'app/overrides',
    usePage: (dir) => {
      fs.writeFileSync(path.join(dir, 'app/shop.tsx'), SHOP);
      fs.writeFileSync(path.join(dir, 'app/routes/home.tsx'), "import { Shop } from '../shop';\n\nexport default function Home() {\n  return <Shop />;\n}\n");
    },
    output: 'build',
    initLines: [/\+ wrote stunt-double\.config\.json \(react-router\.config\.ts appDirectory: overrides in app\/overrides\/\)/, /\+ tsconfig\.json: paths "@acme\/core-slots\/\*", files "app\/stunt-double\.check\.ts"/, /\+ vite\.config\.ts: added stuntDouble\(\) to plugins/, /\+ script typecheck: stunt-double check && react-router typegen && tsc/],
  },
  {
    name: 'astro',
    scaffold: (dir) => {
      try {
        sh(path.dirname(dir), 'npm', ['create', '-y', `astro@${TAG}`, path.basename(dir), '--', '--template', 'basics', '--no-install', '--no-git', '--yes', '--skip-houston', '--no-ai']);
        assert.ok(fs.existsSync(path.join(dir, 'astro.config.mjs')));
      } catch (e) {
        // create-astro downloads the template from api.github.com; where only git is allowed, take the same
        // directory (withastro/astro examples/basics on the default branch) with a sparse clone.
        console.log(`create-astro could not download the template (${String(e.stdout ?? '').concat(e.stderr ?? '', e.message ?? '').split('\n').find((l) => /Failed to download|Unable to download|error/i.test(l) && !/complete log/.test(l))?.trim() ?? 'unknown error'}); using a sparse git clone of withastro/astro examples/basics`);
        const repo = path.join(TMP, 'astro-repo');
        if (!fs.existsSync(repo)) {
          sh(TMP, 'git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', 'https://github.com/withastro/astro', repo]);
          sh(repo, 'git', ['sparse-checkout', 'set', 'examples/basics']);
        }
        fs.rmSync(dir, { recursive: true, force: true });
        fs.cpSync(path.join(repo, 'examples/basics'), dir, { recursive: true });
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        pkg.name = path.basename(dir);
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
      }
    },
    afterInstall: (dir) => sh(dir, 'npx', ['astro', 'add', 'react', '--yes']),
    ov: 'src/overrides',
    usePage: (dir) => {
      fs.writeFileSync(path.join(dir, 'src/components/Shop.tsx'), SHOP);
      fs.writeFileSync(path.join(dir, 'src/pages/index.astro'), "---\nimport { Shop } from '../components/Shop';\n---\n<html lang=\"en\"><body><Shop client:load /></body></html>\n");
    },
    output: 'dist',
    initLines: [/\+ tsconfig\.json: paths "@acme\/core-slots\/\*", files "src\/stunt-double\.check\.ts"/, /\+ astro\.config\.mjs: added stuntDouble\(\) to vite\.plugins/, /\+ devDependency "typescript": "\^7\.0\.2"/],
  },
];

if (!ENABLED) {
  test('init on fresh templates (opt-in: STUNT_DOUBLE_TEMPLATES=1, needs the network)', { skip: 'set STUNT_DOUBLE_TEMPLATES=1 to run (npm create + npm registry + GitHub)' }, () => {});
} else {
  before(() => requirePacks('stunt-double-0.1.0.tgz', 'acme-core-1.0.0.tgz', 'acme-core-slots-0.0.1.tgz'));
  after(() => cleanup(TMP));

  for (const t of TEMPLATES) {
    describe(`init on a fresh ${t.name} template`, () => {
      const dir = TMP && path.join(TMP, t.name);
      let first;

      test('scaffold, install the SDK (+ registry placeholder) and stunt-double, run init', () => {
        t.scaffold(dir);
        npm(dir, ['install', '--no-audit', '--no-fund', '--loglevel=error']);
        t.afterInstall?.(dir);
        npm(dir, ['install', '--no-audit', '--no-fund', '--loglevel=error', path.join(PACKS, 'acme-core-1.0.0.tgz'), path.join(PACKS, 'acme-core-slots-0.0.1.tgz')]);
        npm(dir, ['install', '--no-audit', '--no-fund', '--loglevel=error', '-D', path.join(PACKS, 'stunt-double-0.1.0.tgz')]);
        first = init(dir);
        assert.equal(first.status, 0, first.stdout + first.stderr);
        assert.match(first.stdout, /\+ dependencies "@acme\/core-slots": "file:\S+acme-core-slots-0\.0\.1\.tgz" -> "file:\.\/sdk-slots" \(the registry placeholder must be replaced by the link, npm\)/);
        for (const re of t.initLines) assert.match(first.stdout, re);
        assert.match(first.stdout, /required slots without an implementation .*Logo \(npx stunt-double eject Logo\)/);
      });

      test('second init changes nothing', () => {
        const again = init(dir);
        assert.equal(again.status, 0);
        assert.equal(again.stdout.trim(), 'stunt-double init: already wired, nothing to change.');
      });

      test('reinstall links the slot package; the build fails with [F3] until the required Logo exists', () => {
        const out = npm(dir, ['install', '--no-audit', '--no-fund', '--loglevel=error']);
        assert.ok(fs.lstatSync(path.join(dir, 'node_modules/@acme/core-slots')).isSymbolicLink(), out);
        const r = runScript(dir, 'build');
        assert.notEqual(r.code, 0, r.out);
        assert.match(firstDiagnostic(r.out) ?? '', new RegExp(`^\\[F3\\] required slot "Logo" has no implementation: create ${t.ov}/Logo\\.tsx`));
      });

      test('with a Logo override the project builds and the output carries it', () => {
        fs.writeFileSync(path.join(dir, t.ov, 'Logo.tsx'), LOGO);
        t.usePage(dir);
        const r = runScript(dir, 'build');
        assert.equal(r.code, 0, r.out);
        assert.ok(grepFiles(path.join(dir, t.output), 'BRAND_LOGO').length, `BRAND_LOGO should be in ${t.output}/`);
      });

      test('a contract mistake fails the build with [F1]', () => {
        fs.writeFileSync(path.join(dir, t.ov, 'Button.tsx'), BAD_BUTTON);
        try {
          const r = runScript(dir, 'build');
          assert.notEqual(r.code, 0, r.out);
          assert.match(firstDiagnostic(r.out) ?? '', new RegExp(`^\\[F1\\] Button \\(${t.ov}/Button\\.tsx\\): TS2322 .*Property 'tone' is missing`));
        } finally { fs.rmSync(path.join(dir, t.ov, 'Button.tsx')); }
      });

      test("a typo'd file name fails the build with [F2]", () => {
        fs.copyFileSync(path.join(dir, t.ov, 'Logo.tsx'), path.join(dir, t.ov, 'Lgo.tsx'));
        try {
          const r = runScript(dir, 'build');
          assert.notEqual(r.code, 0, r.out);
          assert.match(firstDiagnostic(r.out) ?? '', new RegExp(`^\\[F2\\] ${t.ov}/Lgo\\.tsx overrides unknown slot "Lgo" \\(did you mean "Logo"\\?\\)`));
        } finally { fs.rmSync(path.join(dir, t.ov, 'Lgo.tsx')); }
      });
    });
  }
}
