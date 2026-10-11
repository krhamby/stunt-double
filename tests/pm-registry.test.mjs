// The REAL user path, with a registry: @acme/core and the @acme/core-slots placeholder are published to a local
// Verdaccio, and a project that follows only the three steps (install, one plugin line, src/overrides/) is installed
// with npm, pnpm, Yarn PnP and Bun. No fixture stand-in for the placeholder. Asserts:
//   - npm, pnpm and Bun auto-install the placeholder as the SDK's required peer; Yarn warns (YN0002) and installs
//     nothing; the three-step build passes and renders the overrides either way;
//   - a tool config without the adapter fails: STUNT-DOUBLE-NOT-WIRED where the placeholder is installed, a plain
//     resolve error under Yarn;
//   - `stunt-double init --universal` then links sdk-slots/ with that manager's link form, and the build still passes.
// Needs the npm registry (Verdaccio, pnpm, Yarn) and Bun. Run: npm run setup && node --test tests/pm-registry.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { summarize, compareRender, parseRenderOutput } from './harness/markers.mjs';
import { packageManagers, projectDir, run, REPO, PACKS, VERSIONS, firstProblem } from './package-managers/project.mjs';

const PMS = (process.env.SD_PMS ?? 'npm,pnpm,yarn,bun').split(',');
const pms = packageManagers();
const VERDACCIO = '6.10.5';
const EXPECT = { app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'], sdk: { BRAND_LOGO: 1, BRAND_PRICE: 3, 'BRAND_BUTTON(dark)': 3, 'SDK_DEFAULT_BUTTON(in-cart)': 3, SDK_DEFAULT_PRICETAG: 0 } };
const LINE = { npm: 'file:./sdk-slots', pnpm: 'link:./sdk-slots', yarn: 'portal:./sdk-slots', bun: 'workspace:*' };
const UNWIRED = `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n`;

let registry, server;
const freePort = () => new Promise((done) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });
const env = { NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };

