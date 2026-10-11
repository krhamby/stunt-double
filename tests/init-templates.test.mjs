// The default setup and `npx stunt-double init` on FRESH official templates: npm create vite (react-ts),
// create-react-router, npm create astro (+ astro add react). OPT-IN, needs the network (npm registry, and GitHub
// for the Astro template):
//
//   npm run setup && STUNT_DOUBLE_TEMPLATES=1 npm test -- init-templates        (about 2-3 minutes)
//
// Flow per template (every expectation observed for real; see docs/tools/react-router.md and astro.md):
//   scaffold -> npm install -> npm i @acme/core stunt-double (the registry's auto-installed placeholder peer is
//   stood in for by npm overrides, as in the fixtures) -> `init` (status: what is missing) -> `init --plugin` ->
//   `init --plugin` again (no-op) -> build fails [F3] (required Logo) -> add Logo + a page rendering <Checkout>
//   -> build passes, the override is in the output -> contract mistake fails [F1] -> typo'd file name fails
//   [F2] -> `init --editor --ci` -> the template's tsc-based script and `npm run check` pass.
// Templates come at their latest version on purpose (what a new user gets): STUNT_DOUBLE_TEMPLATE_TAG=<tag or
// version> pins the three create-* packages.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { run, PACKS_DIR, WORK_ROOT } from './harness/index.mjs';

const ENABLED = process.env.STUNT_DOUBLE_TEMPLATES === '1';
const TAG = process.env.STUNT_DOUBLE_TEMPLATE_TAG ?? 'latest';
const TMP = path.join(WORK_ROOT, 'init-templates');
const AGENT_SAFE = { ASTRO_TELEMETRY_DISABLED: '1' };

