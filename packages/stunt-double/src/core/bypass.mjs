// F6g bypass scan: project code that imports a slot DEFAULT (`<sdk>/original/X`) outside the overrides
// renders the SDK default at that call site and silently bypasses the slot.
import fs from 'node:fs';
import path from 'node:path';
import { parseModule } from './parse.mjs';
import { listFiles, posix, globToRegExp, isInside } from './util.mjs';

export function scanBypass({ root, sdk, cfg, overridesDir, genDir, checkFile, implFiles = [], rel }) {
  const problems = [];
  const allow = (cfg.allowOriginalImports ?? []).map(globToRegExp);
  const impl = new Set(implFiles);
  const needle = sdk.originalSpecifier;
  for (const d of cfg.sourceDirs ?? ['src']) {
    const dir = path.resolve(root, d);
    for (const file of listFiles(dir)) {
      if (isInside(file, overridesDir) || isInside(file, genDir) || file === checkFile || impl.has(file)) continue;
      const r = posix(path.relative(root, file));
      if (allow.some((re) => re.test(r))) continue;
      let src;
      try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
      if (!src.includes(needle)) continue; // cheap pre-filter: parse only candidates
      const info = parseModule(file);
      for (const e of info.edges) {
        if (!e.spec.startsWith(needle) || e.typeOnly) continue;
        const slot = e.spec.slice(needle.length);
        problems.push(`[F6] ${rel(file)} imports "${e.spec}" outside ${rel(overridesDir)}: that call site renders the SDK default and bypasses the "${slot}" slot. Import from "${sdk.name}" (or list the file in "allowOriginalImports").`);
      }
    }
  }
  return problems;
}
