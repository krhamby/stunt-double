// stunt-double/vite: the Vite 8 / Vitest 5 plugin. The same object is a Rollup / Rolldown plugin: Vite-only
// hooks are ignored there.
//
//   plugins: [react(), stuntDouble()]
//
// What it does (spec §6.1):
//   config          STA (generate) + ONE static alias  @acme/core-slots/<Slot> -> <root>/sdk-slots/gen/<Slot>.jsx,
//                   dedupe, optimizer belt and braces, ssr.noExternal / Vitest server.deps.inline for the SDK
//   configResolved  CFG guards: graphs the plugin cannot see would silently use SDK defaults -> config error
//   buildStart      STA problems -> this.error (exit 1); TYP gate (memoized for client + SSR) -> this.error
//   buildEnd        AUD: post-bundle graph audit -> this.error
//   dev             regenerate on change, poisoned shims + overlay push, async type gate
import path from 'node:path';
import { generate, regenerate, StuntDoubleError } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { auditGraph, rollupGraph } from '../core/audit.mjs';
import { formatProblems, formatWarnings } from '../core/diagnostics.mjs';
import { esc, cleanId } from '../core/util.mjs';

const PLUGIN = 'stunt-double';

const covered = (list, name) => list === true || [].concat(list ?? []).some((x) => (x instanceof RegExp ? x.test(name) : x === name));

