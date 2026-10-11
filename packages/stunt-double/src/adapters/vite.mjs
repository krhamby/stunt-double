// stunt-double/vite: the Vite 8 / Vitest 5 plugin. The same object is a Rollup / Rolldown plugin: Vite-only
// hooks are ignored there.
//
//   plugins: [react(), stuntDouble()]        (order does not matter: enforce 'pre')
//
// What it does:
//   config          STA (generate into <root>/.stunt-double/) + ONE static alias
//                   @acme/core-slots/<Slot> -> <outDir>/gen/<Slot>.jsx, dedupe, optimizer belt and braces,
//                   ssr.noExternal / Vitest server.deps.inline for the SDK
//   configResolved  CFG guards: graphs the plugin cannot see would silently use SDK defaults -> config error
//   buildStart      STA problems -> this.error (exit 1); TYP gate (memoized for client + SSR) -> this.error
//   buildEnd        AUD: post-bundle graph audit -> this.error
//   dev             regenerate on change, poisoned shims + overlay push, async type gate
import path from 'node:path';
import { generate, StuntDoubleError } from '../core/generate.mjs';
import { emitPoison } from '../core/emit.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { auditGraph, rollupGraph } from '../core/audit.mjs';
import { formatProblems, formatWarnings, formatReport, header } from '../core/diagnostics.mjs';
import { DEFAULTS } from '../core/config.mjs';
import { esc, cleanId } from '../core/util.mjs';

const PLUGIN = 'stunt-double';
const PLUGIN_OPTIONS = new Set(['typecheck', 'audit', 'root', 'configFile', ...Object.keys(DEFAULTS)]);

const covered = (list, name) => list === true || [].concat(list ?? []).some((x) => (x instanceof RegExp ? x.test(name) : x === name));

/**
 * For this.error(): an Error whose stack equals "<name>: <message>", so Rolldown's summary does not repeat the
 * report or add stunt-double frames. (Rolldown still wraps it in its own aggregate error with its own frames, so
 * reports that can be raised before bundling are thrown from configResolved instead: see there.)
 */
function reportError(message) {
  const e = new Error(message);
  e.stack = `Error: ${message}`;
  return e;
}

