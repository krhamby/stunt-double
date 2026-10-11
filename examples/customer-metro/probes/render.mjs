#!/usr/bin/env node
// Render probe: evaluate the BUILT Metro bundle (dist/main.js) in a fresh V8 context, render <App/> with
// react-dom/server (bundled by Metro) and print stable markers. The cross-toolchain test harness parses the
// STUNT-DOUBLE-RENDER line; humans read the summary.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const bundle = path.resolve(process.argv[2] ?? 'dist/main.js');
const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, TextEncoder, TextDecoder, MessageChannel };
sandbox.globalThis = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(bundle, 'utf8'), sandbox, { filename: bundle });
if (typeof sandbox.__stuntDoubleRender !== 'function') throw new Error(`${bundle} did not register __stuntDoubleRender`);
const html = sandbox.__stuntDoubleRender();
const section = (name) => html.split(`data-probe="${name}"`)[1]?.split('</section>')[0] ?? '';
const markers = (s) => [...s.matchAll(/data-sd="([A-Z_]+)"(?: data-ctx="([^"]*)")?/g)].map((m) => (m[2] ? `${m[1]}(${m[2]})` : m[1]));
console.log(`app: ${markers(section('app')).join(' > ')}`);
console.log(`sdk: ${markers(section('sdk')).join(', ')}`);
console.log('STUNT-DOUBLE-RENDER ' + JSON.stringify(html));
process.exit(0); // React's scheduler holds a MessageChannel port open