/** @param {import('./vite.d.ts').StuntDoubleViteOptions} [opts] */
export function stuntDouble(opts = {}) {
  let p = null;
  let command = 'build';
  let gate = null;
  let warned = false;
  let standalone = false; // Rollup / Rolldown without Vite: options() generated, no config() hook ran
  let builds = 0;
  const vitest = !!process.env.VITEST;
  const { typecheck = true, audit = true, ...genOpts } = opts;

  const tripwire = {
    name: `${PLUGIN}:optimizer-tripwire`,
    load(id) {
      if (p?.sdk && p.isProjectSlotFile(cleanId(id)))
        this.error(`[F6] the dependency optimizer tried to pre-bundle ${p.rel(cleanId(id))}: the override decision would be frozen into .vite/deps. Remove custom optimizeDeps settings that pull in ${p.sdk.slotPackage}.`);
    },
  };

  return {
    name: PLUGIN,
    enforce: 'pre',

    // ---- Vite: config + STA --------------------------------------------------------------------------
    config(user, env) {
      command = env?.command ?? 'build';
      const root = path.resolve(user.root ?? opts.root ?? process.cwd());
      p = generate({ ...genOpts, root, onError: vitest ? 'throw' : command === 'serve' ? 'poison' : 'return' });
      if (!p.sdk) return {}; // fail closed: buildStart reports, nothing is aliased
      const pk = p.packages;
      return {
        resolve: {
          alias: [{ find: new RegExp(`^${esc(p.sdk.slotPackage)}/([A-Za-z0-9_]+)$`), replacement: `${p.genDir}/$1.jsx` }],
          dedupe: ['react', 'react-dom', ...pk],
        },
        optimizeDeps: {
          include: [...p.originals],
          exclude: [p.sdk.slotPackage],
          rolldownOptions: { external: [p.genDirRegex], plugins: [tripwire] },
        },
        ssr: { noExternal: [...pk] },
        test: { server: { deps: { inline: [...pk] } } },
      };
    },

    configEnvironment(name) {
      if (!p?.sdk || name === 'client') return;
      return { resolve: { noExternal: [...p.packages] } };
    },

    // ---- CFG guards ---------------------------------------------------------------------------------
    configResolved(c) {
      if (!p?.sdk) return;
      const pk = p.packages;
      const inline = c.test?.server?.deps?.inline;
      for (const [name, env] of Object.entries(c.environments ?? {})) {
        if (env.consumer === 'server') for (const n of pk) {
          const external = env.resolve?.external;
          const explicitlyExternal = Array.isArray(external) && external.includes(n);
          if ((explicitlyExternal || !covered(env.resolve?.noExternal, n)) && !covered(inline, n))
            throw new StuntDoubleError(`[F6] Vite environment "${name}" externalizes ${n}: Node would load it natively and slot overrides could not apply there. Keep stunt-double's ssr.noExternal${explicitlyExternal ? ` (remove "${n}" from ssr.external / resolve.external)` : ''}.`);
        }
        if ((env.optimizeDeps?.include ?? []).some((i) => i === p.sdk.slotPackage || i.startsWith(p.sdk.slotPackage + '/')))
          throw new StuntDoubleError(`[F6] optimizeDeps.include contains ${p.sdk.slotPackage} in "${name}": the override decision would be frozen into .vite/deps. Remove it.`);
      }
      for (const [k, o] of Object.entries(c.test?.deps?.optimizer ?? {}))
        if (o?.enabled && (o.include ?? []).some((i) => pk.some((n) => i === n || i.startsWith(n + '/'))))
          throw new StuntDoubleError(`[F6] Vitest deps.optimizer.${k} pre-bundles ${pk.join(', ')} outside the plugin pipeline: overrides would be lost. Remove it from include.`);
      if (p.warnings.length && !warned) { warned = true; c.logger.warn(formatWarnings(p)); }
    },

    // ---- Rollup / Rolldown standalone: no config hook ran ------------------------------------------
    options(o) {
      if (p) return null;
      standalone = true;
      p = generate({ ...genOpts, root: path.resolve(opts.root ?? process.cwd()), onError: 'return' });
      return null;
    },
    resolveId(source) {
      // Vite applies the alias from config(); Rollup/Rolldown standalone has no alias, so resolve here.
      if (!p?.sdk || !source.startsWith(p.sdk.slotPackage + '/')) return null;
      const slot = source.slice(p.sdk.slotPackage.length + 1);
      return p.sdk.slots[slot] ? p.shimFile(slot) : null;
    },

    // ---- build: STA + TYP ---------------------------------------------------------------------------
    async buildStart() {
      if (command === 'serve' || vitest) return;
      const rebuild = builds++ > 0;
      if (standalone) {
        // Rollup / Rolldown watch: regenerate on every rebuild, and watch the overrides dir + config, which are
        // not in the module graph (an added Buton.tsx must trigger a rebuild and fail it).
        if (rebuild) p = regenerate(p, { onError: 'return' });
        if (this.meta?.watchMode && p?.sdk) for (const f of [p.overridesDir, p.configFile]) if (f) this.addWatchFile(f);
      }
      if (p.problems.length) this.error(formatProblems(p));
      if (p.warnings.length && !warned) { warned = true; this.warn(formatWarnings(p)); }
      if (typecheck === false) return;
      // The gate memo ignores override CONTENTS: a standalone watch rebuild must re-run it.
      if (standalone && rebuild) gate = runTypeGate(p, { force: true });
      gate ??= runTypeGate(p);
      const r = await gate;
      if (!r.ok) this.error(r.message);
    },

    // ---- build: AUD ---------------------------------------------------------------------------------
    buildEnd(err) {
      if (err || command === 'serve' || vitest || audit === false || !p?.sdk) return;
      const problems = auditGraph(p, rollupGraph(this));
      if (problems.length) this.error(formatProblems(p, problems));
    },

    // ---- dev ----------------------------------------------------------------------------------------
    configureServer(s) {
      let lastError = null;
      const push = (message) => {
        lastError = message;
        s.config.logger.error(message, { timestamp: true });
        try { s.environments.client.hot.send({ type: 'error', err: { message, stack: '', plugin: PLUGIN } }); } catch {}
      };
      const clear = () => {
        if (!lastError) return;
        lastError = null;
        s.config.logger.info(`${PLUGIN}: injection errors fixed`, { timestamp: true });
        try { s.environments.client.hot.send({ type: 'full-reload', path: '*' }); } catch {}
      };
      try { s.ws?.on?.('connection', () => { if (lastError) setTimeout(() => { try { s.environments.client.hot.send({ type: 'error', err: { message: lastError, stack: '', plugin: PLUGIN } }); } catch {} }, 50); }); } catch {}
      const checkTypes = async () => {
        if (typecheck === false || p.problems.length) return;
        const r = await runTypeGate(p);
        if (!r.ok) push(r.message);
        else clear();
      };
      if (p?.problems.length) push(formatProblems(p));
      else setTimeout(() => { checkTypes().catch(() => {}); }, 0);
      if (!p?.sdk) return;
      s.watcher.add([p.overridesDir, ...(p.configFile ? [p.configFile] : [])]);
      let t;
      const kick = (file) => {
        if (!p.watches(file)) return;
        clearTimeout(t);
        t = setTimeout(() => {
          try { p = regenerate(p, { onError: 'poison' }); } catch (e) { return push(String(e?.message ?? e)); }
          if (p.problems.length) return push(formatProblems(p));
          clear();
          checkTypes().catch(() => {});
        }, 60);
      };
      for (const ev of ['add', 'unlink', 'change', 'addDir', 'unlinkDir']) s.watcher.on(ev, kick);
    },
  };
}

/** Alias-only fragment for configs that cannot take plugins (no validation: chain `stunt-double check &&`). */
export function stuntDoubleAlias(opts = {}) {
  const p = generate({ ...opts, root: path.resolve(opts.root ?? process.cwd()), onError: 'throw' });
  return [{ find: new RegExp(`^${esc(p.sdk.slotPackage)}/([A-Za-z0-9_]+)$`), replacement: `${p.genDir}/$1.jsx` }];
}

export default stuntDouble;
