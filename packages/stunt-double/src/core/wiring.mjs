// The universal tier (T0): the project declares a LINK dependency on the slot package (npm "file:", pnpm
// "link:", Yarn "portal:", Bun "workspace:*" / npm workspaces) to a committed stub directory. That directory is
// then the project's ONE generated location (outDir), because a package's exports cannot point outside it.
//
// Link self-test (F6f / F8b): with a link declared, the SDK must resolve exactly that directory - not a copy
// (pnpm/Bun file:), not the registry placeholder, not another app's slot package (npm-hoisted monorepos), not a
// Yarn PnP __virtual__ instance. Without a link (the default adapter tier) there is nothing to test: tools
// without an adapter resolve the registry placeholder and fail at resolve time, by design.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readJson, real, findPackageJson, isInside } from './util.mjs';

const LINK_FORMS = /^(file:|link:|portal:|workspace:)/;

function workspaceDirs(root, pkg) {
  const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? [];
  const dirs = [];
  for (const w of ws) {
    const pat = String(w).replace(/^\.\//, '').replace(/\/$/, '');
    if (!pat.includes('*')) { dirs.push(path.resolve(root, pat)); continue; }
    const m = /^(.*?)\/?\*$/.exec(pat); // "packages/*" (the common form); deeper globs are not needed here
    if (!m) continue;
    const base = path.resolve(root, m[1]);
    let ents = [];
    try { ents = fs.readdirSync(base, { withFileTypes: true }); } catch {}
    for (const e of ents) if (e.isDirectory()) dirs.push(path.join(base, e.name));
  }
  return dirs;
}

/**
 * Is the slot package LINKED into the project (universal tier)? Returns { field, spec, linkForm, dir } where
 * `dir` is the linked directory (absolute; null for a "workspace:" line whose workspace is not found), or null
 * when no link dependency is declared. A registry range (the placeholder) is not a link: adapter tier.
 */
export function linkDeclaration(root, slotPackage) {
  const pkg = readJson(path.join(root, 'package.json')) ?? {};
  const named = (d) => readJson(path.join(d, 'package.json'))?.name === slotPackage;
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const spec = pkg[field]?.[slotPackage];
    if (typeof spec !== 'string' || !LINK_FORMS.test(spec)) continue;
    if (spec.startsWith('workspace:')) return { field, spec, linkForm: true, dir: workspaceDirs(root, pkg).find(named) ?? null };
    const dir = path.resolve(root, spec.replace(LINK_FORMS, ''));
    // "file:<tarball>" installs a package (e.g. a vendored placeholder), it links nothing: adapter tier
    if (/\.(tgz|tar\.gz|tar)$/i.test(dir) || fs.statSync(dir, { throwIfNoEntry: false })?.isFile()) continue;
    return { field, spec, linkForm: true, dir };
  }
  const ws = workspaceDirs(root, pkg).find(named);
  if (ws) return { field: 'workspaces', spec: path.relative(root, ws).split(path.sep).join('/'), linkForm: true, dir: ws };
  return null;
}

/** @returns {{ problems: string[], linkDeclared: boolean }} */
export function checkWiring({ root, sdk, decl, rel, pm = 'npm' }) {
  if (!decl) return { problems: [], linkDeclared: false };
  const slotsDir = decl.dir;
  if (!slotsDir) return { linkDeclared: true, problems: [`[F6] "${sdk.slotPackage}": "${decl.spec}" names no workspace whose package.json is "${sdk.slotPackage}": add its directory to "workspaces".`] };
  if (!isInside(slotsDir, root)) return { linkDeclared: true, problems: [`[F6] ${sdk.slotPackage} is linked to ${slotsDir}, outside the project: link a directory inside the project (npx stunt-double init --universal).`] };
  const want = path.join(slotsDir, 'package.json');
  if (!fs.existsSync(want))
    return { linkDeclared: true, problems: [`[F6] ${rel(slotsDir)}/package.json, the committed stub of the linked ${sdk.slotPackage}, is missing: run npx stunt-double init --universal, then ${pm} install.`] };
  const fromSdk = createRequire(path.join(sdk.realDir, 'package.json'));
  let seen;
  try { seen = real(fromSdk.resolve(`${sdk.slotPackage}/package.json`)); } catch (e) {
    const fallback = findPackageJson(sdk.slotPackage, sdk.realDir);
    if (!fallback) return { linkDeclared: true, problems: [`[F6] ${sdk.name} cannot resolve ${sdk.slotPackage} (${e.code ?? 'not found'}): run ${pm} install after adding the "${sdk.slotPackage}" dependency line.`] };
    seen = real(fallback);
  }
  if (seen.includes(`${path.sep}__virtual__${path.sep}`))
    return { linkDeclared: true, problems: [`[F8] ${sdk.slotPackage} is a Yarn PnP __virtual__ instance because ${rel(slotsDir)}/package.json declares peerDependencies: remove them (shims would load second copies of your modules).`] };
  if (seen !== real(want)) {
    const what = readJson(seen)?.stuntDouble?.placeholder
      ? 'the registry placeholder: the link is missing or was replaced by an auto-installed peer'
      : "a copy, or another app's slot package";
    return { linkDeclared: true, problems: [`[F6] ${sdk.name} resolves ${sdk.slotPackage} to ${rel(path.dirname(seen))} (${what}), not ${rel(slotsDir)}/. Use npm "file:", pnpm "link:", Yarn "portal:", Bun "workspace:*", then reinstall.`] };
  }
  const stub = readJson(want) ?? {};
  const problems = [];
  if (stub.peerDependencies || stub.dependencies)
    problems.push(`[F6] ${rel(slotsDir)}/package.json declares ${stub.peerDependencies ? 'peerDependencies' : 'dependencies'}: the slot package must have none (it could pull its own React/SDK, and Yarn PnP would virtualize it).`);
  return { linkDeclared: true, problems };
}
