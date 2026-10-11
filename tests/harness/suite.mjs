// defineToolSuite(): the one entry point a toolchain suite calls. It installs the suite's fixture app once,
// then registers node:test tests for the positive scenario, every applicable mutation of the SHARED catalogue
// (tests/mutations), and optionally a dev-server probe, a TypeScript 5.9 run and the universal tier.
// See tests/README.md for the API and a worked example.
import fs from 'node:fs';
import path from 'node:path';
import { describe, test, before, after } from 'node:test';
import { Fixture, FileOps } from './fixture.mjs';
import { packageManager } from './pm.mjs';
import { STANDARD_RENDER, STANDARD_BUNDLE, assertFailed, assertPassed, assertMessages, assertRender, assertBundle } from './expect.mjs';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, listTree, writeJson } from './util.mjs';
import { catalogue } from '../mutations/index.mjs';

const MINUTE = 60_000;
export const TYPESCRIPT5 = Object.freeze({ alias: 'typescript5', spec: 'npm:typescript@5.9.3' });

/**
 * @param {object} spec
 * @param {string} spec.name             suite name ('vite', 'webpack', ...): test names + work dir
 * @param {string} spec.fixtureDir       the example app, relative to the repo root
 * @param {string} [spec.family]         tool family; enables family-only mutations (e.g. 'vite')
 * @param {string} [spec.toolConfig]     the tool's config file (family mutations edit it), e.g. 'vite.config.ts'
 * @param {string} [spec.pm]             package manager (default 'npm')
 * @param {object} spec.commands         shell commands, run in the app with node_modules/.bin on PATH:
 *        build (required)  the production build; must exit non-zero on every mistake
 *        render (required) prints a STUNT-DOUBLE-RENDER line (tests/harness/markers.mjs) for the built app
 *        check             default 'stunt-double check'
 *        checkThenBuild    default `${check} && ${build}` (for tools that only catch a cell via the CLI gate)
 *        test, ...         any other named command, referenced by expectations (`command: 'test'`)
 * @param {(fx, t, suite) => Promise<void>} [spec.devProbe]  dev-server scenario (see tests/harness/vite-dev.mjs)
 * @param {object} [spec.positive]       { render, bundle: { files, contains, absent }, alsoPass: ['test', ...] }
 * @param {object} [spec.unwired]        { files: { rel: text }, command }: a config of this tool WITHOUT the adapter
 * @param {object|Function} [spec.expectations]  per-mutation overrides: { F1a: { command: 'checkThenBuild' },
 *        F5a: { outcome: 'pass', residual: 'why' }, F6c: 'skip reason' } or (mutation, expect) => override
 * @param {(list) => list} [spec.mutations]  filter/extend the applicable catalogue
 * @param {boolean|object} [spec.typescript5]  also run the type-gate mutations with TypeScript 5.9 (npm alias)
 * @param {object} [spec.universal]      universal tier: { files, build, bare, mutations: [ids] } (see README)
 * @param {string[]} [spec.outputs]      build output dirs the build may create (simplicity-bar check)
 * @param {string} [spec.generatedDir]   where stunt-double may write generated files (default '.stunt-double')
 */
