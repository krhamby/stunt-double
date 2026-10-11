// `stunt-double init` on the shapes the official templates ship (npm create vite react-ts, create-react-router 8,
// create-astro basics + astro add react): config text edits, the status hints, and idempotency. The same flows
// run end to end on freshly scaffolded templates in tests/init-templates.test.mjs (opt-in, network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addVitePlugin, addAstroPlugin, appDirectory, cmdInit } from '../src/init.mjs';
import { parseJsonc } from '../src/core/util.mjs';
import { project, write, read, tmpDir } from './helpers.mjs';

async function init(root, ...flags) {
  const lines = [];
  const code = await cmdInit({ values: { root }, flags: new Set(flags) }, { out: (s) => lines.push(s), err: (s) => lines.push(s) });
  return { code, text: lines.join('\n') };
}

const VITE_TEMPLATE = `import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
`;
const RR_VITE = `import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
});
`;
const ASTRO_CONFIG = `// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  integrations: [react()]
});`;

// ---- config text edits ----------------------------------------------------------------------------------
test('addVitePlugin: Vite react-ts template (no semicolons): import after the last import, plugin after react()', () => {
  assert.equal(addVitePlugin(VITE_TEMPLATE), `import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { stuntDouble } from 'stunt-double/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), stuntDouble()],
})
`);
});

test('addVitePlugin: React Router template keeps its double quotes and semicolons; reactRouter() is not react()', () => {
  const out = addVitePlugin(RR_VITE);
  assert.match(out, /import \{ defineConfig \} from "vite";\nimport \{ stuntDouble \} from "stunt-double\/vite";\n/);
  assert.match(out, /plugins: \[tailwindcss\(\), reactRouter\(\), stuntDouble\(\)\],/);
});

test('addAstroPlugin: Astro has no top-level plugins: a vite block is added (fresh template after astro add react)', () => {
  const out = addAstroPlugin(ASTRO_CONFIG);
  assert.match(out, /import react from '@astrojs\/react';\nimport \{ stuntDouble \} from 'stunt-double\/vite';\n/);
  assert.match(out, /defineConfig\(\{\n {2}vite: \{ plugins: \[stuntDouble\(\)\] \},\n {2}integrations: \[react\(\)\]\n\}\);$/);
  assert.equal(addAstroPlugin(`import { defineConfig } from 'astro/config';\nexport default defineConfig({});\n`),
    `import { defineConfig } from 'astro/config';\nimport { stuntDouble } from 'stunt-double/vite';\nexport default defineConfig({\n  vite: { plugins: [stuntDouble()] },\n});\n`);
});

test('addAstroPlugin: extends an existing vite block or its plugins array, never an integration option', () => {
  const withPlugins = addAstroPlugin(`import { defineConfig } from 'astro/config';\nexport default defineConfig({ integrations: [x({ plugins: [] })], vite: { plugins: [y()], server: {} } });\n`);
  assert.match(withPlugins, /vite: \{ plugins: \[stuntDouble\(\), y\(\)\], server: \{\} \}/);
  assert.match(withPlugins, /x\(\{ plugins: \[\] \}\)/);
  const emptyPlugins = addAstroPlugin(`import { defineConfig } from 'astro/config';\nexport default defineConfig({ vite: { plugins: [] } });\n`);
  assert.match(emptyPlugins, /vite: \{ plugins: \[stuntDouble\(\)\] \}/);
  const without = addAstroPlugin(`import { defineConfig } from 'astro/config';\nexport default defineConfig({ vite: { server: { port: 1 } } });\n`);
  assert.match(without, /vite: \{ plugins: \[stuntDouble\(\)\], server: \{ port: 1 \} \}/);
  assert.equal(addAstroPlugin('module.exports = config;\n'), null);
});

