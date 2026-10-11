// Shared helpers for the test-runner suites (jest, vitest): a throwaway copy of an example project installed
// from the .packs/ tarballs, file mutations that are undone after each case, SDK variant swaps by tarball
// extraction, and a command runner that captures exit code + output.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PACKS = path.join(REPO, '.packs');

const SKIP = new Set(['node_modules', 'dist', 'dist-ssr', 'storybook-static', '.vite', 'coverage']);

/** Copy examples/<name> into a temp dir (file: tarball specs made absolute) and npm install it once. */
export function createWorkspace(example, { install = true } = {}) {
  if (!fs.existsSync(PACKS)) throw new Error('run `npm run setup` first (no .packs/)');
  const src = path.join(REPO, 'examples', example);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sd-${example}-`));
  fs.cpSync(src, dir, {
    recursive: true,
    filter: (f) => !SKIP.has(path.basename(f)) && !f.includes(`${path.sep}sdk-slots${path.sep}gen`) && !f.endsWith('stunt-double.check.ts') && !f.endsWith('package-lock.json'),
  });
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  for (const field of ['dependencies', 'devDependencies'])
    for (const [k, v] of Object.entries(pj[field] ?? {}))
      if (typeof v === 'string' && v.startsWith('file:') && v.endsWith('.tgz')) pj[field][k] = 'file:' + path.resolve(src, v.slice(5));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pj, null, 2) + '\n');
  const ws = new Workspace(dir);
  if (install) {
    const r = ws.run('npm', ['install', '--no-package-lock', '--no-audit', '--no-fund', '--loglevel=error'], { timeout: 600_000 });
    if (r.code !== 0) throw new Error(`npm install failed in ${dir}:\n${r.out}`);
  }
  return ws;
}

export class Workspace {
  constructor(dir) {
    this.dir = dir;
    this.saved = new Map();   // file -> original content (null = did not exist)
    this.sdkSwapped = false;
  }

  file(rel) { return path.join(this.dir, rel); }
  read(rel) { return fs.readFileSync(this.file(rel), 'utf8'); }
  exists(rel) { return fs.existsSync(this.file(rel)); }

  #remember(rel) {
    const f = this.file(rel);
    if (!this.saved.has(f)) this.saved.set(f, fs.existsSync(f) ? fs.readFileSync(f) : null);
  }
  write(rel, content) {
    this.#remember(rel);
    fs.mkdirSync(path.dirname(this.file(rel)), { recursive: true });
    fs.writeFileSync(this.file(rel), content);
  }
  remove(rel) {
    this.#remember(rel);
    fs.rmSync(this.file(rel), { force: true });
  }
  edit(rel, fn) { this.write(rel, fn(this.read(rel))); }

  /** Replace node_modules/<pkg> with the content of a .packs tarball (e.g. an @acme/core variant). */
  swapPackage(pkg, tarball) {
    const target = path.join(this.dir, 'node_modules', pkg);
    const backup = `${target}.__orig`;
    if (!fs.existsSync(backup)) {
      // a symlink (the slot package link) is moved as a link
      fs.renameSync(target, backup);
      this.swaps = [...(this.swaps ?? []), { target, backup }];
    } else fs.rmSync(target, { recursive: true, force: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-pack-'));
    const r = spawnSync('tar', ['xzf', path.join(PACKS, tarball), '-C', tmp]);
    if (r.status !== 0) throw new Error(`tar failed: ${r.stderr}`);
    fs.renameSync(path.join(tmp, 'package'), target);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /** Undo every write/remove/swap since the last reset. */
  reset() {
    for (const [f, content] of this.saved) {
      if (content === null) fs.rmSync(f, { force: true });
      else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); }
    }
    this.saved.clear();
    for (const { target, backup } of this.swaps ?? []) {
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(backup, target);
    }
    this.swaps = [];
    // drop empty dirs a mutation created (e.g. src/overrides/Button/)
    for (const d of ['src/overrides/Button', 'src/legacy']) {
      const f = this.file(d);
      if (fs.existsSync(f) && fs.readdirSync(f).length === 0) fs.rmdirSync(f);
    }
  }

  /** Run a command in the workspace; returns { code, out, ms }. Binaries resolve from node_modules/.bin. */
  run(cmd, args = [], { env = {}, timeout = 300_000, input } = {}) {
    const t0 = performance.now();
    const r = spawnSync(cmd, args, {
      cwd: this.dir,
      encoding: 'utf8',
      timeout,
      input,
      maxBuffer: 1 << 28,
      env: { ...process.env, PATH: `${path.join(this.dir, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH}`, CI: 'true', FORCE_COLOR: '0', NO_COLOR: '1', ...env },
    });
    return { code: r.status ?? (r.signal ? 128 : 1), out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`, ms: Math.round(performance.now() - t0) };
  }

  dispose() {
    if (!process.env.SD_KEEP_WORKSPACE) fs.rmSync(this.dir, { recursive: true, force: true });
  }
}