before(async () => {
  const dir = projectDir('registry');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const tools = projectDir('verdaccio-tool');
  if (!fs.existsSync(path.join(tools, 'node_modules/verdaccio/package.json'))) {
    fs.mkdirSync(tools, { recursive: true });
    fs.writeFileSync(path.join(tools, 'package.json'), '{"private":true}');
    execFileSync('npm', ['install', '--no-audit', '--no-fund', `verdaccio@${VERDACCIO}`], { cwd: tools, stdio: 'ignore' });
  }
  fs.writeFileSync(path.join(dir, 'config.yaml'), `storage: ./storage\nauth:\n  htpasswd:\n    file: ./htpasswd\n    max_users: -1\nuplinks: {}\npackages:\n  '@acme/*':\n    access: $all\n    publish: $all\n  '**':\n    access: $all\nlog: { type: stdout, format: pretty, level: warn }\n`);
  const port = await freePort();
  registry = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(tools, 'node_modules/verdaccio/bin/verdaccio'), '--config', path.join(dir, 'config.yaml'), '--listen', `127.0.0.1:${port}`], { cwd: dir, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    if ((await run(['curl'], ['-sf', '--noproxy', '*', `${registry}/-/ping`], dir)).code === 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  fs.writeFileSync(path.join(dir, '.npmrc'), `@acme:registry=${registry}/\n//127.0.0.1:${port}/:_authToken=anonymous\n`);
  for (const t of ['acme-core-slots-0.0.1.tgz', 'acme-core-1.0.0.tgz']) {
    const r = await run(['npm'], ['publish', '--userconfig', path.join(dir, '.npmrc'), path.join(PACKS, t)], dir, { env });
    assert.equal(r.code, 0, r.out);
  }
});
after(() => server?.kill());

/** customer-vite as a user has it: the SDK from the registry, no placeholder stand-in, no link. */
function makeApp(pm) {
  const dir = projectDir(`registry-${pm}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const files = execFileSync('git', ['ls-files', '-z', 'examples/customer-vite'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const f of files) fs.cpSync(path.join(REPO, f), path.join(dir, path.relative('examples/customer-vite', f)));
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  delete pkg.overrides;
  pkg.dependencies['@acme/core'] = '1.0.0';
  pkg.devDependencies['stunt-double'] = `file:${path.join(PACKS, 'stunt-double-0.1.0.tgz')}`;
  delete pkg.devDependencies.vitest;
  pkg.scripts = { build: pkg.scripts.build, 'build:unwired': 'vite build --config vite.unwired.config.ts' };
  if (pm === 'yarn') { pkg.devDependencies.typescript = '5.9.3'; pkg.packageManager = `yarn@${VERSIONS.yarn}`; } // TS 7 cannot resolve under PnP
  if (pm === 'pnpm') pkg.packageManager = `pnpm@${VERSIONS.pnpm}`;
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  fs.writeFileSync(path.join(dir, 'vite.unwired.config.ts'), UNWIRED);
  fs.writeFileSync(path.join(dir, '.npmrc'), `package-lock=false\n@acme:registry=${registry}/\n`);
  if (pm === 'bun') fs.writeFileSync(path.join(dir, 'bunfig.toml'), `[install.scopes]\nacme = "${registry}/"\n`);
  if (pm === 'yarn') {
    // Yarn 4 quarantines versions published less than npmMinimalAgeGate ago ("All versions satisfying … are
    // quarantined"); this registry was filled seconds ago.
    fs.writeFileSync(path.join(dir, '.yarnrc.yml'), `nodeLinker: pnp\nenableGlobalCache: false\nunsafeHttpWhitelist: ["127.0.0.1"]\nnpmScopes:\n  acme:\n    npmRegistryServer: "${registry}"\n    npmMinimalAgeGate: 0\n`);
    fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
  }
  return dir;
}

const pmRun = (pm, args, dir) => run(pms[pm], args, dir, { env });
const installArgs = (pm) => (pm === 'npm' ? ['install', '--no-audit', '--no-fund'] : ['install']);

describe('registry: the three-step setup under each package manager', { concurrency: 4 }, () => {
  for (const pm of PMS) {
    test(pm, { skip: !pms[pm] && `${pm} not available` }, async () => {
      const dir = makeApp(pm);
      const i = await pmRun(pm, installArgs(pm), dir);
      assert.equal(i.code, 0, i.out.slice(-2000));
      const placeholder = path.join(dir, 'node_modules/@acme/core-slots/package.json');
      if (pm === 'yarn') {
        assert.match(i.out, /YN0002[^\n]*doesn't provide @acme\/core-slots[^\n]*requested by @acme\/core/);
      } else {
        // pnpm links the peer inside its virtual store, next to the SDK
        const sdkSide = path.join(fs.realpathSync(path.join(dir, 'node_modules/@acme/core')), '../core-slots/package.json');
        const f = [placeholder, sdkSide].find((x) => fs.existsSync(x));
        assert.ok(f, `${pm} did not auto-install the required peer @acme/core-slots`);
        assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).stuntDouble?.placeholder, true);
      }

      const b = await pmRun(pm, ['run', 'build'], dir);
      assert.equal(b.code, 0, b.out.slice(-3000));
      const r = await run(pm === 'yarn' ? [...pms.yarn, 'node'] : [process.execPath], ['probes/render.mjs'], dir, { env });
      assert.equal(r.code, 0, r.out.slice(-1500));
      assert.deepEqual(compareRender(summarize(parseRenderOutput(r.out)), EXPECT), []);

      const u = await pmRun(pm, ['run', 'build:unwired'], dir);
      assert.notEqual(u.code, 0, 'a config without the adapter must fail');
      if (pm === 'yarn') assert.match(u.out, /RESOLVE_ERROR\] Could not resolve '@acme\/core-slots\/Button'/, firstProblem(u.out));
      else assert.match(u.out, /STUNT-DOUBLE-NOT-WIRED/, firstProblem(u.out));

      const cli = pm === 'yarn' ? [...pms.yarn, 'stunt-double'] : [process.execPath, path.join(dir, 'node_modules/stunt-double/bin/stunt-double.mjs')];
      const init = await run(cli, ['init', '--universal'], dir, { env });
      assert.equal(init.code, 0, init.out);
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies['@acme/core-slots'], LINE[pm], init.out);
      const i2 = await pmRun(pm, installArgs(pm), dir);
      assert.equal(i2.code, 0, i2.out.slice(-2000));
      const b2 = await pmRun(pm, ['run', 'build'], dir);
      assert.equal(b2.code, 0, b2.out.slice(-3000));
      assert.ok(fs.existsSync(path.join(dir, 'sdk-slots/gen/Button.jsx')), 'universal tier generates into sdk-slots/');
    });
  }
});