test('appDirectory: React Router app/ (default and appDirectory), not for plain Vite', () => {
  const rr = tmpDir('rr');
  write(rr, { 'react-router.config.ts': 'export default { ssr: true } satisfies Config;\n' });
  assert.equal(appDirectory(rr, {}), 'app');
  const custom = tmpDir('rr2');
  write(custom, { 'react-router.config.ts': 'export default {\n  // appDirectory: "nope",\n  appDirectory: "./web/",\n};\n' });
  assert.equal(appDirectory(custom, {}), 'web');
  const vite = tmpDir('vite');
  assert.equal(appDirectory(vite, { devDependencies: { vite: '8.3.4' } }), null);
});

// ---- whole runs on template-shaped projects ---------------------------------------------------------------
test('React Router project: status names the app/ layout; --plugin wires vite.config and the config file; second run is a no-op', async () => {
  const { root } = project({
    pkg: { devDependencies: { '@react-router/dev': '8.4.0', typescript: '5.9.3' }, scripts: { build: 'react-router build', typecheck: 'react-router typegen && tsc' } },
    files: {
      'react-router.config.ts': 'export default { ssr: true };\n',
      'vite.config.ts': RR_VITE,
      'tsconfig.json': '{\n  "include": ["**/*", ".react-router/types/**/*"],\n  "compilerOptions": { "rootDirs": [".", "./.react-router/types"], "paths": { "~/*": ["./app/*"] } }\n}\n',
      'app/root.tsx': 'export default function Root() { return null; }\n',
      'node_modules/typescript/package.json': '{ "name": "typescript", "version": "5.9.3" }\n',
    },
  });
  const status = await init(root);
  assert.equal(status.code, 0);
  assert.match(status.text, /! {3}React Router keeps code in app\/: set "overridesDir": "app\/overrides" and "sourceDirs": \["app"\] in stunt-double\.config\.json \(or: npx stunt-double init --plugin\)/);
  assert.doesNotMatch(status.text, /"typescript" is not installed/);

  const r = await init(root, 'plugin');
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /\+ vite\.config\.ts: added stuntDouble\(\) to plugins/);
  assert.match(r.text, /\+ stunt-double\.config\.json: "overridesDir": "app\/overrides", "sourceDirs": \["app"\]/);
  const cfg = JSON.parse(read(root, 'stunt-double.config.json'));
  assert.deepEqual({ overridesDir: cfg.overridesDir, sourceDirs: cfg.sourceDirs }, { overridesDir: 'app/overrides', sourceDirs: ['app'] });
  assert.match(read(root, 'vite.config.ts'), /plugins: \[tailwindcss\(\), reactRouter\(\), stuntDouble\(\)\]/);
  assert.equal(read(root, 'package.json').includes('stunt-double'), false, '--plugin does not touch package.json');

  const before = ['vite.config.ts', 'stunt-double.config.json', 'package.json', 'tsconfig.json'].map((f) => read(root, f));
  const again = await init(root, 'plugin');
  assert.equal(again.text, 'stunt-double init: nothing to change.');
  assert.deepEqual(['vite.config.ts', 'stunt-double.config.json', 'package.json', 'tsconfig.json'].map((f) => read(root, f)), before);
  const status2 = await init(root);
  assert.doesNotMatch(status2.text, /React Router keeps code/);
  assert.match(status2.text, /ok {2}vite\.config\.ts uses stunt-double\/vite/);
});

test('React Router: an existing stunt-double.config.json is merged, not replaced', async () => {
  const { root } = project({
    pkg: { devDependencies: { '@react-router/dev': '8.4.0' } },
    config: { allowOriginalImports: ['app/styleguide/**'] },
    files: { 'react-router.config.ts': 'export default {};\n', 'vite.config.ts': RR_VITE },
  });
  await init(root, 'plugin');
  const cfg = JSON.parse(read(root, 'stunt-double.config.json'));
  assert.deepEqual(cfg.allowOriginalImports, ['app/styleguide/**']);
  assert.equal(cfg.overridesDir, 'app/overrides');
});

