#!/usr/bin/env node
// Render probe: import the BUILT SSR bundle (dist-ssr/entry-server.js), render <App/> and print stable
// markers. The cross-toolchain test harness parses the STUNT-DOUBLE-RENDER line; humans read the summary.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = path.resolve(process.argv[2] ?? 'dist-ssr/entry-server.js');
const { render } = await import(pathToFileURL(entry).href);
const html = render();
const section = (name) => html.split(`data-probe="${name}"`)[1]?.split('</section>')[0] ?? '';
const markers = (s) => [...s.matchAll(/data-sd="([A-Z_]+)"(?: data-ctx="([^"]*)")?/g)].map((m) => (m[2] ? `${m[1]}(${m[2]})` : m[1]));
console.log(`app: ${markers(section('app')).join(' > ')}`);
console.log(`sdk: ${markers(section('sdk')).join(', ')}`);
console.log('STUNT-DOUBLE-RENDER ' + JSON.stringify(html));
