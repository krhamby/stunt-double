// One bundler suite = positive builds + every mistake in ./mistakes.mjs against up to three commands:
//   t1     the tool with the stunt-double adapter: the default 3-step setup (no link, no tsconfig edits; the
//          registry placeholder is what the SDK's peer resolves to)
//   chain  universal tier (`stunt-double init --universal`: the sdk-slots/ link) + `stunt-double check && <tool
//          without adapter>`
//   bare   universal tier, the tool without adapter and without the chain (what R1 in DESIGN.md §14 is about)
// t1 runs in a copy of the default project, chain and bare in a copy of the universal one.
// The suite file gives, per mistake and command, the OBSERVED outcome: 'pass' or { fail: [codes | /regex/] }.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { workspace, probe, assertRender, assertOutcome, bundleText, POSITIVE } from './lib.mjs';
import { MISTAKES } from './mistakes.mjs';

/**
 * @param {object} s
 * @param {string} s.name                     suite title
 * @param {string} s.example                  examples/<example>
 * @param {Record<string, (dir: string) => object>} s.commands   t1 (required), chain, bare: run in a project dir
 * @param {(dir: string) => void} [s.prepareBare]               write the adapter-less build script into a project
 * @param {Record<string, object>} s.expect   per mistake id: { t1, chain?, bare?, render?, bareProbe? }
 * @param {string} [s.clientDir]              client bundle dir (must not contain replaced defaults)
 * @param {(ctx: object) => void} [s.extra]   tool-specific tests (watch, audit, ...)
 */
export function bundlerSuite(s) {
  const ws = workspace(s.example);
  // bare first: t1 and chain regenerate the shims, bare must see what the last install left behind.
  const commands = ['bare', 'chain', 't1'].filter((c) => s.commands[c]);

  describe(s.name, () => {
    before(() => { ws.install(); if (commands.some((c) => c !== 't1')) ws.installUniversal(); });
    after(() => ws.cleanup());

    const dirFor = (c, dirs) => (c === 't1' ? dirs.t1 : dirs.universal);
    describe('positive', () => {
      const dirs = {};
      before(() => {
        dirs.t1 = ws.project('positive', s.prepareBare);
        if (commands.some((c) => c !== 't1')) dirs.universal = ws.project('positive-universal', s.prepareBare, { universal: true });
      });
      test('t1 build renders every override, in app code and inside the SDK', () => {
        const dir = dirs.t1;
        const r = s.commands.t1(dir);
        assert.equal(r.code, 0, ws.show(r));
        assertRender(ws, probe(dir));
        if (s.clientDir) {
          const text = bundleText(path.join(dir, s.clientDir));
          assert.ok(text.includes('BRAND_PRICE') && text.includes('BRAND_BUTTON'), 'client bundle lacks the overrides');
          assert.ok(!text.includes('SDK_DEFAULT_PRICETAG'), 'the replaced PriceTag default is still in the client bundle');
        }
      });
      for (const c of commands.filter((c) => c !== 't1')) test(`${c} (universal tier) renders every override`, () => {
        const dir = dirs.universal;
        const r = s.commands[c](dir);
        assert.equal(r.code, 0, ws.show(r));
        assertRender(ws, probe(dir, s.probeEntry?.[c]));
      });
    });

    for (const m of MISTAKES) {
      const want = s.expect[m.id];
      if (!want) continue;
      describe(`${m.id}: ${m.what}`, () => {
        const dirs = {};
        const mutate = (d) => { s.prepareBare?.(d); m.apply(d, ws); };
        before(() => {
          if ('t1' in want) dirs.t1 = ws.project(`m-${m.id}`, mutate);
          if (commands.some((c) => c !== 't1' && c in want)) dirs.universal = ws.project(`m-${m.id}-universal`, mutate, { universal: true });
        });
        for (const c of commands) {
          if (!(c in want)) continue;
          test(`${c}: ${describeOutcome(want[c])}`, () => {
            const dir = dirFor(c, dirs);
            const r = s.commands[c](dir);
            assertOutcome(ws, r, want[c], `${m.id} / ${c}`);
            if (want[c] === 'pass' && c === 't1' && want.render !== null) assertRender(ws, probe(dir), want.render ?? POSITIVE);
            if (want[c] === 'pass' && c === 'bare' && want.bareProbe) {
              const p = probe(dir, s.probeEntry?.bare);
              if (want.bareProbe === 'crash') assert.notEqual(p.code, 0, `expected the bare bundle to crash at runtime\n${ws.show(p)}`);
              else assertRender(ws, p, want.bareProbe);
            }
          });
        }
      });
    }

    s.extra?.({ ws });
  });
}

function describeOutcome(w) {
  if (w === 'pass') return 'passes';
  return `fails with ${[].concat(w.fail).map(String).join(' ')}`;
}
