// Debounced watcher: regenerate (poison mode) when an override, a file in an override's closure, the config
// or package.json changes. Used by `stunt-double watch -- <cmd>` and by adapters without their own watcher.
import fs from 'node:fs';
import path from 'node:path';
import { regenerate } from './generate.mjs';

export function watchProject(p, { onChange = () => {}, debounce = 60, onError = 'poison' } = {}) {
  let cur = p;
  let timer = null;
  const watchers = [];
  const add = (target, recursive) => {
    try {
      const w = fs.watch(target, { recursive }, (_ev, f) => {
        const file = f ? path.resolve(target, String(f)) : target;
        if (recursive || cur.watches(file) || /^(stunt-double\.config\.json|package\.json)$/.test(String(f))) kick();
      });
      w.on('error', () => {});
      w.unref?.();
      watchers.push(w);
    } catch {}
  };
  const kick = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const next = regenerate(cur, { onError });
        const was = cur;
        cur = next;
        if (next.changedFiles.length || next.problems.length !== was.problems.length || next.problems.join() !== was.problems.join()) onChange(next, was);
      } catch (e) { onChange(null, cur, e); }
    }, debounce);
  };
  fs.mkdirSync(p.overridesDir, { recursive: true });
  add(p.overridesDir, true);
  add(p.root, false);
  for (const d of new Set([...p.closureFiles].map((f) => path.dirname(f)).filter((d) => !d.startsWith(p.overridesDir)))) add(d, false);
  return { close: () => { clearTimeout(timer); watchers.forEach((w) => w.close()); }, get current() { return cur; } };
}
