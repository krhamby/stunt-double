#!/usr/bin/env node
// Render probe: read the BUILT static page (dist/index.html, rendered by Astro's server graph at build time)
// and print stable markers for the static sections (app, sdk) and the React island (prerendered HTML).
// The cross-toolchain harness parses the STUNT-DOUBLE-RENDER line; humans read the summary.
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(process.argv[2] ?? 'dist/index.html');
const doc = fs.readFileSync(file, 'utf8');
const html = doc.split('<main>')[1]?.split('</main>')[0] ?? doc;
const section = (name) => html.split(`data-probe="${name}"`)[1]?.split('</section>')[0] ?? '';
const markers = (s) => [...s.matchAll(/data-sd="([A-Z_]+)"(?: data-ctx="([^"]*)")?/g)].map((m) => (m[2] ? `${m[1]}(${m[2]})` : m[1]));
console.log(`app: ${markers(section('app')).join(' > ')}`);
console.log(`sdk: ${markers(section('sdk')).join(', ')}`);
console.log(`island: ${markers(section('island')).join(', ')}`);
console.log('STUNT-DOUBLE-RENDER ' + JSON.stringify(html));