export function defineToolSuite(spec) {
  const suite = normalize(spec);
  const results = [];
  const timeout = suite.timeout;

  describe(suite.name, { concurrency: 1 }, () => {
    const fx = new Fixture({
      name: suite.name, fixtureDir: suite.fixtureDir, pm: suite.pm, sdk: suite.sdk, layout: suite.layout,
      addDependencies: suite.addDependencies,
      addDevDependencies: { ...suite.addDevDependencies, ...(suite.typescript5 ? { [TYPESCRIPT5.alias]: suite.typescript5.spec } : {}) },
    });
    before(() => fx.prepare(), { timeout: 15 * MINUTE });
    after(async () => {
      await fx.finish();
      report(suite, results, fx);
    }, { timeout: 15 * MINUTE });

    test('positive: overrides render app-level and inside SDK components; replaced default absent from the bundle', { timeout }, async (t) => {
      await runPositive(fx, suite, t, results);
    });

    for (const m of suite.mutations) {
      const exp = resolveExpectation(suite, m);
      const name = `${m.id}: ${m.title}${exp.residual ? ' [documented residual]' : ''}`;
      test(name, { timeout, skip: exp.skip ?? false }, async (t) => {
        await runMutation(fx, suite, m, exp, t, results);
      });
    }

    if (suite.devProbe) {
      test('dev: add/remove an override switches what renders without a restart; a mistake surfaces an error and clears when fixed', { timeout }, async (t) => {
        const record = { suite: suite.name, id: 'dev', expected: 'live', steps: [] };
        results.push(record);
        await fx.reset();
        await fx.useSdk();
        const t0 = performance.now();
        await suite.devProbe(fx, t, suite);
        record.steps.push({ command: 'dev probe', exit: 0, ms: Math.round(performance.now() - t0) });
        record.status = 'ok';
      });
    }

    if (suite.typescript5) {
      describe(`TypeScript 5.9 type gate (${TYPESCRIPT5.alias} = ${suite.typescript5.spec}, config "typescript": "${TYPESCRIPT5.alias}")`, { concurrency: 1 }, () => {
        const config = { typescript: TYPESCRIPT5.alias };
        test('positive (TS 5.9): stunt-double check and the build pass, overrides render', { timeout }, async (t) => {
          await runPositive(fx, suite, t, results, { config, label: 'ts5', checkVersion: /tsc 5\.9\.\d/ });
        });
        for (const m of suite.mutations.filter(suite.typescript5.select)) {
          const exp = resolveExpectation(suite, m);
          test(`${m.id} (TS 5.9): ${m.title}`, { timeout, skip: exp.skip ?? false }, async (t) => {
            await runMutation(fx, suite, m, { ...exp, messages: [...[].concat(exp.messages ?? []), ...(exp.outcome === 'fail' && m.tags?.includes('typegate') ? [/tsc 5\.9\.\d/] : [])] }, t, results, { config, label: 'ts5' });
          });
        }
      });
    }

    if (suite.universal) defineUniversal(suite, fx, results);
  });
}

// ---- normalisation ----------------------------------------------------------------------------------------
function normalize(spec) {
  if (!spec?.name || !spec.fixtureDir || !spec.commands?.build || !spec.commands?.render)
    throw new Error('defineToolSuite: name, fixtureDir, commands.build and commands.render are required');
  const commands = { check: 'stunt-double check', ...spec.commands };
  commands.checkThenBuild ??= `${commands.check} && ${commands.build}`;
  if (spec.unwired) commands.unwired ??= spec.unwired.command;
  const has = (need) => (need === 'unwired' ? !!spec.unwired : !!commands[need]);
  let mutations = catalogue.filter((m) => !m.family || m.family === spec.family);
  if (spec.mutations) mutations = spec.mutations(mutations);
  const ts5 = spec.typescript5 === true ? {} : spec.typescript5 || null;
  return {
    pm: 'npm',
    timeout: 5 * MINUTE,
    outputs: ['dist'],
    generatedDir: '.stunt-double',
    ...spec,
    commands,
    has,
    mutations: mutations.map((m) => ({ ...m, missing: (m.needs ?? []).filter((n) => !has(n)) })),
    positive: { render: STANDARD_RENDER, bundle: null, alsoPass: [], ...spec.positive },
    typescript5: ts5 && { spec: TYPESCRIPT5.spec, select: (m) => m.tags?.includes('typegate'), ...ts5 },
    layout: spec.layout,
    sdk: spec.sdk,
  };
}

function resolveExpectation(suite, m) {
  let exp = { ...m.expect };
  if (m.missing.length) return { ...exp, skip: `suite "${suite.name}" defines no ${m.missing.join(', ')} (see tests/README.md)` };
  const o = typeof suite.expectations === 'function' ? suite.expectations(m, exp) : suite.expectations?.[m.id];
  if (typeof o === 'string') return { ...exp, skip: o };
  if (o === false) throw new Error(`suite "${suite.name}": expectations.${m.id} = false; give the reason as a string instead`);
  if (o) exp = { ...exp, ...o };
  if (m.expect.outcome === 'fail' && exp.outcome !== 'fail' && !exp.residual && !exp.skip)
    throw new Error(`suite "${suite.name}": expectations.${m.id} turns a failing mistake into "${exp.outcome}" without a \`residual\` reason (never weaken silently)`);
  return exp;
}

