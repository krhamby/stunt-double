// Pure helper of stunt-double/bun-test (no side effects, so it can be unit-tested outside Bun).
import { parseSync } from 'oxc-parser';

/** Replace exact socket specifiers in module-request string literals. Returns null when nothing changed. */
export function rewriteSockets(file, src, slotPackage, shimFile, slots) {
  const res = parseSync(file, src, { lang: 'js', sourceType: 'unambiguous' });
  const m = res.module;
  const spans = [
    ...m.staticImports.map((i) => i.moduleRequest),
    ...m.staticExports.flatMap((e) => e.entries.map((x) => x.moduleRequest).filter(Boolean)),
    ...m.dynamicImports.map((d) => d.moduleRequest),
  ];
  const edits = new Map();
  for (const r of spans) {
    const raw = src.slice(r.start, r.end).trim();
    const lit = /^(['"])([^'"]*)\1$/.exec(raw);
    if (!lit || !lit[2].startsWith(slotPackage + '/')) continue;
    const slot = lit[2].slice(slotPackage.length + 1);
    if (!slots.includes(slot)) continue;
    const start = r.start + src.slice(r.start, r.end).indexOf(raw);
    edits.set(start, { end: start + raw.length, text: JSON.stringify(shimFile(slot)) });
  }
  if (!edits.size) return null;
  let out = src;
  for (const [start, e] of [...edits].sort((a, b) => b[0] - a[0])) out = out.slice(0, start) + e.text + out.slice(e.end);
  return out;
}
