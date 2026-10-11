#!/usr/bin/env node
// Render probe: serve a BUILT Storybook (storybook-static*/) over HTTP, render stories in headless Chromium
// (playwright-core) and print stable markers. The test harness parses the STUNT-DOUBLE-RENDER line (the
// rendered HTML of every story, concatenated); humans read the per-story summary.
//
//   node probes/render.mjs [storybook-static] [story-id ...]
//
// Browser: PLAYWRIGHT_CHROMIUM_EXECUTABLE, else playwright-core's own lookup (PLAYWRIGHT_BROWSERS_PATH).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

export const STORIES = ['app-button--primary', 'sdk-checkout--default', 'app-page--page'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

function serve(dir) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const file = path.join(dir, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

/** @returns {Promise<Record<string, {html: string, errors: string[]}>>} */
export async function renderStories(dir, ids = STORIES) {
  const server = await serve(path.resolve(dir));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  const out = {};
  try {
    for (const id of ids) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(`${base}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story`);
      // Storybook marks the body once the story rendered (sb-show-main) or failed (sb-show-errordisplay).
      await page.waitForFunction(() => /sb-show-(errordisplay|nopreview)/.test(document.body.className)
        || (/sb-show-main/.test(document.body.className) && document.querySelector('#storybook-root')?.childElementCount > 0), null, { timeout: 30_000 }).catch(() => {});
      const html = await page.evaluate(() => (/sb-show-main/.test(document.body.className) ? document.querySelector('#storybook-root')?.innerHTML ?? '' : `STORY-ERROR ${document.body.className}: ${document.querySelector('#error-message')?.textContent ?? ''} ${document.querySelector('#error-stack')?.textContent ?? ''}`));
      out[id] = { html, errors };
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir = 'storybook-static', ...ids] = process.argv.slice(2);
  const res = await renderStories(dir, ids.length ? ids : STORIES);
  const markers = (s) => [...s.matchAll(/data-sd="([A-Z0-9_]+)"(?: data-ctx="([^"]*)")?/g)].map((m) => (m[2] ? `${m[1]}(${m[2]})` : m[1]));
  for (const [id, r] of Object.entries(res)) console.log(`${id}: ${markers(r.html).join(', ') || r.html.slice(0, 300)}${r.errors.length ? `  [errors: ${r.errors.join(' | ')}]` : ''}`);
  console.log('STUNT-DOUBLE-RENDER ' + JSON.stringify(Object.values(res).map((r) => r.html).join('\n')));
}