// ---- scenarios ----------------------------------------------------------------------------------------------
async function runPositive(fx, suite, t, results, { config = null, label = '', checkVersion = null } = {}) {
  await fx.reset();
  await fx.useSdk();
  if (config) fx.config(config);
  const record = { suite: suite.name, id: `positive${label ? `-${label}` : ''}`, expected: 'pass', steps: [] };
  results.push(record);
  if (checkVersion) {
    const c = await step(fx, record, t, suite.commands.check);
    assertPassed(c, 'stunt-double check: ');
    assertMessages(c, [checkVersion]);
  }
  const r = await step(fx, record, t, suite.commands.build);
  assertPassed(r, 'build: ');
  assertRender(await step(fx, record, t, suite.commands.render), suite.positive.render);
  if (suite.positive.bundle) assertBundle(fx.app, { ...STANDARD_BUNDLE, ...suite.positive.bundle });
  for (const name of suite.positive.alsoPass) assertPassed(await step(fx, record, t, suite.commands[name] ?? name), `${name}: `);
  if (!config) assertSimplicityBar(fx, suite);
  record.status = 'ok';
}

async function runMutation(fx, suite, m, exp, t, results, { config = null, label = '' } = {}) {
  const record = { suite: suite.name, id: `${m.id}${label ? `-${label}` : ''}`, expected: exp.outcome, residual: exp.residual, steps: [] };
  results.push(record);
  await fx.reset();
  await fx.useSdk(exp.sdk ?? m.sdk ?? fx.sdk.version);
  if (config) fx.config(config);
  await m.apply(fx, suite);
  if (exp.residual) t.diagnostic(`documented residual: ${exp.residual}`);
  await check(fx, suite, exp, t, record);
  for (const also of exp.also ?? []) await check(fx, suite, { outcome: exp.outcome, messages: exp.messages, ...also }, t, record);
  record.status = 'ok';
}

async function check(fx, suite, exp, t, record) {
  const command = exp.run ?? suite.commands[exp.command];
  if (!command) throw new Error(`suite "${suite.name}" has no command "${exp.command}"`);
  const r = await step(fx, record, t, command);
  const what = `[${exp.run ? 'command' : exp.command}] `;
  if (exp.outcome === 'safe') {
    // either outcome is fine for the north star, but never a silent default: a failure must carry the
    // expected code; a pass must render the overrides
    record.observed = r.code === 0 ? 'passed (prevented by construction)' : 'failed';
    t.diagnostic(`outcome: ${record.observed}`);
    if (r.code !== 0) { assertFailed(r, what); assertMessages(r, exp.messages, exp.absent, what); return; }
    assertRender(await step(fx, record, t, suite.commands.render), exp.render ?? suite.positive.render, what);
    return;
  }
  if (exp.outcome === 'fail') {
    assertFailed(r, what);
    assertMessages(r, exp.messages, exp.absent, what);
    return;
  }
  assertPassed(r, what);
  assertMessages(r, [], exp.absent, what);
  if (exp.render) assertRender(await step(fx, record, t, suite.commands.render), exp.render, what);
  if (exp.bundle) assertBundle(fx.app, exp.bundle, what);
}

async function step(fx, record, t, command) {
  const r = await fx.run(command);
  record.steps.push({ command, exit: r.code, ms: r.ms });
  t.diagnostic(`${command}  ->  exit ${r.timedOut ? 'TIMEOUT' : r.code} in ${r.ms} ms`);
  return r;
}

/**
 * The owner's simplicity bar: a build must not touch project files. No new or edited files outside the build
 * outputs and the generated directory: nothing under src/, no tsconfig / package.json / .gitignore edits.
 */
