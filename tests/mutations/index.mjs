// The SHARED mutation catalogue: every injection mistake of the failure catalogue (docs/DESIGN.md §2), written
// once and run by every toolchain suite against its own fixture app. A suite adjusts expectations per tool
// (which command catches it, its native message, a documented residual) instead of copying scenarios.
//
// A mutation:
//   id        stable id ('F2a', 'F7c', ...), used in test names and in per-suite `expectations`
//   title     one line
//   catches   which stage is expected to catch it (informational: STA, TYP, RES, CFG, AUD)
//   tags      'sta' | 'typegate' | 'res' | 'cfg' | 'aud' | 'upgrade' | 'must-pass' | 'sdk-bug' | 'rsc' | 'stale' | 'config'
//   family    only for suites of this tool family (e.g. 'vite'); absent = every suite
//   needs     suite features it requires (a key of suite.commands, or 'unwired'); missing = skipped with a reason
//   sdk       SDK variant to install first (default: the fixture's own, 1.0.0)
//   apply     (fx, suite) => void | Promise<void>: edit the fixture copy (fx: tests/harness/fixture.mjs)
//   expect    { outcome, command: '<suite command name>' | run: '<literal shell command>',
//               messages: [RegExp], absent: [RegExp], render: {...markers}, bundle: {...} }
//             outcome 'fail': non-zero exit + every message;  'pass': exit 0 (+ render / bundle);
//             'safe': either fails with the messages or passes AND renders the overrides (a mistake the tool
//             may make impossible by construction); never a silent SDK default
import f1 from './f1-contract.mjs';
import naming from './f2-f5-naming.mjs';
import f6 from './f6-not-applied.mjs';
import f7f9 from './f7-f9.mjs';
import viteFamily from './vite-family.mjs';

export const catalogue = Object.freeze([...f1, ...naming, ...f6, ...f7f9, ...viteFamily]);

const ids = new Set();
for (const m of catalogue) {
  if (ids.has(m.id)) throw new Error(`mutation catalogue: duplicate id ${m.id}`);
  ids.add(m.id);
  if (!m.expect?.outcome || (!m.expect.command && !m.expect.run)) throw new Error(`mutation catalogue: ${m.id} has no expect.outcome / expect.command`);
}

export const byId = (id) => catalogue.find((m) => m.id === id);

/** Mutations that apply to a suite of tool family `family`. */
export function forFamily(family) {
  return catalogue.filter((m) => !m.family || m.family === family);
}
