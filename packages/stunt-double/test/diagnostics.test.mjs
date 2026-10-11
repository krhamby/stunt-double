// Diagnostics: tsc output parsing, mapping check-file diagnostics back to "[Fx] Slot (file): ..." lines, and the
// report format (header, one line per problem, docs footer).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseTscOutput, mapDiagnostics, formatProblems, header } from '../src/core/index.mjs';

const root = path.resolve('/work/app');
const p = {
  root,
  checkFile: path.join(root, '.stunt-double/check.ts'),
  overridesDir: path.join(root, 'src/overrides'),
  genDir: path.join(root, '.stunt-double/gen'),
  tsconfigRel: 'tsconfig.json',
  sdk: { name: '@acme/core', version: '1.0.0', slotPackage: '@acme/core-slots' },
  rel: (f) => path.relative(root, f).split(path.sep).join('/'),
};
const B = { slot: 'Button', file: 'src/overrides/Button.tsx' };
const map = {
  file: '.stunt-double/check.ts',
  lines: {
    9: { role: 'abi' },
    12: { role: 'wiring', slot: 'Button' },
    15: { role: 'slotset' },
    18: { role: 'import', ...B },
    19: { role: 'isComponent', ...B },
    20: { role: 'accepts', ...B },
    21: { role: 'declaresAll', ...B },
    23: { role: 'notAsync', ...B },
    30: { role: 'probe', slot: 'Card' },
  },
};

describe('parseTscOutput', () => {
  test('file diagnostics, continuation lines and global errors', () => {
    const out = parseTscOutput([
      `.stunt-double/check.ts(20,74): error TS2322: Type 'ButtonProps' is not assignable to type 'ButtonProps & { tone: "loud"; }'.`,
      `  Property 'tone' is missing in type 'ButtonProps' but required in type '{ tone: "loud"; }'.`,
      `error TS5083: Cannot read file 'tsconfig.json'.`,
    ].join('\n'));
    assert.equal(out.length, 2);
    assert.deepEqual({ ...out[0], message: undefined }, { file: '.stunt-double/check.ts', line: 20, col: 74, category: 'error', code: 'TS2322', message: undefined });
    assert.match(out[0].message, /not assignable[^]*Property 'tone' is missing/);
    assert.equal(out[1].file, null);
    assert.equal(out[1].code, 'TS5083');
  });
});

describe('mapDiagnostics', () => {
  const at = (line, code, msg) => `.stunt-double/check.ts(${line},1): error ${code}: ${msg}`;
  const one = (text) => mapDiagnostics(p, text, map);

  test('accepts -> [F1] naming the slot and the override file', () => {
    assert.deepEqual(one(at(20, 'TS2322', `Property 'tone' is missing.`)), [`[F1] Button (src/overrides/Button.tsx): TS2322 Property 'tone' is missing.`]);
  });

  test('declaresAll -> [F1] listing the ignored props and the opt-out', () => {
    const [l] = one(at(21, 'TS2322', `Type 'boolean' is not assignable to type '{ '[F1] override ignores these SDK props': "onClick" | "variant"; }'.`));
    assert.match(l, /^\[F1\] Button \(src\/overrides\/Button\.tsx\): override ignores these SDK props: "onClick" \| "variant" \(declare them, or list them in [^)]*ignoresProps\)$/);
  });

  test('isComponent -> [F1] not a component; import -> [F5]; notAsync -> [F9]', () => {
    assert.match(one(at(19, 'TS2322', `Type 'string' is not assignable to type 'JSXElementConstructor<any>'.`))[0], /^\[F1\] Button \(src\/overrides\/Button\.tsx\): is not a React component/);
    assert.match(one(at(18, 'TS2614', `Module has no exported member 'Button'.`))[0], /^\[F5\] Button \(src\/overrides\/Button\.tsx\): TS2614/);
    assert.match(one(at(23, 'TS2322', `Type 'true' is not assignable to type '{ ... }'.`))[0], /^\[F9\] Button \(src\/overrides\/Button\.tsx\): client slot override must not be an async component/);
  });

  test('abi / slot set / probe / wiring -> [STALE] with the regenerate hint', () => {
    for (const line of [9, 15, 30, 12]) assert.match(one(at(line, 'TS2322', 'x'))[0], /^\[STALE\][^\n]*npx stunt-double gen/, `line ${line}`);
  });

  test('a diagnostic inside an override file is [TS] and still fails', () => {
    assert.deepEqual(one(`src/overrides/Button.tsx(3,9): error TS2304: Cannot find name 'useThme'.`), [`[TS] src/overrides/Button.tsx(3,9): error TS2304: Cannot find name 'useThme'.`]);
  });

  test('duplicates collapse', () => {
    const text = [at(20, 'TS2322', 'same'), at(20, 'TS2322', 'same')].join('\n');
    assert.equal(one(text).length, 1);
  });
});

describe('report format', () => {
  test('header names the SDK; one line per problem, each starting with its code', () => {
    const msg = formatProblems({ sdk: p.sdk }, ['[F2] src/overrides/Buton.tsx overrides unknown slot "Buton"', '[F3] required slot "Logo" has no implementation']);
    const lines = msg.split('\n');
    assert.equal(lines[0], 'stunt-double: 2 injection errors (@acme/core@1.0.0)');
    assert.match(lines[1], /^ {2}\[F2\] /);
    assert.match(lines[2], /^ {2}\[F3\] /);
    assert.equal(header(null, 1), 'stunt-double: 1 injection error');
  });

  test('every report ends with a link to the docs section of each code it contains', () => {
    const msg = formatProblems({ sdk: p.sdk }, ['[F2] a', '[F2] b', '[F7] c']);
    const footer = msg.split('\n').filter((l) => /https?:\/\//.test(l));
    assert.equal(footer.length, 2, `one link per distinct code:\n${msg}`);
    assert.match(footer[0], /errors\.md#f2/);
    assert.match(footer[1], /errors\.md#f7/);
  });
});