function assertSimplicityBar(fx, suite) {
  const pristine = new Set(listTree(fx.pristine));
  const allowed = [...suite.outputs, suite.generatedDir].map((d) => `${d.replace(/\/$/, '')}/`);
  const problems = [];
  for (const f of listTree(fx.app)) {
    if (allowed.some((a) => f.startsWith(a))) continue;
    if (!pristine.has(f)) problems.push(`created ${f}`);
    else if (fs.readFileSync(path.join(fx.app, f), 'utf8') !== fs.readFileSync(path.join(fx.pristine, f), 'utf8')) problems.push(`modified ${f}`);
  }
  if (problems.length) throw new Error(`simplicity bar: the build changed project files (only ${allowed.join(', ')} may be written):\n  ${problems.join('\n  ')}`);
}

// ---- universal tier ---------------------------------------------------------------------------------------
/**
 * Universal tier (DESIGN.md §2.2 T0): the generated directory is a LINKED PACKAGE that answers the socket for
 * tools without an adapter. Turns an adapter-tier fixture into its universal-tier twin: the package manager's
 * link line, the committed stub and the config key that moves generated files into the linked directory.
 */
export async function universalTransform({ pm = 'npm', slotPackage = '@acme/core-slots', dir = 'sdk-slots', configFile = 'stunt-double.config.json', files = {} } = {}) {
  const manager = packageManager(pm);
  const { DEFAULTS } = await import(pathToFileURL(path.join(REPO_ROOT, 'packages/stunt-double/src/core/index.mjs')).href);
  const outKey = 'outDir' in DEFAULTS ? 'outDir' : 'slotsDir';
  const stub = {
    name: slotPackage, version: '0.0.0', private: true, type: 'module', sideEffects: false,
    description: 'Universal-tier slot package (generated by the stunt-double test harness). No dependencies or peers, ever.',
    exports: { './package.json': './package.json', './*': { types: './gen/*.d.ts', default: './gen/*.jsx' } },
  };
  const apply = (ops) => {
    ops.json('package.json', (pkg) => {
      pkg.dependencies = { ...pkg.dependencies, [slotPackage]: manager.link(dir) };
      if (manager.workspaces) pkg.workspaces = [...new Set([...(pkg.workspaces ?? []), dir])];
      // The fixtures stand in for the npm registry with an override that installs the placeholder tarball. A
      // real project has no such line; with the link it would conflict with the direct dependency (EOVERRIDE).
      for (const holder of [pkg.overrides, pkg.resolutions, pkg.pnpm?.overrides]) if (holder) delete holder[slotPackage];
    });
    if (!ops.exists(`${dir}/package.json`)) ops.write(`${dir}/package.json`, JSON.stringify(stub, null, 2) + '\n');
    ops.json(configFile, (c) => ({ ...c, [outKey]: dir }));
    for (const [rel, text] of Object.entries(files)) ops.write(rel, text);
  };
  apply.key = JSON.stringify({ pm, slotPackage, dir, outKey, files });
  apply.dir = dir;
  return apply;
}

