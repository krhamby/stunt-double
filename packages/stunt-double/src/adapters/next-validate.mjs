// Shared by the Turbopack dev loader (next-loader.cjs): synchronous validation of a project.
//
// Validation ONLY (write: false). Shims are rewritten by the adapter's dev watcher in the server process: when the
// loader also wrote them from inside a compilation, Turbopack 16.4 kept serving the poisoned shim module after the
// fix, even after the shim file was touched again.
import fs from 'node:fs';
import path from 'node:path';
import { generate, regenerate } from '../core/generate.mjs';
import { formatProblems } from '../core/diagnostics.mjs';

const projects = new Map(); // key -> { p, at }

const inside = (f, dir) => f === dir || f.startsWith(dir + path.sep);

function newestOverride(dir) {
  let newest = 0;
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else try { newest = Math.max(newest, fs.statSync(f).mtimeMs); } catch {}
    }
  };
  try { newest = fs.statSync(dir).mtimeMs; } catch {}
  walk(dir);
  return newest;
}

/**
 * Called for every project source Turbopack compiles in dev. Files that are not an override, or not imported by
 * one, pass straight through. For the rest the project is re-validated, and the report is returned ('' = clean).
 * A worker's cached plan is refreshed whenever an override is newer than it, so a helper that an override starts
 * importing is checked from that save on, in every loader worker.
 */
export function validateFor(genOpts, file) {
  const key = JSON.stringify(genOpts);
  let e = projects.get(key);
  const validate = () => {
    const at = Date.now();
    const p = e ? regenerate(e.p, { onError: 'return', write: false }) : generate({ ...genOpts, onError: 'return', write: false });
    e = { p, at };
    projects.set(key, e);
  };
  if (!e || (e.p.overridesDir && newestOverride(e.p.overridesDir) >= e.at)) validate();
  const f = path.resolve(file);
  const relevant = inside(f, e.p.overridesDir) || e.p.closureFiles.has(f) || e.p.implFiles.includes(f);
  if (!relevant) return '';
  validate(); // the file being compiled has changed: always re-check it
  return e.p.problems.length ? formatProblems(e.p) : '';
}
