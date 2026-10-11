#!/usr/bin/env node
// Render probe: serve the built app (dist/), render it in Chromium and print stable
// markers. The cross-toolchain test harness parses the STUNT-DOUBLE-RENDER line; humans read the summary.
// Chromium: $STUNT_DOUBLE_CHROMIUM, else /opt/pw-browsers/chromium if present, else Playwright's own install.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const dir = path.resolve(process.argv[2] ?? 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const file = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const executablePath = process.env.STUNT_DOUBLE_CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.waitForSelector('#root [data-probe="sdk"]', { timeout: 20_000 }).catch(() => {});
  const html = await page.$eval('#root', (el) => el.innerHTML).catch(() => '');
  if (!html.includes('data-probe="sdk"')) throw new Error(`the app did not render${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  const section = (name) => html.split(`data-probe="${name}"`)[1]?.split('</section>')[0] ?? '';
  const markers = (s) => [...s.matchAll(/data-sd="([A-Z_]+)"(?: data-ctx="([^"]*)")?/g)].map((m) => (m[2] ? `${m[1]}(${m[2]})` : m[1]));
  console.log(`app: ${markers(section('app')).join(' > ')}`);
  console.log(`sdk: ${markers(section('sdk')).join(', ')}`);
  console.log('STUNT-DOUBLE-RENDER ' + JSON.stringify(html));
} finally {
  await browser.close();
  server.close();
}
