#!/usr/bin/env node
// Browser render probe: serve a built dist dir, load it in headless Chromium (Playwright) and print the same
// marker lines as probes/render.mjs, from the LIVE DOM after React rendered on the client. Page errors and
// console errors are printed as "error:" lines and make the probe exit 1 (a duplicate React crashes here).
//   node probes/browser.mjs [dist] [page.html]
// Playwright is resolved from this project, then from the global npm root (PLAYWRIGHT_BROWSERS_PATH picks the
// browser); run `npx playwright install chromium` once if neither has one.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const dist = path.resolve(process.argv[2] ?? 'dist');
const page = process.argv[3] ?? 'index.html';

function loadPlaywright() {
  for (const from of [path.join(process.cwd(), 'package.json'), () => path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'x')]) {
    try { return createRequire(typeof from === 'function' ? from() : from)('playwright'); } catch {}
  }
  console.error('probe: playwright not found (npm i -D playwright, or install it globally)');
  process.exit(2);
}
const { chromium } = loadPlaywright();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };
const server = http.createServer((req, res) => {
  const file = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const errors = [];
const browser = await chromium.launch();
try {
  const tab = await browser.newPage();
  tab.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  tab.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  tab.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  tab.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  await tab.goto(`http://127.0.0.1:${server.address().port}/${page}`);
  await tab.waitForSelector('[data-probe="sdk"] [data-sd]', { timeout: 10_000 }).catch(() => {});
  await tab.waitForTimeout(200);
  const html = await tab.evaluate(() => document.getElementById('root')?.innerHTML ?? '');
  const section = (name) => html.split(`data-probe="${name}"`)[1]?.split('</section>')[0] ?? '';
  const markers = (s) => [...s.matchAll(/data-sd="([A-Z0-9_]+)"(?: data-ctx="([^"]*)")?/g)].map((m) => (m[2] ? `${m[1]}(${m[2]})` : m[1]));
  console.log(`app: ${markers(section('app')).join(' > ')}`);
  console.log(`sdk: ${markers(section('sdk')).join(', ')}`);
  for (const e of errors) console.log(`error: ${e}`);
  console.log('STUNT-DOUBLE-RENDER ' + JSON.stringify(html));
} finally {
  await browser.close();
  server.close();
}
process.exit(errors.length ? 1 : 0);
