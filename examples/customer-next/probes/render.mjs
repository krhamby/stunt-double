#!/usr/bin/env node
// Render probe: read the page `next build` prerendered (.next/server/app/index.html) and print stable markers.
// The cross-toolchain test harness parses the STUNT-DOUBLE-RENDER line; humans read the summary.
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(process.argv[2] ?? '.next/server/app/index.html');
const html = fs.readFileSync(file, 'utf8');
const section = (name) => html.split(`data-probe="${name}"`)[1]?.split('</section>')[0] ?? '';
const markers = (s) => [...s.matchAll(/data-sd="([A-Z_]+)"(?: data-ctx="([^"]*)")?/g)].map((m) => (m[2] ? `${m[1]}(${m[2]})` : m[1]));
console.log(`app: ${markers(section('app')).join(' > ')}`);
console.log(`sdk: ${markers(section('sdk')).join(', ')}`);
console.log('STUNT-DOUBLE-RENDER ' + JSON.stringify(html));
