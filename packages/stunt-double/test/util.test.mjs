// Small pure helpers whose behaviour shows up in user-facing messages and config handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearest, lev, globToRegExp, poisonText, parseJsonc, readDirective, loadConfig } from '../src/core/index.mjs';
import { tmpDir, write } from './helpers.mjs';

test('nearest(): typos within two edits, and stray suffixes', () => {
  const slots = ['Button', 'Card', 'Logo', 'PriceTag'];
  assert.equal(nearest('Buton', slots), 'Button');
  assert.equal(nearest('button', slots), 'Button', 'case-insensitive');
  assert.equal(nearest('Pricetag', slots), 'PriceTag');
  assert.equal(nearest('Button.override', slots), 'Button');
  assert.equal(nearest('Header', slots), undefined);
  assert.equal(lev('kitten', 'sitting'), 3);
});

test('globToRegExp(): **, * and plain directory prefixes', () => {
  assert.ok(globToRegExp('src/styleguide/**').test('src/styleguide/a/b.tsx'));
  assert.ok(globToRegExp('src/*.tsx').test('src/App.tsx'));
  assert.ok(!globToRegExp('src/*.tsx').test('src/pages/App.tsx'));
  assert.ok(globToRegExp('src/legacy').test('src/legacy/Old.tsx'), 'a glob without wildcards matches a directory prefix');
  assert.ok(!globToRegExp('src/legacy').test('src/legacy2/Old.tsx'));
});

test('poisonText(): safe inside a module specifier in every resolver', () => {
  const t = poisonText('[F2] src/overrides/Buton.tsx: "Buton" (did you mean "Button"?) #1 C:\\x\n next', 200);
  assert.doesNotMatch(t, /[/\\:?#"'\n]/);
  assert.match(t, /^\[F2\] src overrides Buton\.tsx/);
  assert.ok(poisonText('x'.repeat(500)).length <= 180);
});

test('parseJsonc(): comments, trailing commas, and // inside strings', () => {
  const v = parseJsonc(`{
    // comment
    "paths": { "@/*": ["./src/*"], }, /* block */
    "url": "https://example.com/a//b",
  }`);
  assert.deepEqual(v, { paths: { '@/*': ['./src/*'] }, url: 'https://example.com/a//b' });
});

test('readDirective(): "use client" after comments, not after code', () => {
  assert.equal(readDirective(`// banner\n/* x */\n'use client';\nexport {}`), 'use client');
  assert.equal(readDirective(`"use server"\n`), 'use server');
  assert.equal(readDirective(`import x from 'y';\n'use client';\n`), null);
});

test('loadConfig(): defaults, package.json "stuntDouble" key, unknown keys are errors', () => {
  const a = tmpDir('cfg');
  write(a, { 'package.json': { name: 'a' } });
  const d = loadConfig(a);
  assert.deepEqual(d.problems, []);
  assert.equal(d.cfg.overridesDir, 'src/overrides');
  assert.equal(d.configFile, null);
  const b = tmpDir('cfg');
  write(b, { 'package.json': { name: 'b', stuntDouble: { overridesDir: 'app/doubles' } } });
  assert.equal(loadConfig(b).cfg.overridesDir, 'app/doubles');
  const c = tmpDir('cfg');
  write(c, { 'package.json': { name: 'c' }, 'stunt-double.config.json': { overidesDir: 'x', map: { Button: { form: 'x' } } } });
  const out = loadConfig(c).problems.join('\n');
  assert.match(out, /\[CFG\] unknown key "overidesDir"/);
  assert.match(out, /\[CFG\] unknown key map\."Button"\.form/);
});