/** @param {import('./vite.d.ts').StuntDoubleViteOptions} [opts] */
export function stuntDouble(opts = {}) {
  let p = null;
  let command = 'build';
  let gate = null;
  let warned = false;
  let checkedAtConfig = false;
  let viteConfigured = false;
  const vitest = !!process.env.VITEST;
  const { typecheck = true, audit = true, ...genOpts } = opts ?? {};
  const unknownOptions = Object.keys(opts ?? {}).filter((k) => !PLUGIN_OPTIONS.has(k));
  const optionProblems = unknownOptions.map((k) => `[CFG] unknown stuntDouble() option "${k}". Known options: ${[...PLUGIN_OPTIONS].join(', ')}.`);
  const load = (root, onError) => {
    if (!optionProblems.length) return generate({ ...genOpts, root, onError });
    const next = generate({ ...genOpts, root, onError: 'return' });
    next.problems.unshift(...optionProblems);
    if (onError === 'poison') { next.changedFiles = emitPoison(next, next.problems); next.poisoned = true; }
    if (onError === 'throw') throw new StuntDoubleError(formatProblems(next), next.problems);
    return next;
  };
  const fail = (lines) => { throw new StuntDoubleError(formatReport(header(p, lines.length), lines), lines); };

  const tripwire = {
    name: `${PLUGIN}:optimizer-tripwire`,
    load(id) {
      if (p?.sdk && p.isProjectSlotFile(cleanId(id)))
        this.error(reportError(formatReport(header(p, 1), [`[F6] the dependency optimizer tried to pre-bundle ${p.rel(cleanId(id))}: the override decision would be frozen into .vite/deps. Remove custom optimizeDeps settings that pull in ${p.sdk.slotPackage}.`])));
    },
  };

  return {
    name: PLUGIN,
    enforce: 'pre',

    // ---- Vite: config + STA --------------------------------------------------------------------------
    config(user, env) {
      command = env?.command ?? 'build';
      viteConfigured = true;
      const root = path.resolve(user.root ?? opts.root ?? process.cwd());
      p = load(root, vitest ? 'throw' : command === 'serve' ? 'poison' : 'return');
      if (!p.sdk) return {}; // fail closed: configResolved / the dev overlay report it, nothing is aliased
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
    async configResolved(c) {
      if (!p?.sdk) {
        if (command === 'build' && !vitest && p?.problems.length) throw new StuntDoubleError(formatProblems(p), p.problems);
        return;
      }
      const pk = p.packages;
      // Vitest's server.deps.inline only applies inside Vitest. Outside it (vite build --ssr, the dev SSR
      // module runner) the plugin's own inline entry must not count as coverage.
      const inline = vitest ? c.test?.server?.deps?.inline : undefined;
      // Farm's Vite-compat config proxy THROWS on keys it does not support (environments): no environments there.
      let environments;
      try { environments = c.environments; } catch {}
      for (const [name, env] of Object.entries(environments ?? {})) {
        if (env.consumer === 'server') for (const n of pk) {
          const external = env.resolve?.external;
          // an explicit external list beats noExternal in Vite; `external: true` does not (noExternal wins)
          const explicitlyExternal = Array.isArray(external) && external.includes(n);
          if ((explicitlyExternal || !covered(env.resolve?.noExternal, n)) && !covered(inline, n))
            fail([`[F6] Vite environment "${name}" externalizes ${n}: Node would load it natively and slot overrides could not apply there. Keep stunt-double's ssr.noExternal${explicitlyExternal ? ` (remove "${n}" from ssr.external / resolve.external)` : ''}.`]);
        }
        if ((env.optimizeDeps?.include ?? []).some((i) => i === p.sdk.slotPackage || i.startsWith(p.sdk.slotPackage + '/')))
          fail([`[F6] optimizeDeps.include contains ${p.sdk.slotPackage} in "${name}": the override decision would be frozen into .vite/deps. Remove it.`]);
      }
      for (const [k, o] of Object.entries(c.test?.deps?.optimizer ?? {}))
        if (o?.enabled && (o.include ?? []).some((i) => pk.some((n) => i === n || i.startsWith(n + '/'))))
          fail([`[F6] Vitest deps.optimizer.${k} pre-bundles ${pk.join(', ')} outside the plugin pipeline: overrides would be lost. Remove it from include.`]);
      if (p.warnings.length && !warned) { warned = true; c.logger.warn(formatWarnings(p)); }
      // `vite build`: STA and TYP run HERE, before any bundling, and fail by throwing a StuntDoubleError. Vite
      // prints it as the bare report (exit 1). The same failure from buildStart would reach the terminal wrapped
      // in Rolldown's aggregate error and its stack trace.
      if (command === 'build' && !vitest) {
        if (p.problems.length) throw new StuntDoubleError(formatProblems(p), p.problems);
        if (typecheck !== false) {
          gate ??= runTypeGate(p);
          const r = await gate;
          if (!r.ok) throw new StuntDoubleError(r.message, r.lines ?? []);
        }
        checkedAtConfig = true;
      }
    },

    // ---- Rollup / Rolldown standalone: no config hook ran ------------------------------------------
    options() {
      if (viteConfigured) return null; // Vite: config() already generated
      p = load(path.resolve(opts.root ?? process.cwd()), 'return'); // every standalone build regenerates
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
      if (checkedAtConfig) { checkedAtConfig = false; return; } // first build of `vite build`: already checked
      const watching = !!this.meta?.watchMode;
      if (watching) {
        // `vite build --watch` / Rollup / Rolldown watch: regenerate on every rebuild, and watch the overrides dir
        // + config, which are not in the module graph (an added Buton.tsx must trigger a rebuild and fail it).
        p = load(p.root, 'return');
        gate = null;
        if (p?.sdk) for (const f of [p.overridesDir, p.configFile]) if (f) this.addWatchFile(f);
      }
      if (p.problems.length) this.error(reportError(formatProblems(p)));
      if (p.warnings.length && !warned) { warned = true; this.warn(formatWarnings(p)); }
      if (typecheck === false) return;
      // The gate memo ignores override CONTENTS: a watch rebuild must re-run it.
      gate ??= runTypeGate(p, { force: watching });
      const r = await gate;
      if (!r.ok) this.error(reportError(r.message));
    },

    // ---- build: AUD ---------------------------------------------------------------------------------
    buildEnd(err) {
      if (err || command === 'serve' || vitest || audit === false || !p?.sdk) return;
      let graph;
      try { graph = rollupGraph(this); } catch (e) {
        // Farm's Vite-compat context has no getModuleIds() and drops this.warn(): say so on stderr (STA + TYP
        // still ran before bundling).
        console.warn(`stunt-double: post-bundle audit skipped, this host has no module-graph API (${String(e?.message ?? e).split('\n')[0]})`);
        return;
      }
      const problems = [...(viteConfigured ? [] : externalSdk(p, this)), ...auditGraph(p, graph)];
      if (problems.length) this.error(reportError(formatProblems(p, problems)));
    },

    // ---- dev ----------------------------------------------------------------------------------------
    configureServer(s) {
      let lastError = null;
      const send = (message) => { try { s.environments.client.hot.send({ type: 'error', err: { message, stack: '', plugin: PLUGIN } }); } catch {} };
      const push = (message) => {
        lastError = message;
        s.config.logger.error(message, { timestamp: true });
        send(message);
      };
      const clear = () => {
        if (!lastError) return;
        lastError = null;
        s.config.logger.info(`${PLUGIN}: injection errors fixed`, { timestamp: true });
        try { s.environments.client.hot.send({ type: 'full-reload', path: '*' }); } catch {}
      };
      try { s.ws?.on?.('connection', () => { if (lastError) setTimeout(() => send(lastError), 50); }); } catch {}
      let seq = 0;
      const checkTypes = async () => {
        if (typecheck === false || p.problems.length) return;
        const mine = ++seq;
        const r = await runTypeGate(p);
        if (mine !== seq) return; // a newer edit started another run: its result wins
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
          try { p = load(p.root, 'poison'); } catch (e) { return push(String(e?.message ?? e)); }
          if (p.problems.length) { seq++; return push(formatProblems(p)); }
          clear();
          checkTypes().catch(() => {});
        }, 60);
      };
      for (const ev of ['add', 'unlink', 'change', 'addDir', 'unlinkDir']) s.watcher.on(ev, kick);
    },
  };
}