test('Astro project: status names the missing adapter and typescript; --plugin edits vite.plugins and prints the typescript TODO', async () => {
  const { root } = project({
    pkg: { dependencies: { '@acme/core': '1.0.0', astro: '7.3.8', '@astrojs/react': '7.0.1' }, scripts: { build: 'astro build' } },
    files: {
      'astro.config.mjs': ASTRO_CONFIG,
      'tsconfig.json': '{\n  "extends": "astro/tsconfigs/strict",\n  "include": [".astro/types.d.ts", "**/*"],\n  "exclude": ["dist"]\n}\n',
      'src/pages/index.astro': '<html></html>\n',
    },
  });
  const status = await init(root);
  assert.match(status.text, /! {3}astro\.config\.mjs does not use stunt-double\/vite: vite: \{ plugins: \[stuntDouble\(\)\] \} .*\(or: npx stunt-double init --plugin\)/);
  assert.match(status.text, /! {3}"typescript" is not installed: the build's contract check runs tsc and fails with \[SETUP\] without it \(npm i -D typescript\)/);
  const r = await init(root, 'plugin');
  assert.match(r.text, /\+ astro\.config\.mjs: added stuntDouble\(\) to vite\.plugins/);
  assert.match(r.text, /! TODO npm i -D typescript/);
  assert.match(read(root, 'astro.config.mjs'), /vite: \{ plugins: \[stuntDouble\(\)\] \},\n {2}integrations: \[react\(\)\]/);
  assert.equal(fs.existsSync(path.join(root, 'stunt-double.config.json')), false, 'Astro uses src/: no config file needed');
});

test('--editor on the Vite template: check file in tsconfig.app.json files, and tsc-first scripts get "stunt-double check &&"', async () => {
  const { root } = project({
    pkg: { devDependencies: { vite: '8.3.4', typescript: '6.0.2' }, scripts: { dev: 'vite', build: 'tsc -b && vite build', lint: 'oxlint' } },
    files: {
      'vite.config.ts': VITE_TEMPLATE,
      'tsconfig.json': '{\n  "files": [],\n  "references": [\n    { "path": "./tsconfig.app.json" },\n    { "path": "./tsconfig.node.json" }\n  ]\n}\n',
      'tsconfig.app.json': '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    /* Linting */\n    "noUnusedLocals": true\n  },\n  "include": ["src"]\n}\n',
      'tsconfig.node.json': '{ "include": ["vite.config.ts"] }\n',
      'src/main.tsx': '\n',
    },
  });
  const r = await init(root, 'editor', 'ci');
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /\+ tsconfig\.app\.json: "files" \+= "\.stunt-double\/check\.ts"/);
  assert.match(r.text, /\+ package\.json script build: stunt-double check && tsc -b && vite build/);
  const pkg = JSON.parse(read(root, 'package.json'));
  assert.equal(pkg.scripts.build, 'stunt-double check && tsc -b && vite build');
  assert.equal(pkg.scripts.dev, 'vite');
  assert.equal(pkg.scripts.lint, 'oxlint');
  assert.equal(pkg.scripts.postinstall, 'stunt-double gen --no-fail');
  assert.equal(pkg.scripts.check, 'stunt-double check');
  const app = parseJsonc(read(root, 'tsconfig.app.json'));
  assert.deepEqual(app.files, ['.stunt-double/check.ts']);
  assert.deepEqual(app.include, ['src']);
  assert.match(read(root, 'tsconfig.app.json'), /\/\* Linting \*\//);
  const again = await init(root, 'editor', 'ci');
  assert.equal(again.text.split('\n').filter((l) => l.startsWith('  + ') && !l.startsWith('  + generated')).length, 0, again.text);
  assert.equal(JSON.parse(read(root, 'package.json')).scripts.build, 'stunt-double check && tsc -b && vite build');
});
