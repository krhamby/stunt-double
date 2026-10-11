#!/usr/bin/env node
// Render probe: `vitest run` (the "build" of a test-runner fixture) writes what it rendered in jsdom and in the node
// environment to dist/. Prints the jsdom render as the STUNT-DOUBLE-RENDER line the test harness parses, and
// fails if the two environments rendered different stunt doubles.
import fs from 'node:fs';

const read = (f) => fs.readFileSync(f, 'utf8');
const dom = read('dist/render.dom.html');
const ssr = read('dist/render.node.html');
const markers = (s) => [...s.matchAll(/data-sd="([A-Z0-9_]+)"(?: data-ctx="([^"]*)")?/g)].map((m) => (m[2] ? `${m[1]}(${m[2]})` : m[1])).join(' ');
if (markers(dom) !== markers(ssr)) {
  console.error(`jsdom and node renders differ:\n  jsdom: ${markers(dom)}\n  node:  ${markers(ssr)}`);
  process.exit(1);
}
console.log(`markers (jsdom = node): ${markers(dom)}`);
console.log('STUNT-DOUBLE-RENDER ' + JSON.stringify(dom));
