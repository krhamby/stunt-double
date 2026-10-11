#!/usr/bin/env node
// Bundle inspector (R5 evidence): read the source maps of every .js bundle in each given dist dir and report
//   - instances: how many BUNDLES carry the React / react-dom runtime (react/cjs/react.*.js,
//     react-dom/cjs/react-dom*.js; node bundles carry both the development and production build, only one
//     runs). More than one bundle = two React copies on one page / process: hooks and contexts break across
//     them ("Invalid hook call", useContext null).
//   - duplicated: source modules of react, react-dom or @acme/core that appear in more than one bundle.
//   node probes/bundles.mjs dist [dist-ssr ...]   -> one human line per dir + a STUNT-DOUBLE-BUNDLES JSON line
import fs from 'node:fs';
import path from 'node:path';

const RUNTIME = { react: /node_modules\/react\/cjs\/react\.(production|development)\.js$/, 'react-dom': /node_modules\/react-dom\/cjs\/react-dom(-client|-server[^/]*)?\.(production|development)\.js$/ };
const WATCHED = /node_modules\/(react|react-dom|@acme\/core)\//;

const report = {};
for (const dir of process.argv.slice(2)) {
  const bundles = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  const instances = Object.fromEntries(Object.keys(RUNTIME).map((n) => [n, []]));
  const owners = new Map();
  for (const b of bundles) {
    const mapFile = path.join(dir, b + '.map');
    if (!fs.existsSync(mapFile)) throw new Error(`${mapFile} missing: build with source maps`);
    const sources = new Set((JSON.parse(fs.readFileSync(mapFile, 'utf8')).sources ?? []).map((s) => s.replaceAll('\\', '/')));
    for (const s of sources) {
      for (const [n, re] of Object.entries(RUNTIME)) if (re.test(s) && !instances[n].includes(b)) instances[n].push(b);
      if (WATCHED.test(s)) owners.set(s, [...(owners.get(s) ?? []), b]);
    }
  }
  const duplicated = [...owners].filter(([, bs]) => bs.length > 1).map(([s, bs]) => `${s} in ${bs.join(', ')}`);
  report[dir] = { bundles, instances, duplicated };
  console.log(`bundles: ${dir}: ${bundles.length} js; react instances=${instances.react.length} react-dom instances=${instances['react-dom'].length}; duplicated modules=${duplicated.length}`);
}
console.log('STUNT-DOUBLE-BUNDLES ' + JSON.stringify(report));
