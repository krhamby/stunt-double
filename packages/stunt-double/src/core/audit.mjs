// Post-bundle module-graph audit, shared by every adapter. Each adapter only converts its graph into
// [{ id, importers[] }] of absolute paths. Never uses "the socket never reached resolveId" as a signal
// (webpack's LazyBarrel and unused slots never resolve); the FINAL graph is the source of truth.
import path from 'node:path';
import { real, cleanId } from './util.mjs';

function packageRoots(graph, names) {
  const roots = new Map(names.map((n) => [n, new Set()]));
  for (const m of graph) {
    const id = m.id;
    for (const n of names) {
      const seg = `${path.sep}node_modules${path.sep}${n.split('/').join(path.sep)}${path.sep}`;
      const i = id.lastIndexOf(seg);
      if (i >= 0) roots.get(n).add(id.slice(0, i + seg.length - 1));
    }
  }
  return roots;
}

/**
 * @param {object} p  the generated project
 * @param {Array<{id: string, importers: string[]}>} graph
 * @returns {string[]} problems
 */
export function auditGraph(p, graph) {
  if (!p?.sdk) return [];
  const norm = (id) => real(cleanId(id));
  const g = graph.filter((m) => m.id && path.isAbsolute(cleanId(m.id))).map((m) => ({ id: norm(m.id), importers: (m.importers ?? []).filter(Boolean).map((i) => (path.isAbsolute(cleanId(i)) ? norm(i) : i)) }));
  const out = [];
  const ids = new Set(g.map((m) => m.id));
  for (const m of g) {
    const slot = p.defaultFileToSlot.get(m.id);
    if (!slot) continue;
    for (const imp of m.importers) if (!p.mayImportImpl(imp, slot))
      out.push(`[F6] ${p.rel(imp)} imports the SDK default of slot "${slot}" (${p.rel(m.id)}) directly: the slot is bypassed there.`);
  }
  for (const [slot, consumers] of Object.entries(p.socketConsumers ?? {}))
    if (consumers.some((f) => ids.has(f)) && !ids.has(real(p.shimFile(slot))))
      out.push(`[F6] ${p.sdk.name} imports ${p.sdk.slotPackage}/${slot} but ${p.rel(p.shimFile(slot))} is not in the bundle: an alias or plugin resolved the socket elsewhere.`);
  for (const [name, roots] of packageRoots(g, [...(p.cfg.singletons ?? []), ...p.packages]))
    if (roots.size > 1)
      out.push(`[F8] "${name}" is bundled from ${roots.size} locations (${[...roots].map((r) => p.rel(r)).join(', ')}): dedupe it (resolve.dedupe / alias / single install).`);
  return [...new Set(out)];
}

/** Rollup / Rolldown / Vite build plugin context -> graph. */
export function rollupGraph(ctx) {
  const graph = [];
  for (const id of ctx.getModuleIds()) {
    const info = ctx.getModuleInfo(id);
    if (!info) continue;
    graph.push({ id, importers: [...(info.importers ?? []), ...(info.dynamicImporters ?? [])] });
  }
  return graph;
}

/** webpack 5 / Rspack 2 (finishModules) -> graph. Uses m.resource only (Rspack has no resourceResolveData). */
export function webpackGraph(compilation, modules) {
  const graph = [];
  const mg = compilation.moduleGraph;
  for (const m of modules) {
    const id = m.resource ?? m.rootModule?.resource;
    if (!id) continue;
    const importers = [];
    try {
      for (const c of mg.getIncomingConnections(m)) {
        const om = c.originModule;
        const r = om?.resource ?? om?.rootModule?.resource;
        if (r) importers.push(r);
      }
    } catch {}
    graph.push({ id, importers });
  }
  return graph;
}

/** esbuild metafile -> graph (paths in the metafile are relative to absWorkingDir). */
export function esbuildGraph(metafile, root) {
  const importers = new Map();
  for (const [file, info] of Object.entries(metafile.inputs ?? {})) {
    const abs = path.resolve(root, file.replace(/^[a-z-]+:/, ''));
    if (!importers.has(abs)) importers.set(abs, []);
    for (const imp of info.imports ?? []) {
      if (imp.external) continue;
      const t = path.resolve(root, imp.path.replace(/^[a-z-]+:/, ''));
      if (!importers.has(t)) importers.set(t, []);
      importers.get(t).push(abs);
    }
  }
  return [...importers].map(([id, imps]) => ({ id, importers: imps }));
}
