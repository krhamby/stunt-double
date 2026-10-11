// Scan the overrides directory (depth 2) and config "map" entries into claims. Every top-level file that is
// not ignored MUST be a slot: that is what turns typos and stray files into loud F2 errors instead of
// silently unused files.
import fs from 'node:fs';
import path from 'node:path';
import { SRC_EXTS, nearest, posix } from './util.mjs';

const IGNORED_FILE = /(^_)|(\.(test|spec|stories|story)\.[cm]?[jt]sx?$)|(\.d\.[cm]?ts$)/;

function srcExt(name) {
  return SRC_EXTS.find((e) => name.endsWith(e)) ?? null;
}

/** Explain why `name` is not a slot: renamed, removed, or a near miss. Returns a full F2 line. */
export function unknownSlotMessage({ sdk, name, where, ext = '.tsx', overridesRel }) {
  const renamedTo = sdk.slotNames.find((s) => (sdk.slots[s].renamedFrom ?? []).includes(name));
  if (renamedTo)
    return `[F2] ${where}: slot "${name}" was RENAMED to "${renamedTo}" in ${sdk.name}@${sdk.version}: rename the file to ${renamedTo}${ext} and export \`${sdk.exportOf(renamedTo)}\`.`;
  if (Object.hasOwn(sdk.removedSlots, name))
    return `[F2] ${where}: slot "${name}" was REMOVED in ${sdk.name}@${sdk.version}: ${String(sdk.removedSlots[name]).replace(/\.$/, '')}.`;
  const near = nearest(name, sdk.slotNames);
  return `[F2] ${where} overrides unknown slot "${name}"${near ? ` (did you mean "${near}"?)` : ''}. ${sdk.name}@${sdk.version} slots: ${sdk.slotNames.join(', ')}. Helpers belong in _-prefixed files or inside ${overridesRel}/<Slot>/.`;
}

/**
 * @returns {{ claims: Map<string, Array<{slot, file, export, via, ignoresProps}>>, problems: string[], ignored: string[] }}
 */
export function scanOverrides({ root, sdk, cfg, overridesDir, configSource = 'stunt-double.config.json' }) {
  const problems = [];
  const ignored = [];
  const claims = new Map();
  const rel = (f) => posix(path.relative(root, f));
  const overridesRel = rel(overridesDir);
  const add = (slot, claim) => {
    if (!claims.has(slot)) claims.set(slot, []);
    claims.get(slot).push(claim);
  };
  let entries = [];
  try { entries = fs.readdirSync(overridesDir, { withFileTypes: true }); } catch {}
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const full = path.join(overridesDir, e.name);
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      if (e.name.startsWith('_')) { ignored.push(full); continue; }
      const indexes = SRC_EXTS.map((x) => path.join(full, 'index' + x)).filter((f) => fs.existsSync(f));
      if (!indexes.length) {
        problems.push(sdk.slots[e.name]
          ? `[F2] ${rel(full)}/ has no index file: a slot directory must contain index.tsx exporting \`${sdk.exportOf(e.name)}\` (helpers belong in _-prefixed files or directories).`
          : unknownSlotMessage({ sdk, name: e.name, where: `${rel(full)}/`, overridesRel }));
        continue;
      }
      if (!sdk.slots[e.name]) { problems.push(unknownSlotMessage({ sdk, name: e.name, where: rel(indexes[0]), ext: '/index' + srcExt(indexes[0]), overridesRel })); continue; }
      for (const f of indexes) add(e.name, { slot: e.name, file: f, export: null, via: 'file' });
      continue;
    }
    if (!e.isFile()) continue;
    const ext = srcExt(e.name);
    if (!ext || IGNORED_FILE.test(e.name)) { ignored.push(full); continue; } // assets, tests, stories, helpers, .d.ts
    const name = e.name.slice(0, -ext.length);
    if (!sdk.slots[name]) { problems.push(unknownSlotMessage({ sdk, name, where: rel(full), ext, overridesRel })); continue; }
    add(name, { slot: name, file: full, export: null, via: 'file' });
  }
  for (const [slot, entry] of Object.entries(cfg.map ?? {})) {
    if (!sdk.slots[slot]) {
      const near = nearest(slot, sdk.slotNames);
      const renamedTo = sdk.slotNames.find((s) => (sdk.slots[s].renamedFrom ?? []).includes(slot));
      problems.push(renamedTo
        ? `[F2] ${configSource} map."${slot}": slot "${slot}" was RENAMED to "${renamedTo}" in ${sdk.name}@${sdk.version}: rename the map key.`
        : Object.hasOwn(sdk.removedSlots, slot)
          ? `[F2] ${configSource} map."${slot}": slot "${slot}" was REMOVED in ${sdk.name}@${sdk.version}: ${sdk.removedSlots[slot]}.`
          : `[F2] ${configSource} map."${slot}" names unknown slot "${slot}"${near ? ` (did you mean "${near}"?)` : ''}. ${sdk.name}@${sdk.version} slots: ${sdk.slotNames.join(', ')}.`);
      continue;
    }
    if (entry?.from) {
      const f = path.resolve(root, entry.from);
      if (!fs.existsSync(f)) {
        problems.push(`[F2] ${configSource} map."${slot}".from "${entry.from}" does not exist.`);
        continue;
      }
      add(slot, { slot, file: f, export: entry.export ?? null, via: 'map' });
    }
  }
  // map.<Slot>.export / ignoresProps without "from" apply to the convention file
  for (const [slot, list] of claims) for (const c of list) {
    const m = cfg.map?.[slot];
    if (!m) continue;
    if (c.via === 'file' && !m.from && m.export) c.export = m.export;
    c.ignoresProps = m.ignoresProps ?? [];
  }
  for (const [slot, m] of Object.entries(cfg.map ?? {}))
    if (sdk.slots[slot] && sdk.isValue(slot) && m?.ignoresProps?.length)
      problems.push(`[CFG] ${configSource} map."${slot}".ignoresProps: "${slot}" is a value slot (it has a type contract, SlotTypes['${slot}'], not props). Remove ignoresProps.`);
  for (const [slot, list] of claims) {
    if (list.length > 1) {
      const names = list.map((c) => (c.via === 'map' ? `${rel(c.file)} (${configSource} map)` : rel(c.file)));
      problems.push(`[F4] slot "${slot}" is claimed by ${list.length} files: ${names.slice(0, -1).join(', ')} and ${names.at(-1)}. Keep exactly one.`);
    }
  }
  return { claims, problems, ignored };
}