async function sh(cwd, command, timeout = 600_000) {
  const r = await run(command, { cwd, timeout, env: AGENT_SAFE });
  assert.equal(r.code, 0, `${command} (in ${cwd}) exited ${r.code}\n${r.output.slice(-3000)}`);
  return r;
}
const firstDiagnostic = (out) => /^\s*(?:\S*Error: )?\[?(\[(?:F\d+|SETUP|CFG)\][^\n]*)/m.exec(out)?.[1] ?? null;
function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => path.join(d.parentPath ?? d.path, d.name));
}
const grep = (dir, needle) => filesUnder(dir).filter((f) => /\.(js|html)$/.test(f) && fs.readFileSync(f, 'utf8').includes(needle));

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
    scaffold: (dir) => sh(path.dirname(dir), `npm create -y vite@${TAG} ${path.basename(dir)} -- --template react-ts --no-interactive`),
    ov: 'src/overrides',
    usePage: (dir) => {
      fs.writeFileSync(path.join(dir, 'src/Shop.tsx'), SHOP);
      fs.writeFileSync(path.join(dir, 'src/App.tsx'), "import { Shop } from './Shop';\n\nexport default function App() {\n  return <Shop />;\n}\n");
    },
    build: 'npm run build', // tsc -b && vite build
    output: 'dist',
    status: [/! {3}vite\.config\.ts does not use stunt-double\/vite: .*\(or: npx stunt-double init --plugin\)/],
    plugin: [/\+ vite\.config\.ts: added stuntDouble\(\) to plugins/],
    editor: { lines: [/\+ tsconfig\.app\.json: "files" \+= "\.stunt-double\/check\.ts"/, /\+ package\.json script build: stunt-double check && tsc -b && vite build/], script: 'build' },
  },
  {
    name: 'react-router',
    scaffold: (dir) => sh(path.dirname(dir), `npx -y create-react-router@${TAG} ${path.basename(dir)} --yes --no-git-init --no-install`),
    ov: 'app/overrides',
    usePage: (dir) => {
      fs.writeFileSync(path.join(dir, 'app/shop.tsx'), SHOP);
      fs.writeFileSync(path.join(dir, 'app/routes/home.tsx'), "import { Shop } from '../shop';\n\nexport default function Home() {\n  return <Shop />;\n}\n");
    },
    build: 'npm run build', // react-router build
    output: 'build',
    status: [/! {3}vite\.config\.ts does not use stunt-double\/vite/, /! {3}React Router keeps code in app\/: set "overridesDir": "app\/overrides" and "sourceDirs": \["app"\]/],
    plugin: [/\+ vite\.config\.ts: added stuntDouble\(\) to plugins/, /\+ stunt-double\.config\.json: "overridesDir": "app\/overrides", "sourceDirs": \["app"\] \(React Router keeps code in app\/\)/],
    editor: { lines: [/\+ tsconfig\.json: "files" \+= "\.stunt-double\/check\.ts"/, /\+ package\.json script typecheck: stunt-double check && react-router typegen && tsc/], script: 'typecheck' },
  },
  {
    name: 'astro',
    scaffold: async (dir) => {
      const r = await run(`npm create -y astro@${TAG} ${path.basename(dir)} -- --template basics --no-install --no-git --yes --skip-houston --no-ai`, { cwd: path.dirname(dir), timeout: 600_000 });
      if (r.code === 0 && fs.existsSync(path.join(dir, 'astro.config.mjs'))) return;
      // create-astro downloads the template from api.github.com; where only git is allowed, take the same
      // directory (withastro/astro examples/basics on the default branch) with a sparse clone.
      console.log(`create-astro could not fetch the template (${r.output.split('\n').find((l) => /download|error/i.test(l) && !/complete log/.test(l))?.trim() ?? `exit ${r.code}`}); using a sparse git clone of withastro/astro examples/basics`);
      const repo = path.join(TMP, 'astro-repo');
      if (!fs.existsSync(repo)) {
        await sh(TMP, `git clone --depth 1 --filter=blob:none --sparse https://github.com/withastro/astro ${repo}`);
        await sh(repo, 'git sparse-checkout set examples/basics');
      }
      fs.rmSync(dir, { recursive: true, force: true });
      fs.cpSync(path.join(repo, 'examples/basics'), dir, { recursive: true });
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      pkg.name = path.basename(dir);
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    },
    afterInstall: (dir) => sh(dir, 'npx astro add react --yes'),
    ov: 'src/overrides',
    usePage: (dir) => {
      fs.writeFileSync(path.join(dir, 'src/components/Shop.tsx'), SHOP);
      fs.writeFileSync(path.join(dir, 'src/pages/index.astro'), "---\nimport { Shop } from '../components/Shop';\n---\n<html lang=\"en\"><body><Shop client:load /></body></html>\n");
    },
    build: 'npm run build', // astro build
    output: 'dist',
    status: [/! {3}astro\.config\.mjs does not use stunt-double\/vite: vite: \{ plugins: \[stuntDouble\(\)\] \}/, /! {3}"typescript" is not installed: the build's contract check runs tsc and fails with \[SETUP\] without it \(npm i -D typescript\)/],
    plugin: [/\+ astro\.config\.mjs: added stuntDouble\(\) to vite\.plugins/, /! TODO npm i -D typescript: the build's contract check runs tsc/],
    followTodo: (dir) => sh(dir, 'npm i -D --no-audit --no-fund typescript'),
    editor: { lines: [/\+ tsconfig\.json: "files" \+= "\.stunt-double\/check\.ts"/], script: null },
  },
];

if (!ENABLED) {
  test('default setup + init on fresh templates (opt-in: STUNT_DOUBLE_TEMPLATES=1, needs the network)', { skip: 'set STUNT_DOUBLE_TEMPLATES=1 to run (npm create + npm registry + GitHub)' }, () => {});
} else {
  before(() => {
    for (const t of ['stunt-double-0.1.0.tgz', 'acme-core-1.0.0.tgz', 'acme-core-slots-0.0.1.tgz'])
      assert.ok(fs.existsSync(path.join(PACKS_DIR, t)), `missing .packs/${t}: run npm run setup`);
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
  });
  after(() => { if (process.env.STUNT_DOUBLE_CLEAN === '1') fs.rmSync(TMP, { recursive: true, force: true }); });

  for (const t of TEMPLATES) {
    describe(`fresh ${t.name} template`, { concurrency: 1 }, () => {
      const dir = path.join(TMP, t.name);
      const init = (flags = '') => run(`stunt-double init ${flags}`, { cwd: dir });

      test('scaffold and install @acme/core + stunt-double; init reports what the default setup is missing', async () => {
        await t.scaffold(dir);
        await sh(dir, 'npm install --no-audit --no-fund --loglevel=error');
        if (t.afterInstall) await t.afterInstall(dir);
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        pkg.overrides = { ...pkg.overrides, '@acme/core-slots': `file:${path.join(PACKS_DIR, 'acme-core-slots-0.0.1.tgz')}` };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
        await sh(dir, `npm install --no-audit --no-fund --loglevel=error ${path.join(PACKS_DIR, 'acme-core-1.0.0.tgz')}`);
        await sh(dir, `npm install --no-audit --no-fund --loglevel=error -D ${path.join(PACKS_DIR, 'stunt-double-0.1.0.tgz')}`);
        const r = await init();
        assert.equal(r.code, 0, r.output);
        for (const re of t.status) assert.match(r.output, re);
      });

      test('init --plugin wires the tool; a second run changes nothing', async () => {
        const r = await init('--plugin');
        assert.equal(r.code, 0, r.output);
        for (const re of t.plugin) assert.match(r.output, re);
        if (t.followTodo) await t.followTodo(dir);
        const again = await init('--plugin');
        assert.equal(again.output.trim(), 'stunt-double init: nothing to change.');
      });

      test('the build fails with [F3] until the required Logo exists', async () => {
        const r = await run(t.build, { cwd: dir, env: AGENT_SAFE });
        assert.notEqual(r.code, 0, r.output);
        assert.match(firstDiagnostic(r.output) ?? '', new RegExp(`^\\[F3\\] required slot "Logo" has no implementation: create ${t.ov}/Logo\\.tsx`), r.output);
      });

      test('with a Logo override the project builds and the output carries it', async () => {
        fs.mkdirSync(path.join(dir, t.ov), { recursive: true });
        fs.writeFileSync(path.join(dir, t.ov, 'Logo.tsx'), LOGO);
        t.usePage(dir);
        const r = await run(t.build, { cwd: dir, env: AGENT_SAFE });
        assert.equal(r.code, 0, r.output);
        assert.ok(grep(path.join(dir, t.output), 'BRAND_LOGO').length, `BRAND_LOGO should be in ${t.output}/`);
      });

      test('a contract mistake fails the build with [F1]', async () => {
        fs.writeFileSync(path.join(dir, t.ov, 'Button.tsx'), BAD_BUTTON);
        try {
          const r = await run(t.build, { cwd: dir, env: AGENT_SAFE });
          assert.notEqual(r.code, 0, r.output);
          assert.match(firstDiagnostic(r.output) ?? '', new RegExp(`^\\[F1\\] Button \\(${t.ov}/Button\\.tsx\\): TS2322 .*Property 'tone' is missing`), r.output);
        } finally { fs.rmSync(path.join(dir, t.ov, 'Button.tsx')); }
      });

      test("a typo'd file name fails the build with [F2]", async () => {
        fs.copyFileSync(path.join(dir, t.ov, 'Logo.tsx'), path.join(dir, t.ov, 'Lgo.tsx'));
        try {
          const r = await run(t.build, { cwd: dir, env: AGENT_SAFE });
          assert.notEqual(r.code, 0, r.output);
          assert.match(firstDiagnostic(r.output) ?? '', new RegExp(`^\\[F2\\] ${t.ov}/Lgo\\.tsx overrides unknown slot "Lgo" \\(did you mean "Logo"\\?\\)`), r.output);
        } finally { fs.rmSync(path.join(dir, t.ov, 'Lgo.tsx')); }
      });

      test('init --editor --ci: the tsconfig sees the check file, the tsc script and npm run check pass', async () => {
        const r = await init('--editor --ci');
        assert.equal(r.code, 0, r.output);
        for (const re of t.editor.lines) assert.match(r.output, re);
        assert.match(r.output, /\+ package\.json script check: stunt-double check/);
        if (t.editor.script) { const s = await run(`npm run ${t.editor.script}`, { cwd: dir, env: AGENT_SAFE }); assert.equal(s.code, 0, s.output); }
        const c = await run('npm run check', { cwd: dir });
        assert.equal(c.code, 0, c.output);
        assert.match(c.output, /stunt-double: OK - 3 slots of @acme\/core@1\.0\.0; overridden: Logo/);
      });
    });
  }
}
