#!/usr/bin/env node
// Render probe: CRA has no SSR build, so serve the BUILT client bundle (build/) over a local HTTP server, render
// it in headless Chromium and print stable markers from the live DOM. The cross-toolchain test harness parses
// the STUNT-DOUBLE-RENDER line; humans read the summary. Any page error or console error fails the probe.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const dir = path.resolve(process.argv[2] ?? 'build');
if (!fs.existsSync(path.join(dir, 'index.html'))) {
  console.error(`render probe: ${path.join(dir, 'index.html')} does not exist (run the build first)`);
  process.exit(1);
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(dir, url);
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));

// An override that renders its own slot (F7 without the adapter) never settles: report it, do not hang.
setTimeout(() => { console.error('render probe: the page did not settle within 30 s (infinite render?)'); process.exit(1); }, 30_000).unref();

const executablePath = process.env.CHROMIUM_PATH ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath });
const problems = [];
let html = '';
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForSelector('[data-probe="sdk"]', { timeout: 10_000 }).catch(() => {});
  html = await page.$eval('#root', (el) => el.innerHTML);
} finally {
  await browser.close();
  server.close();
}

const section = (name) => html.split(`data-probe="${name}"`)[1]?.split('</section>')[0] ?? '';
const markers = (s) => [...s.matchAll(/data-sd="([A-Z0-9_]+)"(?: data-ctx="([^"]*)")?/g)].map((m) => (m[2] ? `${m[1]}(${m[2]})` : m[1]));
console.log(`app: ${markers(section('app')).join(' > ')}`);
console.log(`sdk: ${markers(section('sdk')).join(', ')}`);
for (const p of problems) console.error(p);
console.log('STUNT-DOUBLE-RENDER ' + JSON.stringify(html));
if (problems.length || !html) process.exit(1);
