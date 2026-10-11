// Transitive walk of an implementation's project-local import closure (oxc-parser + oxc-resolver,
// tsconfig "paths" aware). Finds:
//   F7  the implementation reaches its own slot (socket import, barrel import, namespace member): infinite render
//       (component slots), or a circular import that reads the slot before it is initialized (value slots)
//   W7  it renders an SDK component that itself renders this slot (consumer cycle): warning
//   F9  a client slot's closure imports "server-only"
// The walk stops at node_modules (except cfg.scanPackages) and at non-literal dynamic imports (spec R4).
import path from 'node:path';
import { ResolverFactory } from 'oxc-resolver';
import { parseModule } from './parse.mjs';
import { posix, esc } from './util.mjs';

const resolvers = new Map();
export function getResolver(tsconfigFile) {
  const key = tsconfigFile ?? 'auto';
  if (!resolvers.has(key)) {
    resolvers.set(key, new ResolverFactory({
      tsconfig: tsconfigFile ? { configFile: tsconfigFile, references: 'auto' } : 'auto',
      conditionNames: ['import', 'module', 'browser', 'default'],
      extensions: ['.tsx', '.ts', '.jsx', '.js', '.mts', '.mjs', '.cjs', '.json'],
      extensionAlias: { '.js': ['.ts', '.tsx', '.js', '.jsx'], '.jsx': ['.tsx', '.jsx'], '.mjs': ['.mts', '.mjs'] },
      mainFields: ['module', 'main'],
    }));
  }
  return resolvers.get(key);
}
export function clearResolverCache() {
  for (const r of resolvers.values()) r.clearCache();
}

const CODE = /\.[cm]?[jt]sx?$/;

/**
 * @param {object} o
 * @param {string} o.root           project root (for messages)
 * @param {string} o.entry          absolute path of the implementation file
 * @param {string} o.slot           slot name
 * @param {string} o.exportName     the SDK's export name of the slot
 * @param {string} o.sdk            SDK package name
 * @param {string} o.slotPkg        socket package name
 * @param {string} o.kind           'client' | 'shared' | 'server'
 * @param {string[]} [o.consumers]  SDK exports that render this slot (manifest consumers) for W7
 * @param {string[]} [o.scanPackages]
 * @param {string|null} [o.tsconfig]
 * @returns {{ errors: string[], warnings: string[], files: string[] }}
 */
export function walkImplementation(o) {
  const { root, entry, slot, exportName, sdk, slotPkg, kind, consumers = [], scanPackages = [], tsconfig = null } = o;
  const r = getResolver(tsconfig);
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const rel = (f) => posix(path.relative(root, f));
  const value = kind === 'value';
  const wrapHint = `${value ? 'Use' : 'Wrap'} the default via '${sdk}/original/${slot}'.`;
  const loop = value ? 'a circular import: the implementation would read itself before it is initialized' : 'infinite render';
  const isSdkBarrel = (spec) => spec === sdk || (spec.startsWith(sdk + '/') && !/^\/(original|contracts|layer)(\/|$)/.test(spec.slice(sdk.length)) && !spec.endsWith('.json'));
  // `requested`: the names the importer takes from this file (null = everything: namespace, dynamic, entry)
  const requestedOf = new Map();
  const walk = (file, chain, requested) => {
    const prev = requestedOf.get(file);
    if (seen.has(file)) {
      // re-visit only when a new importer asks for the slot export through an `export *` chain
      if (prev === null || !requested || !requested.has(exportName) || prev.has(exportName)) return;
    }
    requestedOf.set(file, requested === null || prev === null ? null : new Set([...(prev ?? []), ...requested]));
    seen.add(file);
    const info = parseModule(file);
    const via = [...chain, file].map(rel).join(' -> ');
    if (info.error) { errors.push(`[F7] cannot parse ${rel(file)} (imported by the "${slot}" implementation): ${info.error}`); return; }
    for (const e of info.edges) {
      if (e.typeOnly) continue;
      if (e.spec === `${slotPkg}/${slot}`) {
        errors.push(`[F7] ${via} imports "${e.spec}": that is slot "${slot}" itself (${loop}). ${wrapHint}`);
        continue;
      }
      if (e.spec === 'server-only' && kind === 'client') {
        errors.push(`[F9] ${via} imports "server-only" but "${slot}" is a client slot (rendered inside "use client" SDK components).`);
        continue;
      }
      if (isSdkBarrel(e.spec)) {
        if (e.names) {
          const names = e.names.filter((x) => !x.isType);
          if (names.some((x) => x.name === exportName))
            errors.push(`[F7] ${via} imports { ${exportName} } from "${e.spec}": that is slot "${slot}" itself (${loop}). ${wrapHint}`);
          else if (names.some((x) => x.name === 'NamespaceObject' && x.local && new RegExp(`\\b${esc(x.local)}\\s*\\??\\.\\s*${esc(exportName)}\\b`).test(info.src)))
            errors.push(`[F7] ${via} uses <ns>.${exportName} from "${e.spec}": that is slot "${slot}" itself (${loop}). ${wrapHint}`);
          else if (e.kind === 'export' && names.some((x) => x.name === 'AllButDefault') && !info.exports.has(exportName)
            && (requested === null || requested.has(exportName)) && chain.length > 0)
            errors.push(`[F7] ${via} re-exports everything from "${e.spec}" and ${rel(chain.at(-1))} takes ${exportName} from it: that is slot "${slot}" itself (${loop}). ${wrapHint}`);
          else for (const x of names) if (consumers.includes(x.name))
            warnings.push(value
              ? `[W7] ${via} imports ${x.name} from "${e.spec}", and ${x.name} uses slot "${slot}": a circular import. Do not use ${x.name} while modules initialize (top-level code), only inside functions.`
              : `[W7] ${via} renders ${x.name} from "${e.spec}", and ${x.name} renders slot "${slot}": check for infinite recursion.`);
        } else if (new RegExp(`\\.\\s*${esc(exportName)}\\b|\\{[^}]*\\b${esc(exportName)}\\b[^}]*\\}\\s*=`).test(info.src)) {
          errors.push(`[F7] ${via} loads "${e.spec}" dynamically and reads ${exportName}: that is slot "${slot}" itself (${loop}). ${wrapHint}`);
        }
        continue;
      }
      let res;
      try { res = r.resolveFileSync(file, e.spec); } catch { res = {}; }
      const target = res.path;
      if (!target || !CODE.test(target) || target.endsWith('.d.ts')) continue;
      const inNm = target.includes(`${path.sep}node_modules${path.sep}`);
      if (inNm && !scanPackages.some((p) => target.includes(`${path.sep}node_modules${path.sep}${p}${path.sep}`))) continue;
      const asked = !e.names ? null
        : e.names.some((x) => x.name === 'NamespaceObject' || x.name === 'AllButDefault') ? null
          : new Set(e.names.filter((x) => !x.isType).map((x) => x.name));
      walk(target, [...chain, file], asked);
    }
  };
  walk(entry, [], null);
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], files: [...seen] };
}
