// Regression: Storybook builder-webpack5 sets `bail: true` in production. The first module error (e.g. a shim
// that static validation did not emit) then aborts the build, and errors pushed to compilation.errors are
// never printed. One-shot builds must therefore fail from compiler.hooks.run with the formatted [Fx] problems.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withStuntDouble, StuntDoublePlugin } from '../src/adapters/webpack.mjs';

/** Just enough of a webpack Compiler: records hook taps. */
function fakeCompiler() {
  const taps = {};
  const hook = (name) => ({ tap: (_n, fn) => ((taps[name] ??= []).push(fn)), tapPromise: (_n, fn) => ((taps[name] ??= []).push(fn)) });
  return {
    taps,
    options: { mode: 'production' },
    webpack: { WebpackError: class WebpackError extends Error {} },
    hooks: { run: hook('run'), watchRun: hook('watchRun'), thisCompilation: hook('thisCompilation') },
  };
}

test('one-shot builds reject in compiler.hooks.run when static validation has problems', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-webpack-run-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'no-sdk', private: true }));
  const config = withStuntDouble({}, { root });
  const plugin = config.plugins.find((x) => x instanceof StuntDoublePlugin);
  assert.ok(plugin.p.problems.length > 0, 'fixture must have problems (no SDK installed)');
  const compiler = fakeCompiler();
  plugin.apply(compiler);
  assert.equal(compiler.taps.run?.length, 1, 'the adapter must tap compiler.hooks.run');
  await assert.rejects(compiler.taps.run[0](compiler), (e) => e.name === 'StuntDoubleError' && /injection error/.test(e.message));
});

test('compiler.hooks.run passes when there are no problems', async () => {
  const compiler = fakeCompiler();
  new StuntDoublePlugin({ problems: [], warnings: [] }).apply(compiler);
  await compiler.taps.run[0](compiler);
});
