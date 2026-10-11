// A fixture app installed ONCE into a temp work dir from the .packs tarballs, then reset to its pristine
// source before every scenario (mutation). Resetting copies source files only; node_modules is reused, and the
// SDK variant is swapped with a real reinstall only when a scenario asks for another one.
//
//   <WORK_ROOT>/<name>/pristine   the fixture's source (git-tracked + untracked-not-ignored files), with
//                                 file: specs that point outside the fixture rewritten to absolute paths
//   <WORK_ROOT>/<name>/app        the installed copy every command runs in
//   <WORK_ROOT>/<name>/install.json   install key: an unchanged fixture + unchanged tarballs reuse node_modules
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, PACKS_DIR, WORK_ROOT, run, sha, readJson, writeJson, listTree, copyFiles, emptyDirExcept, fileHash, posix, tail } from './util.mjs';
import { packageManager, ALL_LOCKFILES } from './pm.mjs';

export const DEFAULT_SDK = Object.freeze({
  name: '@acme/core',
  slotPackage: '@acme/core-slots',
  version: '1.0.0',
  /** tarball in .packs for an SDK variant ("1.0.0", "2.0.0", "1.0.0-bad-relative", ...) */
  tarball: (variant) => `acme-core-${variant}.tgz`,
});

export const DEFAULT_LAYOUT = Object.freeze({ srcDir: 'src', overridesDir: 'src/overrides', configFile: 'stunt-double.config.json' });

const CACHE_DIRS = ['.vite', '.vite-temp', '.tmp', '.cache'];
const SPEC_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

/** File operations rooted at a directory (used on the installed app and, before install, on the pristine copy). */
export class FileOps {
  constructor(root) { this.root = root; }
  abs(rel) { return path.resolve(this.root, rel); }
  exists(rel) { return fs.existsSync(this.abs(rel)); }
  read(rel) { return fs.readFileSync(this.abs(rel), 'utf8'); }
  write(rel, text) {
    const f = this.abs(rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    return this;
  }
  remove(rel) {
    const f = this.abs(rel);
    if (!fs.existsSync(f)) throw new Error(`harness: cannot remove ${rel}: it does not exist in ${this.root}`);
    fs.rmSync(f, { recursive: true, force: true });
    return this;
  }
  rename(from, to) {
    if (!this.exists(from)) throw new Error(`harness: cannot rename ${from}: it does not exist in ${this.root}`);
    fs.mkdirSync(path.dirname(this.abs(to)), { recursive: true });
    fs.renameSync(this.abs(from), this.abs(to));
    return this;
  }
  /** Edit a text file; `fn` must change it (an edit that silently does nothing would make a scenario vacuous). */
  edit(rel, fn) {
    const before = this.read(rel);
    const after = fn(before);
    if (typeof after !== 'string' || after === before) throw new Error(`harness: edit of ${rel} changed nothing (the fixture no longer has the shape this scenario expects)`);
    return this.write(rel, after);
  }
  /** Read-modify-write a JSON file (created as {} when absent). `fn` may mutate and/or return the value. */
  json(rel, fn) {
    const cur = this.exists(rel) ? JSON.parse(this.read(rel)) : {};
    const next = fn(cur) ?? cur;
    return this.write(rel, JSON.stringify(next, null, 2) + '\n');
  }
}

/** Source files of a fixture as a fresh clone would have them (plus uncommitted, not-ignored work). */
export function fixtureSourceFiles(sourceDir) {
  const relDir = posix(path.relative(REPO_ROOT, sourceDir));
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', relDir], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const files = out.split('\0').filter(Boolean).map((f) => posix(path.relative(relDir, f))).filter((f) => !f.startsWith('..'));
    const existing = [...new Set(files)].filter((f) => fs.existsSync(path.join(sourceDir, f)) && fs.statSync(path.join(sourceDir, f)).isFile());
    if (existing.length) return existing.sort();
  } catch {}
  // no git (e.g. a source tarball): everything except the usual generated/installed directories
  const skip = ['node_modules', '.git', 'dist', 'dist-ssr', 'build', 'out', 'coverage', '.next', '.vite', '.stunt-double', 'gen'];
  return listTree(sourceDir, { skip }).filter((f) => !/(^|\/)src\/stunt-double\.check\.ts$/.test(f));
}

