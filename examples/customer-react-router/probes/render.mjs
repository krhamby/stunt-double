#!/usr/bin/env node
// Render probe: load the BUILT React Router server bundle (build/server/index.js), serve GET / through
// react-router's own request handler and print stable markers. The cross-toolchain harness parses the
// STUNT-DOUBLE-RENDER line (the <main> of the server-rendered document); humans read the summary.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequestHandler } from 'react-router';

const entry = path.resolve(process.argv[2] ?? 'build/server/index.js');
const build = await import(pathToFileURL(entry).href);
const res = await createRequestHandler(build, 'production')(new Request('http://localhost/'));
const doc = await res.text();
if (res.status !== 200) { console.error(`GET / -> ${res.status}\n${doc.slice(0, 2000)}`); process.exit(1); }
const html = doc.split('<main>')[1]?.split('</main>')[0] ?? doc;
const section = (name) => html.split(`data-probe="${name}"`)[1]?.split('</section>')[0] ?? '';
const markers = (s) => [...s.matchAll(/data-sd="([A-Z_]+)"(?: data-ctx="([^"]*)")?/g)].map((m) => (m[2] ? `${m[1]}(${m[2]})` : m[1]));
console.log(`app: ${markers(section('app')).join(' > ')}`);
console.log(`sdk: ${markers(section('sdk')).join(', ')}`);
console.log('STUNT-DOUBLE-RENDER ' + JSON.stringify(html));
