// Small, dependency-free helpers for the harness: spawning commands, files, hashing, globbing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PACKS_DIR = path.join(REPO_ROOT, '.packs');
/** Where fixture apps are installed. Override with STUNT_DOUBLE_WORK_DIR (e.g. to keep it on a fast disk). */
export const WORK_ROOT = path.resolve(process.env.STUNT_DOUBLE_WORK_DIR ?? path.join(os.tmpdir(), 'stunt-double-tests'));

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
export const stripAnsi = (s) => String(s).replace(ANSI, '');

export const sha = (data, n = 16) => crypto.createHash('sha256').update(data).digest('hex').slice(0, n);
export const posix = (p) => p.split(path.sep).join('/');

export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

/** Last `n` lines of a command's output, for assertion messages. */
export function tail(text, n = 40) {
  const lines = stripAnsi(text).trimEnd().split('\n');
  return (lines.length > n ? [`... (${lines.length - n} lines omitted)`, ...lines.slice(-n)] : lines).map((l) => `    | ${l}`).join('\n');
}

/**
 * Environment for child commands: no colours, no inherited npm lifecycle variables (an outer `npm test` must
 * not leak npm_config_* into the fixture's own `npm install` / `npm run`), node_modules/.bin first on PATH.
 */
export function childEnv(cwd, extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^npm_/i.test(k) || k === 'INIT_CWD' || k === 'NODE_OPTIONS' || k === 'VITEST' || k.startsWith('VITEST_') || k === 'NODE_TEST_CONTEXT') continue;
    env[k] = v;
  }
  env.PATH = [path.join(cwd, 'node_modules', '.bin'), process.env.PATH].join(path.delimiter);
  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  env.CI = env.CI ?? '1';
  return { ...env, ...extra };
}

/**
 * Run a shell command in `cwd`. Never throws for a non-zero exit: returns { code, signal, output, stdout,
 * stderr, ms, timedOut }. `output` is stdout+stderr in arrival order, ANSI-stripped.
 */
export function run(command, { cwd, env = {}, timeout = 240_000, input = null } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn('sh', ['-c', command], { cwd, env: childEnv(cwd, env), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let stderr = '';
    let output = '';
    let timedOut = false;
    child.stdout.on('data', (d) => { stdout += d; output += d; });
    child.stderr.on('data', (d) => { stderr += d; output += d; });
    if (input != null) child.stdin.end(input); else child.stdin.end();
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, timeout);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        command, code: timedOut ? null : code, signal, timedOut,
        stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), output: stripAnsi(output),
        ms: Math.round(performance.now() - t0),
      });
    });
  });
}

/** Recursively list files (relative, posix) below `dir`, skipping `skip` directory names. */
export function listTree(dir, { skip = ['node_modules', '.git'] } = {}) {
  const out = [];
  const walk = (d, rel) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!skip.includes(e.name)) walk(path.join(d, e.name), r); }
      else if (e.isFile() || e.isSymbolicLink()) out.push(r);
    }
  };
  walk(dir, '');
  return out.sort();
}

/** Minimal glob for posix-relative paths: `**`, `*`, `?`. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Files under `root` matching a posix glob relative to it. */
export function glob(root, pattern) {
  const re = globToRegExp(pattern);
  return listTree(root).filter((f) => re.test(f)).map((f) => path.join(root, f));
}

export function copyFiles(fromRoot, files, toRoot) {
  for (const rel of files) {
    const from = path.join(fromRoot, rel);
    const to = path.join(toRoot, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

/** Remove everything in `dir` except the names in `keep`. */
export function emptyDirExcept(dir, keep) {
  let ents = [];
  try { ents = fs.readdirSync(dir); } catch { return; }
  for (const name of ents) if (!keep.includes(name)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
}

export function fileHash(file) {
  try { return sha(fs.readFileSync(file)); } catch { return 'missing'; }
}
