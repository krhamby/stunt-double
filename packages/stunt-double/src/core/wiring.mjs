// Link self-test (F6f / F8b): when the project declares a link dependency on the slot package, the SDK must
// resolve exactly the project's slots directory - not a copy (pnpm/Bun file:), not the registry placeholder,
// not another app's slot package (npm-hoisted monorepos), not a Yarn PnP __virtual__ instance.
import path from 'node:path';
import { createRequire } from 'node:module';
import { readJson, real, findPackageJson } from './util.mjs';

const LINK_FORMS = /^(file:|link:|portal:|workspace:)/;
// "file:<tarball>" installs a packed copy (e.g. the registry placeholder from a local .tgz): not a link.
const TARBALL = /\.(tgz|tar\.gz|tar)$/i;

/** Is the slot package declared as a dependency of the project (universal tier)? */
export function linkDeclaration(root, slotPackage, slotsDir) {
  const pkg = readJson(path.join(root, 'package.json')) ?? {};
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const spec = pkg[field]?.[slotPackage];
    if (spec && spec.startsWith('file:') && TARBALL.test(spec)) return null; // the placeholder from a tarball: adapter-only project
    if (spec) return { field, spec, linkForm: LINK_FORMS.test(spec) };
  }
  const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? [];
  const relSlots = path.relative(root, slotsDir).split(path.sep).join('/');
  if (ws.some((w) => w.replace(/^\.\//, '').replace(/\/$/, '') === relSlots)) return { field: 'workspaces', spec: relSlots, linkForm: true };
  return null;
}

export function checkWiring({ root, sdk, slotsDir, rel, pm = 'npm' }) {
  const decl = linkDeclaration(root, sdk.slotPackage, slotsDir);
  if (!decl) return { problems: [], linkDeclared: false }; // adapter-only project: unwired tools hit the placeholder (fail-closed)
  const fromSdk = createRequire(path.join(sdk.realDir, 'package.json'));
  let seen;
  try { seen = real(fromSdk.resolve(`${sdk.slotPackage}/package.json`)); } catch (e) {
    const fallback = findPackageJson(sdk.slotPackage, sdk.realDir);
    if (!fallback) return { linkDeclared: true, problems: [`[F6] ${sdk.name} cannot resolve ${sdk.slotPackage} (${e.code ?? 'not found'}): run ${pm} install after adding the "${sdk.slotPackage}" dependency line.`] };
    seen = real(fallback);
  }
  if (seen.includes(`${path.sep}__virtual__${path.sep}`))
    return { linkDeclared: true, problems: [`[F8] ${sdk.slotPackage} is a Yarn PnP __virtual__ instance because ${rel(slotsDir)}/package.json declares peerDependencies: remove them (shims would load second copies of your modules).`] };
  const want = real(path.join(slotsDir, 'package.json'));
  if (seen !== want) {
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