/** Rewrite file:/link:/portal: specs that point OUTSIDE the fixture to absolute paths (the copy lives elsewhere). */
export function rewriteSpecs(value, fromDir) {
  if (typeof value === 'string') {
    const m = /^(file|link|portal):(.+)$/.exec(value);
    if (!m || path.isAbsolute(m[2])) return value;
    const abs = path.resolve(fromDir, m[2]);
    const inside = !path.relative(fromDir, abs).startsWith('..');
    return inside ? value : `${m[1]}:${abs}`;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteSpecs(v, fromDir)]));
  return value;
}

function rewritePackageJson(pkg, fromDir) {
  const out = { ...pkg };
  for (const f of [...SPEC_FIELDS, 'overrides', 'resolutions']) if (out[f]) out[f] = rewriteSpecs(out[f], fromDir);
  if (out.pnpm?.overrides) out.pnpm = { ...out.pnpm, overrides: rewriteSpecs(out.pnpm.overrides, fromDir) };
  return out;
}

/** npm lockfile: keep pinned registry versions, point file: tarballs at absolute paths, drop their integrity. */
function rewriteNpmLock(lock, pkg, fromDir) {
  if (!lock?.packages) return null;
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === '') {
      for (const f of SPEC_FIELDS) if (pkg[f]) entry[f] = { ...pkg[f] }; else delete entry[f];
      continue;
    }
    if (typeof entry.resolved === 'string' && entry.resolved.startsWith('file:')) {
      const next = rewriteSpecs(entry.resolved, fromDir);
      if (next !== entry.resolved) { entry.resolved = next; delete entry.integrity; }
    }
  }
  return lock;
}

export class Fixture {
  /**
   * @param {object} o
   * @param {string} o.name          unique work-dir name (e.g. "vite", "vite-universal")
   * @param {string} o.fixtureDir    fixture source, relative to the repo root (e.g. "examples/customer-vite")
   * @param {string} [o.pm]          package manager (default npm)
   * @param {object} [o.sdk]         SDK naming (default @acme/core, see DEFAULT_SDK)
   * @param {object} [o.layout]      where sources / overrides / config live (see DEFAULT_LAYOUT)
   * @param {object} [o.addDependencies]     extra deps written into the copy's package.json before install
   * @param {object} [o.addDevDependencies]  e.g. { typescript5: 'npm:typescript@5.9.3' }
   * @param {(ops: FileOps) => void|Promise<void>} [o.transform]  applied to the pristine copy before install
   * @param {string} [o.transformKey]  cache key of `transform` (changes when the transform changes)
   */
  constructor(o) {
    this.name = o.name;
    this.sourceDir = path.resolve(REPO_ROOT, o.fixtureDir);
    this.pm = packageManager(o.pm ?? 'npm');
    this.sdk = { ...DEFAULT_SDK, ...o.sdk };
    this.layout = { ...DEFAULT_LAYOUT, ...o.layout };
    this.addDependencies = o.addDependencies ?? {};
    this.addDevDependencies = o.addDevDependencies ?? {};
    this.transform = o.transform ?? null;
    this.transformKey = o.transformKey ?? (o.transform ? String(o.transform) : '');
    this.dir = path.join(WORK_ROOT, this.name);
    this.app = path.join(this.dir, 'app');
    this.pristine = path.join(this.dir, 'pristine');
    this.files = new FileOps(this.app);
    this.installedSdk = null;
    this.log = [];
  }

