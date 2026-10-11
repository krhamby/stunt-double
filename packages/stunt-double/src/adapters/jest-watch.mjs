// stunt-double/jest watch plugin (added by withStuntDouble): `jest --watch` loads the config once, so without
// this an override added, renamed or removed mid-session would keep the previous decision. On every file
// change it regenerates (only changed bytes are written; Jest then re-runs the tests that import the shim).
// Injection errors poison the shims, so affected tests fail with the [Fx] text instead of rendering a default.
import { generate, regenerate } from '../core/generate.mjs';
import { formatProblems } from '../core/diagnostics.mjs';

export default class StuntDoubleWatchPlugin {
  constructor({ config = {} } = {}) {
    this.opts = { root: config.root, ...(config.configFile ? { configFile: config.configFile } : {}) };
    this.p = null;
    this.reported = '';
  }

  regen() {
    try {
      this.p = this.p ? regenerate(this.p, { onError: 'poison' }) : generate({ ...this.opts, onError: 'poison' });
      return this.p.problems.length ? formatProblems(this.p) : '';
    } catch (e) {
      return String(e?.message ?? e);
    }
  }

  apply(jestHooks) {
    jestHooks.onFileChange(() => { this.reported = this.regen(); });
    jestHooks.onTestRunComplete(() => { if (this.reported) process.stderr.write(`\n${this.reported}\n`); });
  }
}