function defineUniversal(suite, mainFx, results) {
  const u = suite.universal;
  const timeout = suite.timeout;
  describe(`universal tier (${u.pm ?? suite.pm}: package link + \`stunt-double check &&\`, tool WITHOUT the adapter)`, { concurrency: 1 }, () => {
    let fx = null;
    let transform = null;
    before(async () => {
      transform = await universalTransform({ pm: u.pm ?? suite.pm, files: u.files });
      fx = new Fixture({
        name: `${suite.name}-universal`, fixtureDir: suite.fixtureDir, pm: u.pm ?? suite.pm, sdk: suite.sdk, layout: suite.layout,
        addDependencies: suite.addDependencies, addDevDependencies: suite.addDevDependencies,
        transform, transformKey: transform.key,
      });
      await fx.prepare();
    }, { timeout: 15 * MINUTE });
    after(() => fx?.finish(), { timeout: 15 * MINUTE });

    test('T0 positive: overrides render through the package link, with no adapter in the tool config', { timeout }, async (t) => {
      const record = { suite: suite.name, id: 'T0-positive', expected: 'pass', steps: [] };
      results.push(record);
      await fx.reset();
      await fx.useSdk();
      assertPassed(await step(fx, record, t, u.build), 'universal build: ');
      assertRender(await step(fx, record, t, suite.commands.render), suite.positive.render);
      if (suite.positive.bundle) assertBundle(fx.app, { ...STANDARD_BUNDLE, ...suite.positive.bundle });
      record.status = 'ok';
    });

    for (const id of u.mutations ?? []) {
      const m = suite.mutations.find((x) => x.id === id) ?? catalogue.find((x) => x.id === id);
      if (!m) throw new Error(`suite "${suite.name}": universal.mutations names unknown mutation ${id}`);
      test(`T0 ${m.id}: ${m.title} (caught by the \`stunt-double check &&\` prefix)`, { timeout }, async (t) => {
        await runMutation(fx, { ...suite, commands: { ...suite.commands, build: u.build } }, m, { ...m.expect, command: 'build' }, t, results, { label: 't0' });
      });
    }

    test('T0 not wired: link declared but never installed (registry placeholder in node_modules) fails, never renders defaults', { timeout }, async (t) => {
      const record = { suite: suite.name, id: 'T0-not-wired', expected: 'fail', steps: [] };
      results.push(record);
      await mainFx.reset();
      await mainFx.useSdk();
      transform(new FileOps(mainFx.app)); // the edits of the universal tier, without reinstalling
      const c = await step(mainFx, record, t, suite.commands.check);
      assertFailed(c, 'stunt-double check: ');
      assertMessages(c, [/\[F6\][^\n]*placeholder/]);
      const b = await step(mainFx, record, t, u.bare);
      assertFailed(b, 'bare build: ');
      assertMessages(b, [/STUNT-DOUBLE-NOT-WIRED/]);
      record.status = 'ok';
    });

    test('T0 bare (no `stunt-double check &&`): a typo\'d NEW override is silently unused [documented residual R1]; the prefix catches it', { timeout }, async (t) => {
      const record = { suite: suite.name, id: 'T0-bare-residual', expected: 'pass (residual) / fail', steps: [] };
      results.push(record);
      await fx.reset();
      await fx.useSdk();
      fx.remove(fx.override('PriceTag.tsx'));
      const g = await step(fx, record, t, 'stunt-double gen');
      assertPassed(g, 'stunt-double gen: ');
      fx.write(fx.override('PriceTg.tsx'), fx.pristineText(fx.override('PriceTag.tsx')));
      const bare = await step(fx, record, t, u.bare);
      assertPassed(bare, 'bare build (residual R1: nothing validates without the prefix): ');
      assertRender(await step(fx, record, t, suite.commands.render), { sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0 } });
      const chained = await step(fx, record, t, u.build);
      assertFailed(chained, 'with the prefix: ');
      assertMessages(chained, [/\[F2\][^\n]*PriceTg\.tsx[^\n]*did you mean "PriceTag"/]);
      record.status = 'ok';
    });
  });
}

// ---- reporting --------------------------------------------------------------------------------------------
function report(suite, results, fx) {
  const file = path.join(fx.dir, 'results.json');
  writeJson(file, { suite: suite.name, at: new Date().toISOString(), node: process.version, install: fx.log, results });
  const rows = results.map((r) => {
    const ms = r.steps.reduce((s, x) => s + x.ms, 0);
    const exits = r.steps.map((x) => x.exit).join(',');
    return `  ${(r.status === 'ok' ? 'ok  ' : 'FAIL')}  ${r.id.padEnd(22)} expected ${String(r.expected).padEnd(5)} exits [${exits}]  ${ms} ms${r.residual ? '  (documented residual)' : ''}`;
  });
  console.log(`\n${suite.name}: ${results.filter((r) => r.status === 'ok').length}/${results.length} scenarios ok (${fx.log.join('; ')})\n${rows.join('\n')}\n  results: ${file}\n`);
}