  // ---- lifecycle --------------------------------------------------------------------------------------
  /** Copy + rewrite the fixture into pristine/, install into app/ (reused when nothing changed). */
  async prepare() {
    if (!fs.existsSync(this.sourceDir)) throw new Error(`harness: fixture ${posix(path.relative(REPO_ROOT, this.sourceDir))} does not exist`);
    this.requireTarball(this.sdk.version);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.rmSync(this.pristine, { recursive: true, force: true });
    copyFiles(this.sourceDir, fixtureSourceFiles(this.sourceDir), this.pristine);
    const pristine = new FileOps(this.pristine);
    let pkg = rewritePackageJson(JSON.parse(pristine.read('package.json')), this.sourceDir);
    pkg.dependencies = { ...pkg.dependencies, ...this.addDependencies };
    if (Object.keys(this.addDevDependencies).length) pkg.devDependencies = { ...pkg.devDependencies, ...this.addDevDependencies };
    pristine.write('package.json', JSON.stringify(pkg, null, 2) + '\n');
    for (const lf of ALL_LOCKFILES) if (lf !== this.pm.lockfile && pristine.exists(lf)) pristine.remove(lf);
    if (this.pm.name === 'npm' && pristine.exists('package-lock.json')) {
      const lock = rewriteNpmLock(JSON.parse(pristine.read('package-lock.json')), pkg, this.sourceDir);
      if (lock) pristine.write('package-lock.json', JSON.stringify(lock, null, 2) + '\n'); else pristine.remove('package-lock.json');
    } else if (pristine.exists(this.pm.lockfile) && this.pm.name !== 'npm') pristine.remove(this.pm.lockfile); // relative tarball paths inside
    if (this.transform) await this.transform(pristine, this);
    pkg = JSON.parse(pristine.read('package.json'));

    const key = this.installKey();
    const state = readJson(path.join(this.dir, 'install.json'));
    if (state?.key === key && state.sdk === this.sdk.version && fs.existsSync(path.join(this.app, 'node_modules')) && !process.env.STUNT_DOUBLE_REINSTALL) {
      this.installedSdk = state.sdk;
      this.note(`reused the install in ${this.app}`);
      await this.reset();
      return this;
    }
    fs.rmSync(path.join(this.dir, 'install.json'), { force: true });
    fs.rmSync(this.app, { recursive: true, force: true });
    copyFiles(this.pristine, listTree(this.pristine), this.app);
    const r = await this.run(this.pm.install, { timeout: 600_000 });
    if (r.code !== 0) throw new Error(`harness: "${this.pm.install}" failed in ${this.app} (exit ${r.code})\n${tail(r.output)}`);
    this.note(`installed with ${this.pm.name} in ${r.ms} ms`);
    // keep what the package manager wrote to the lockfile, so resets do not fight it
    if (fs.existsSync(path.join(this.app, this.pm.lockfile))) fs.copyFileSync(path.join(this.app, this.pm.lockfile), path.join(this.pristine, this.pm.lockfile));
    this.installedSdk = this.sdk.version;
    writeJson(path.join(this.dir, 'install.json'), { key, sdk: this.installedSdk, at: new Date().toISOString() });
    await this.reset();
    return this;
  }

  installKey() {
    const packs = fs.existsSync(PACKS_DIR) ? fs.readdirSync(PACKS_DIR).filter((f) => f.endsWith('.tgz')).sort().map((f) => `${f}:${fileHash(path.join(PACKS_DIR, f))}`) : [];
    const pristineFiles = ['package.json', this.pm.lockfile].map((f) => `${f}:${fileHash(path.join(this.pristine, f))}`);
    return sha(JSON.stringify({ pm: this.pm.name, node: process.version, pristineFiles, packs, transform: sha(this.transformKey) }));
  }

  /** Back to the pristine source (fresh-clone state: nothing generated, no build output, cold tool caches). */
  async reset() {
    emptyDirExcept(this.app, ['node_modules']);
    copyFiles(this.pristine, listTree(this.pristine), this.app);
    for (const d of CACHE_DIRS) fs.rmSync(path.join(this.app, 'node_modules', d), { recursive: true, force: true });
    return this;
  }

