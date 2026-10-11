// `stunt-double init` x package manager on a FRESH official Vite template (create-vite 9.2.1, react-ts):
// `init --plugin` must give a project that builds once the required Logo override exists, mistakes must then fail
// that build, and `init --universal` must write the package manager's own link line, after which the project
// still builds and generates into the linked sdk-slots/. Needs the npm registry.
// Run: npm run setup && node --test tests/pm-init.test.mjs
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { packageManagers, projectDir, install, script, run, PACKS, VERSIONS, firstProblem, providePlaceholder } from './package-managers/project.mjs';

const PMS = (process.env.SD_PMS ?? 'npm,pnpm,yarn,bun').split(',');
const pms = packageManagers();
const CREATE_VITE = '9.2.1';
const LINE = { npm: 'file:./sdk-slots', pnpm: 'link:./sdk-slots', yarn: 'portal:./sdk-slots', bun: 'workspace:*' };
const LOGO = `import type { SlotProps } from '@acme/core/contracts';\nexport function Logo({ size = 24 }: SlotProps['Logo']) {\n  return <svg data-sd="BRAND_LOGO" width={size} height={size} />;\n}\n`;
const APP = `import { Button, Checkout } from '@acme/core';\nexport default function App() {\n  return <main><Button>Hi</Button><Checkout products={[{ id: 'a', name: 'A', price: 1 }]} /></main>;\n}\n`;

let template;
before(async () => {
  template = projectDir(`create-vite-${CREATE_VITE}`);
  if (!fs.existsSync(path.join(template, 'package.json'))) {
    fs.rmSync(template, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(template), { recursive: true });
    const r = await run(['npm'], ['create', '-y', `vite@${CREATE_VITE}`, path.basename(template), '--', '--template', 'react-ts', '--no-interactive'], path.dirname(template));
    assert.equal(r.code, 0, r.out);
  }
});

describe('stunt-double init x package manager (fresh Vite react-ts template)', { concurrency: 4 }, () => {
  for (const pm of PMS) {
    test(pm, { skip: !pms[pm] && `${pm} not available` }, async () => {
      const dir = projectDir(`init-${pm}`);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.cpSync(template, dir, { recursive: true });
      const pkgFile = path.join(dir, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      if (pm !== 'npm') pkg.packageManager = `${pm}@${pm === 'bun' ? '1.4.2' : VERSIONS[pm]}`;
      if (pm === 'yarn') {
        fs.writeFileSync(path.join(dir, '.yarnrc.yml'), 'nodeLinker: pnp\nenableGlobalCache: false\nenableTelemetry: false\n');
        fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
      }
      pkg.dependencies['@acme/core'] = `file:${path.join(PACKS, 'acme-core-1.0.0.tgz')}`;
      pkg.devDependencies['stunt-double'] = `file:${path.join(PACKS, 'stunt-double-0.1.0.tgz')}`;
      providePlaceholder(dir, pm, pkg); // stands in for the company registry's @acme/core-slots placeholder
      fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
      const first = await install(pms, pm, dir);
      assert.equal(first.code, 0, first.out.slice(-2000));
      const cli = pm === 'yarn' ? [...pms.yarn, 'stunt-double'] : [process.execPath, path.join(dir, 'node_modules/stunt-double/bin/stunt-double.mjs')];

      // 1. adapter tier: init --plugin, the required override, build
      const plugin = await run(cli, ['init', '--plugin'], dir);
      assert.equal(plugin.code, 0, plugin.out);
      assert.match(plugin.out, /\+ vite\.config\.ts: added stuntDouble\(\) to plugins/);
      fs.mkdirSync(path.join(dir, 'src/overrides'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src/App.tsx'), APP);
      const missing = await script(pms, pm, dir, 'build');
      assert.notEqual(missing.code, 0);
      assert.match(missing.out, /\[F3\] required slot "Logo" has no implementation/, firstProblem(missing.out));
      fs.writeFileSync(path.join(dir, 'src/overrides/Logo.tsx'), LOGO);
      const ok = await script(pms, pm, dir, 'build');
      assert.equal(ok.code, 0, ok.out.slice(-3000));

      fs.copyFileSync(path.join(dir, 'src/overrides/Logo.tsx'), path.join(dir, 'src/overrides/Lgo.tsx'));
      const typo = await script(pms, pm, dir, 'build');
      assert.notEqual(typo.code, 0);
      assert.match(typo.out, /\[F2\] src\/overrides\/Lgo\.tsx overrides unknown slot "Lgo" \(did you mean "Logo"\?\)/, firstProblem(typo.out));
      fs.rmSync(path.join(dir, 'src/overrides/Lgo.tsx'));
      fs.writeFileSync(path.join(dir, 'src/overrides/Button.tsx'), `import type { SlotProps } from '@acme/core/contracts';\nexport function Button({ children, tone }: SlotProps['Button'] & { tone: 'loud' }) {\n  return <button data-tone={tone}>{children}</button>;\n}\n`);
      const f1 = await script(pms, pm, dir, 'build');
      assert.notEqual(f1.code, 0);
      assert.match(f1.out, /\[F1\] Button \(src\/overrides\/Button\.tsx\): TS2322/, firstProblem(f1.out));
      fs.rmSync(path.join(dir, 'src/overrides/Button.tsx'));

      // 2. universal tier: init --universal writes this package manager's link line
      const uni = await run(cli, ['init', '--universal'], dir);
      assert.equal(uni.code, 0, uni.out);
      const after = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      assert.equal(after.dependencies['@acme/core-slots'], LINE[pm], uni.out);
      if (pm === 'bun') assert.ok(after.workspaces?.includes('sdk-slots'), 'bun: workspaces must include sdk-slots');
      assert.ok(fs.existsSync(path.join(dir, 'sdk-slots/package.json')));
      // a real project has no override for the placeholder (it came from the registry): drop the fixture's
      delete after.overrides; delete after.resolutions; fs.rmSync(path.join(dir, 'pnpm-workspace.yaml'), { force: true });
      fs.writeFileSync(pkgFile, JSON.stringify(after, null, 2));
      const second = await install(pms, pm, dir);
      assert.equal(second.code, 0, second.out.slice(-2000));
      const real = fs.realpathSync(path.join(dir, pm === 'yarn' ? 'sdk-slots' : 'node_modules/@acme/core-slots'));
      assert.equal(real, fs.realpathSync(path.join(dir, 'sdk-slots')));
      const linked = await script(pms, pm, dir, 'build');
      assert.equal(linked.code, 0, linked.out.slice(-3000));
      assert.ok(fs.existsSync(path.join(dir, 'sdk-slots/gen/Logo.jsx')), 'generated files must live in the linked sdk-slots/');
    });
  }
});
