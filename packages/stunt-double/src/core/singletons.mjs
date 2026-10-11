// F8 preflight: React, react-dom, the SDK and every layer must resolve to ONE install from every vantage point
// that can import them (app, SDK, slots dir, layers, override dirs). Two copies = "must be used within
// <Provider>" / invalid hook call at runtime.
import path from 'node:path';
import { real, findPackageJson } from './util.mjs';

export function checkSingletons({ root, sdk, slotsDir, layers = [], overrideDirs = [], singletons = ['react', 'react-dom'], rel }) {
  const vantage = { app: root, [sdk.name]: sdk.realDir, slots: slotsDir };
  for (const l of layers) vantage[l.name] = l.realDir;
  overrideDirs.forEach((d, i) => { vantage[i ? `overrides#${i}` : 'overrides'] = d; });
  const problems = [];
  for (const name of [...new Set([...singletons, sdk.name, ...layers.map((l) => l.name)])]) {
    const seen = {};
    for (const [k, dir] of Object.entries(vantage)) {
      let pj = null;
      try { pj = findPackageJson(name, dir); } catch {}
      if (pj) seen[k] = real(path.dirname(pj));
    }
    const distinct = [...new Set(Object.values(seen))];
    if (distinct.length > 1) {
      const groups = distinct.map((d) => `${Object.keys(seen).filter((k) => seen[k] === d).join(' + ')} -> ${rel(d)}`);
      problems.push(`[F8] "${name}" resolves to ${distinct.length} copies: ${groups.join(', ')}. Contexts/hooks break at runtime. Dedupe the install.`);
    }
  }
  return problems;
}
