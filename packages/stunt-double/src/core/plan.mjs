// The resolution table: for every slot, the chain [app claim?, layer impls (last listed first)?, SDK default?].
// The shim re-exports the top of the chain. Per non-SDK implementation: F5 (named export), and the
// transitive walk (F7 / W7 / F9).
import { parseModule } from './parse.mjs';
import { walkImplementation } from './f7walk.mjs';

export function buildPlan({ root, sdk, cfg, claims, layers, overridesDir, tsconfig, rel }) {
  const problems = [];
  const warnings = [];
  const table = {};
  const closureFiles = new Set();
  const overridesRel = rel(overridesDir);
  for (const slot of sdk.slotNames) {
    const meta = sdk.slots[slot];
    const exportName = sdk.exportOf(slot);
    const kind = meta.kind ?? 'client';
    const chain = [];
    const appClaims = claims.get(slot) ?? [];
    if (appClaims.length === 1) {
      const c = appClaims[0];
      chain.push({ source: 'app', file: c.file, export: c.export ?? exportName, via: c.via, ignoresProps: c.ignoresProps ?? cfg.map?.[slot]?.ignoresProps ?? [] });
    }
    for (const l of [...layers].reverse()) {
      const impl = l.slots[slot];
      if (impl) chain.push({ source: 'layer', layer: l.name, file: impl.file, export: impl.export, spec: impl.spec, ignoresProps: [] });
    }
    const def = sdk.defaultFile(slot);
    if (def) chain.push({ source: 'sdk', file: def, export: exportName, spec: `${sdk.originalSpecifier}${slot}`, ignoresProps: [] });
    table[slot] = { slot, kind, required: !!meta.required, exportName, chain, impl: chain[0] ?? null, wraps: false };
    if (appClaims.length > 1) continue; // F4 already reported by the scan
    if (!chain.length) {
      problems.push(meta.required
        ? `[F3] required slot "${slot}" has no implementation: create ${overridesRel}/${slot}.tsx exporting \`${exportName}\` (scaffold: npx stunt-double eject ${slot}).`
        : `[F3] slot "${slot}" has no implementation and ${sdk.name}@${sdk.version} ships no default for it: create ${overridesRel}/${slot}.tsx exporting \`${exportName}\`.`);
      continue;
    }
    for (const impl of chain) {
      if (impl.source === 'sdk') continue;
      const fileRel = rel(impl.file);
      const info = parseModule(impl.file);
      if (info.error) { problems.push(`[F5] ${fileRel} (slot "${slot}") cannot be parsed: ${info.error}`); continue; }
      if (!info.exports.has(impl.export) && !info.star.length) {
        const has = [...info.exports, ...[...info.typeExports].map((t) => `type ${t}`)];
        const suggestion = info.exports.has('default') ? 'default' : [...info.exports][0];
        problems.push(impl.source === 'layer'
          ? `[F5] layer ${impl.layer} file ${fileRel} must export \`${impl.export}\` for slot "${slot}" (it exports: ${has.join(', ') || 'nothing'}): layer bug.`
          : `[F5] ${fileRel} must export a named \`${impl.export}\` (it exports: ${has.join(', ') || 'nothing'}). Write \`export function ${impl.export}(...)\`${suggestion && suggestion !== impl.export ? `, or set "map": {"${slot}": {"export": "${suggestion}"}}` : ''}.`);
      }
      const walk = walkImplementation({
        root, entry: impl.file, slot, exportName, sdk: sdk.name, slotPkg: sdk.slotPackage, kind,
        consumers: sdk.slots[slot].consumers ?? [],
        scanPackages: [...(cfg.scanPackages ?? []), ...(impl.layer ? [impl.layer] : [])],
        tsconfig,
      });
      problems.push(...walk.errors);
      warnings.push(...walk.warnings);
      for (const f of walk.files) closureFiles.add(f);
      if (impl === chain[0]) table[slot].wraps = info.edges.some((e) => e.spec === `${sdk.originalSpecifier}${slot}` || (chain[1]?.spec && e.spec === chain[1].spec));
    }
  }
  return { table, problems, warnings, closureFiles };
}

/** Human-readable chain, e.g. "src/overrides/Button.tsx -> wraps @acme/core/original/Button". */
export function describeChain(entry, rel) {
  if (!entry?.impl) return '(no implementation)';
  const parts = entry.chain.map((c) => (c.source === 'app' ? `${rel(c.file)}#${c.export}` : c.spec));
  return entry.wraps ? `${parts[0]} -> wraps ${parts[1]}` : parts[0] + (parts.length > 1 ? `  (shadows ${parts.slice(1).join(', ')})` : '');
}