/**
 * Standalone Rollup / Rolldown: [F6] when `external` (an array, regex or function: a common "externalize every
 * dependency" server config) left the SDK or a socket external. Node would load the SDK natively, where no
 * override can apply. Types-only `<sdk>/contracts` may stay external.
 */
function externalSdk(p, ctx) {
  const { name, slotPackage } = p.sdk;
  const bare = (id) => id === slotPackage || id.startsWith(slotPackage + '/') || id === name || (id.startsWith(name + '/') && id !== `${name}/contracts`);
  const inNm = (pkg) => `${path.sep}node_modules${path.sep}${pkg.split('/').join(path.sep)}${path.sep}`;
  const hit = (id) => (path.isAbsolute(id) ? id.includes(inNm(name)) || id.includes(inNm(slotPackage)) : bare(id));
  const ids = [];
  for (const id of ctx.getModuleIds()) {
    const info = ctx.getModuleInfo(id);
    // Rollup: isExternal. Rolldown 1.2 has no isExternal; an external module has code === null there.
    if ((info?.isExternal ?? info?.code === null) && hit(id)) ids.push(path.isAbsolute(id) ? p.rel(id) : id);
  }
  if (!ids.length) return [];
  return [`[F6] the bundle leaves ${ids.map((s) => `"${s}"`).join(', ')} external: Node would load ${ids.length > 1 ? 'them' : 'it'} natively, where slot overrides cannot apply (the registry placeholder answers the sockets there). Bundle ${name}: make \`external\` exclude ${name} and ${slotPackage}.`];
}

/** Alias-only fragment for configs that cannot take plugins (no validation: chain `stunt-double check &&`). */
export function stuntDoubleAlias(opts = {}) {
  const p = generate({ ...opts, root: path.resolve(opts.root ?? process.cwd()), onError: 'throw' });
  return [{ find: new RegExp(`^${esc(p.sdk.slotPackage)}/([A-Za-z0-9_]+)$`), replacement: `${p.genDir}/$1.jsx` }];
}

export default stuntDouble;
