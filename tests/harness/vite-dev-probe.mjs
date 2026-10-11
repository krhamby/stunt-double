#!/usr/bin/env node
// Child process of the Vite dev probe (tests/harness/vite-dev.mjs). Runs IN the fixture app (cwd) against the
// app's own Vite and vite.config: starts a real dev server, listens on the HMR websocket like the browser's
// overlay does, then plays a scenario of file edits. After each edit it polls until the expected state shows
// up (or a timeout) and records what it observed:
//   render   SSR render of `entry` through a FRESH module runner of the dev server (the same transform
//            pipeline and plugin as the browser's modules)
//   ws       {type:'error'} payloads the overlay would show
//   crawl    the browser's module graph, fetched over HTTP from index.html (status of every module), and
//            whether the dependency optimizer froze any project slot module into .vite/deps (F6d)
// Prints one line: STUNT-DOUBLE-DEV <json>.
//   usage: node vite-dev-probe.mjs <scenario.json>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { summarize, compareRender } from './markers.mjs';

const cwd = process.cwd();
const scenario = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const re = (s) => (s ? new RegExp(s) : null);

async function importVite() {
  const pj = path.join(cwd, 'node_modules', 'vite', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'));
  let e = pkg.exports?.['.'] ?? pkg.module ?? pkg.main;
  while (e && typeof e === 'object') e = e.import ?? e.default;
  return { vite: await import(pathToFileURL(path.join(path.dirname(pj), e)).href), version: pkg.version };
}

const terminal = [];
const customLogger = {
  info: (m) => terminal.push(`info: ${m}`),
  warn: (m) => terminal.push(`warn: ${m}`),
  warnOnce: (m) => terminal.push(`warn: ${m}`),
  error: (m) => terminal.push(`error: ${m}`),
  clearScreen() {},
  hasErrorLogged: () => false,
  hasWarned: false,
};

const { vite, version } = await importVite();
const out = { vite: version, started: false, steps: [] };
let server;
try {
  server = await vite.createServer({ root: cwd, clearScreen: false, customLogger, server: { port: 0, strictPort: false } });
  await server.listen();
  out.started = true;
} catch (e) {
  out.startError = String(e?.stack ?? e);
}

if (out.started) {
  const port = server.httpServer.address().port;
  const base = `http://localhost:${port}`;
  const wsMessages = [];
  const ws = new WebSocket(`ws://localhost:${port}/?token=${server.config.webSocketToken}`, 'vite-hmr');
  ws.onmessage = (e) => {
    try {
      const m = JSON.parse(String(e.data));
      if (m.type === 'error') wsMessages.push({ at: performance.now(), type: 'error', plugin: m.err?.plugin ?? null, message: String(m.err?.message ?? '') });
      else if (m.type === 'full-reload' || m.type === 'update') wsMessages.push({ at: performance.now(), type: m.type });
    } catch {}
  };
  await new Promise((r) => { ws.onopen = r; ws.onerror = r; setTimeout(r, 3000); });

  const render = async () => {
    const runner = vite.createServerModuleRunner(server.environments.ssr, { hmr: false });
    try {
      const mod = await runner.import(scenario.entry);
      const html = mod.render();
      return { html, summary: summarize(html) };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    } finally {
      await runner.close().catch(() => {});
    }
  };

  // static imports/re-exports at the start of a statement (Vite joins several on one line with ";"); not
  // dynamic import() calls, which also appear inside strings (React's dev warnings quote import('./MyComponent'))
  const IMPORT_RE = /(?:^|;)\s*(?:import|export)\s*(?:[\w*{}\s,$]*?\s*from\s*)?["']([^"']+)["']/gm;
  const crawl = async () => {
    const seen = new Map();
    const errors = [];
    const visit = async (url) => {
      if (seen.has(url)) return;
      seen.set(url, null);
      let res;
      try { res = await fetch(base + url, { signal: AbortSignal.timeout(15000) }); } catch (e) { errors.push({ url, status: 'FETCH', body: String(e) }); return; }
      const code = await res.text();
      if (!res.ok) { errors.push({ url, status: res.status, body: code.slice(0, 400) }); return; }
      seen.set(url, code);
      const deps = [];
      for (const m of code.matchAll(IMPORT_RE)) {
        const spec = m[1];
        if (spec.startsWith('/')) deps.push(spec);
        else if (spec.startsWith('.')) { const u = new URL(spec, `http://x${url}`); deps.push(u.pathname + u.search); }
      }
      await Promise.all(deps.map(visit));
    };
    const html = await (await fetch(base + '/')).text();
    const entries = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    await Promise.all(entries.map(visit));
    const depsDir = path.join(server.config.cacheDir, 'deps');
    let depsLeak = [];
    try {
      depsLeak = fs.readdirSync(depsDir).filter((f) => f.endsWith('.js'))
        .filter((f) => /data-sd["']?\s*[:=]\s*["']BRAND_|src\/overrides\//.test(fs.readFileSync(path.join(depsDir, f), 'utf8')));
    } catch {}
    return { modules: [...seen.keys()], errors, depsLeak };
  };

  const apply = (op) => {
    for (const [rel, text] of Object.entries(op.write ?? {})) { fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true }); fs.writeFileSync(path.join(cwd, rel), text); }
    for (const rel of op.remove ?? []) fs.rmSync(path.join(cwd, rel), { recursive: true, force: true });
    for (const [from, to] of Object.entries(op.rename ?? {})) fs.renameSync(path.join(cwd, from), path.join(cwd, to));
  };

  for (const step of scenario.steps) {
    const t0 = performance.now();
    const since = wsMessages.length;
    apply(step);
    const deadline = t0 + (step.timeoutMs ?? scenario.timeoutMs ?? 20000);
    let state;
    let ok = false;
    let errorsFromWs = [];
    for (;;) {
      await sleep(step.delayMs ?? 150);
      errorsFromWs = wsMessages.slice(since).filter((m) => m.type === 'error').map((m) => m.message);
      const wsOk = !step.wsError || errorsFromWs.some((m) => re(step.wsError).test(m));
      if (step.render || step.renderError) {
        state = await render();
        const renderOk = step.render
          ? !!state.summary && compareRender(state.summary, step.render).length === 0
          : !!state.error && re(step.renderError).test(state.error);
        ok = renderOk && wsOk;
      } else ok = wsOk;
      if (ok || performance.now() > deadline) break;
    }
    const rec = {
      label: step.label,
      ok,
      ms: Math.round(performance.now() - t0),
      observed: state?.summary ? { app: state.summary.app, sdk: state.summary.sdk } : state?.error ? { renderError: state.error.slice(0, 600) } : null,
      wsErrors: errorsFromWs.map((m) => m.slice(0, 600)),
      wsReloads: wsMessages.slice(since).filter((m) => m.type !== 'error').length,
    };
    if (state?.summary && step.render) rec.mismatch = compareRender(state.summary, step.render);
    if (step.crawl) {
      let c = await crawl();
      if (c.errors.some((e) => e.status === 504)) { await sleep(1000); c = await crawl(); } // optimizer re-run mid-crawl
      rec.crawl = { modules: c.modules.length, overrideModules: c.modules.filter((u) => u.includes('/overrides/')), errors: c.errors.map((e) => ({ url: e.url, status: e.status, body: e.body.slice(0, 300) })), depsLeak: c.depsLeak };
    }
    out.steps.push(rec);
  }
  try { ws.close(); } catch {}
}

out.terminal = terminal.map((l) => l.slice(0, 400)).slice(-30);
await server?.close().catch(() => {});
console.log('STUNT-DOUBLE-DEV ' + JSON.stringify(out));
process.exit(0);