  /** Make `variant` the installed SDK (a real reinstall from its tarball, exactly like a user's upgrade). */
  async useSdk(variant = this.sdk.version) {
    const spec = `file:${this.requireTarball(variant)}`;
    this.files.json('package.json', (pkg) => { pkg.dependencies = { ...pkg.dependencies, [this.sdk.name]: spec }; });
    if (this.installedSdk === variant) return this;
    writeJson(path.join(this.dir, 'install.json'), { key: 'dirty: SDK swap in progress', sdk: null });
    const r = await this.run(this.pm.install, { timeout: 600_000 });
    if (r.code !== 0) throw new Error(`harness: installing ${this.sdk.name} ${variant} failed (exit ${r.code})\n${tail(r.output)}`);
    this.note(`installed ${this.sdk.name} ${variant} in ${r.ms} ms`);
    this.installedSdk = variant;
    if (variant === this.sdk.version) writeJson(path.join(this.dir, 'install.json'), { key: this.installKey(), sdk: variant, at: new Date().toISOString() });
    return this;
  }

  /** Leave the install in its default state (so the next run can reuse it). */
  async finish() {
    if (this.installedSdk && this.installedSdk !== this.sdk.version) {
      await this.reset();
      await this.useSdk(this.sdk.version);
    }
    await this.reset();
    if (process.env.STUNT_DOUBLE_CLEAN) fs.rmSync(this.dir, { recursive: true, force: true });
  }

  requireTarball(variant) {
    const f = path.join(PACKS_DIR, this.sdk.tarball(variant));
    if (!fs.existsSync(f)) throw new Error(`harness: ${posix(path.relative(REPO_ROOT, f))} is missing: run \`npm run setup\` first`);
    return f;
  }

  // ---- commands ---------------------------------------------------------------------------------------
  run(command, opts = {}) {
    return run(command, { cwd: this.app, ...opts });
  }

  note(msg) { this.log.push(msg); }

  // ---- file operations on the installed app (see FileOps) ---------------------------------------------
  exists(rel) { return this.files.exists(rel); }
  read(rel) { return this.files.read(rel); }
  write(rel, text) { this.files.write(rel, text); return this; }
  remove(rel) { this.files.remove(rel); return this; }
  rename(from, to) { this.files.rename(from, to); return this; }
  edit(rel, fn) { this.files.edit(rel, fn); return this; }
  json(rel, fn) { this.files.json(rel, fn); return this; }
  /** Text of a file in the pristine source (the fixture as committed). */
  pristineText(rel) { return fs.readFileSync(path.join(this.pristine, rel), 'utf8'); }
  /** Restore one file from the pristine source. */
  restore(rel) { return this.write(rel, this.pristineText(rel)); }
  /** Merge keys into the stunt-double config file (created if the fixture has none). */
  config(patch) { return this.json(this.layout.configFile, (c) => ({ ...c, ...patch })); }
  /** Path of a file in the overrides directory, e.g. override('Button.tsx') -> 'src/overrides/Button.tsx'. */
  override(name) { return posix(path.join(this.layout.overridesDir, name)); }
  src(name) { return posix(path.join(this.layout.srcDir, name)); }
  /** Module specifier from the file `fromRel` to the file `toRel` (no extension), e.g. '../components/Fancy'. */
  spec(fromRel, toRel) {
    const r = posix(path.relative(path.dirname(fromRel), toRel)).replace(/\.[cm]?[jt]sx?$/, '');
    return r.startsWith('.') ? r : `./${r}`;
  }

  /** The INSTALLED stunt-double core (`stunt-double/core`), for layout questions (generated dir, config keys). */
  async core() {
    const pj = path.join(this.app, 'node_modules', 'stunt-double', 'package.json');
    const pkg = readJson(pj);
    if (!pkg) throw new Error(`harness: stunt-double is not installed in ${this.app}`);
    const target = pkg.exports?.['./core']?.default ?? pkg.exports?.['./core'] ?? pkg.main;
    return import(pathToFileURL(path.join(path.dirname(pj), target)).href);
  }
}
