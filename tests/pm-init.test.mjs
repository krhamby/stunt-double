// `stunt-double init` x package manager on a FRESH official Vite template (create-vite 9.2.1, react-ts):
// init must write that package manager's link line (replacing the auto-installed registry placeholder),
// the project must build after one reinstall + the required Logo override, and mistakes must then fail it.
// Needs the npm registry. Run: npm run setup && node --test tests/pm-init.test.mjs
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { packageManagers, projectDir, install, script, run, PACKS, VERSIONS, firstProblem } from './package-managers/project.mjs';

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
      // what `<pm> add @acme/core stunt-double` produces once the SDK team has published the placeholder
      // (npm/pnpm/Bun auto-install the required peer; here the placeholder comes from .packs/)
      pkg.dependencies['@acme/core'] = `file:${path.join(PACKS, 'acme-core-1.0.0.tgz')}`;
      pkg.dependencies['@acme/core-slots'] = `file:${path.join(PACKS, 'acme-core-slots-0.0.1.tgz')}`;
      pkg.devDependencies['stunt-double'] = `file:${path.join(PACKS, 'stunt-double-0.1.0.tgz')}`;
      fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
      const first = await install(pms, pm, dir);
      // Bun 1.4.2 resolves the SDK's peer from the registry even though package.json declares it as a tarball;
      // the placeholder is not published in this test setup, so that first install fails (after populating node_modules).
      if (pm === 'bun') assert.ok(first.code === 0 || /@acme%2fcore-slots - 404/.test(first.out), first.out.slice(-1500));
      else assert.equal(first.code, 0, first.out.slice(-2000));

      const cli = pm === 'yarn' ? [...pms.yarn, 'stunt-double'] : [process.execPath, path.join(dir, 'node_modules/stunt-double/bin/stunt-double.mjs')];
      const init = await run(cli, ['init'], dir);
      assert.equal(init.code, 0, init.out);
      const after = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      assert.equal(after.dependencies['@acme/core-slots'], LINE[pm], init.out);
      if (pm === 'bun') assert.ok(after.workspaces?.includes('sdk-slots'), 'bun: workspaces must include sdk-slots');
      assert.match(after.scripts.postinstall, /stunt-double gen --no-fail/);
      const second = await install(pms, pm, dir);
      assert.equal(second.code, 0, second.out.slice(-2000));

      fs.mkdirSync(path.join(dir, 'src/overrides'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src/overrides/Logo.tsx'), LOGO);
      fs.writeFileSync(path.join(dir, 'src/App.tsx'), APP);
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
    });
  }
});
