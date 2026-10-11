// Webpack-family additions to the shared harness (tests/harness): scenarios that only exist for tools that use
// stunt-double/webpack (webpack 5, Rspack 2, Rsbuild 2, CRA, Gatsby). Each tool's suite passes them through
// defineToolSuite({ mutations: (list) => [...list, ...webpackFamilyMutations(t)], devProbe: webpackDevProbe(t) }).
//
//   F6c-externals        server build with webpack-node-externals: the adapter keeps the SDK bundled (must pass)
//   F6c-externals-regex  a RegExp external that captures the SDK: [F6] "... is external in this node build"
//   F6-audit             a plugin redirects a socket to the SDK default: the post-bundle audit fails the build
//   F6e-remove / -add    warm persistent cache, then an override removed / added: never the old decision
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { STANDARD_RENDER } from '../harness/expect.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ADAPTER_IMPORT = /import \{ withStuntDouble \} from 'stunt-double\/webpack';\n/;

/** The fixture's own config with the adapter line replaced by a no-op: the same tool, never wired. */
export function unwiredConfig(fixtureDir, configFile) {
  const text = fs.readFileSync(path.join(REPO, fixtureDir, configFile), 'utf8');
  assert.match(text, ADAPTER_IMPORT, `${fixtureDir}/${configFile} must import withStuntDouble from 'stunt-double/webpack'`);
  return text.replace(ADAPTER_IMPORT, '// NOT WIRED: this config never got the stunt-double adapter\nconst withStuntDouble = (config) => config;\n');
}

/**
 * @param {object} t
 * @param {string} t.build        the suite's build command
 * @param {string} t.toolPackage  'webpack' | '@rspack/core'
 * @param {string} [t.ssrMarker]  the line of the SSR config to put externals after (default "    target: 'node',\n")
 * @param {string} [t.ssrBundle]  the built SSR file (default 'dist-ssr/entry-server.mjs')
 */
export function webpackFamilyMutations(t) {
  const marker = t.ssrMarker ?? "    target: 'node',\n";
  const ssrBundle = t.ssrBundle ?? 'dist-ssr/entry-server.mjs';
  const externals = (fx, suite, value) => fx.edit(suite.toolConfig, (s) => {
    assert.ok(s.includes(marker), `${suite.toolConfig}: no SSR config (${JSON.stringify(marker)}) to add externals to`);
    return s
      .replace(ADAPTER_IMPORT, (m) => `import nodeExternals from 'webpack-node-externals';\n${m}`)
      .replace(marker, `${marker}    externalsPresets: { node: true },\n    externals: ${value},\n`);
  });
  const lib = t.toolPackage === 'webpack' ? "(await import('webpack')).default" : "(await import('@rspack/core')).rspack";
  return [
    {
      id: 'F6c-externals',
      title: 'server build with webpack-node-externals: the adapter keeps @acme/core and its sockets bundled',
      family: 'webpack',
      catches: 'prevented (adapter wraps function externals)',
      tags: ['cfg', 'must-pass'],
      apply: (fx, suite) => externals(fx, suite, "[nodeExternals({ importType: 'module' })]"),
      expect: { outcome: 'pass', command: 'build', render: STANDARD_RENDER, bundle: { files: ssrBundle, absent: [/from\s*"@acme\/core/] } },
    },
    {
      id: 'F6c-externals-regex',
      title: 'a RegExp external captures @acme/core in the server build: Node would load the SDK without overrides',
      family: 'webpack',
      catches: 'AUD (external module in the final graph)',
      tags: ['aud'],
      apply: (fx, suite) => externals(fx, suite, '[/^@acme\\/core/]'),
      expect: { outcome: 'fail', command: 'build', messages: [/\[F6\] "@acme\/core" is external in this node build/] },
    },
    {
      id: 'F6-audit',
      title: 'a plugin redirects the PriceTag socket to the SDK default: the module-graph audit fails the build',
      family: 'webpack',
      catches: 'AUD (socket consumers without the shim)',
      tags: ['aud'],
      apply: (fx, suite) => fx.write('audit.config.mjs', `import base from './${suite.toolConfig}';
const lib = ${lib};
const all = (cfg) => (Array.isArray(cfg) ? cfg : [cfg]);
// A user plugin that "helpfully" resolves the PriceTag socket itself.
export default async (env, argv) => all(await (typeof base === 'function' ? base(env, argv) : base)).map((c) => {
  c.plugins.unshift(new lib.NormalModuleReplacementPlugin(/^@acme\\/core-slots\\/PriceTag$/, '@acme/core/original/PriceTag'));
  return c;
});
`),
      expect: { outcome: 'fail', run: `${t.build} --config audit.config.mjs`, messages: [/\[F6\] @acme\/core imports @acme\/core-slots\/PriceTag but [^\n]*PriceTag\.jsx is not in the bundle/] },
    },
    {
      id: 'F6e-remove',
      title: 'warm persistent cache, then the PriceTag override is removed: the SDK default renders, not the cached override',
      family: 'webpack',
      catches: 'prevented (decision in shim content + fingerprint in cache.version)',
      tags: ['cache', 'must-pass'],
      apply: async (fx, suite) => {
        const warm = await fx.run(suite.commands.build);
        assert.equal(warm.code, 0, `warm-up build failed:\n${warm.output.slice(-2000)}`);
        fx.remove(fx.override('PriceTag.tsx'));
      },
      expect: { outcome: 'pass', command: 'build', render: { sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0, BRAND_LOGO: 1 } } },
    },
    {
      id: 'F6e-add',
      title: 'warm persistent cache built WITHOUT the PriceTag override, then it is added: the override renders',
      family: 'webpack',
      catches: 'prevented (decision in shim content + fingerprint in cache.version)',
      tags: ['cache', 'must-pass'],
      apply: async (fx, suite) => {
        fx.remove(fx.override('PriceTag.tsx'));
        const warm = await fx.run(suite.commands.build);
        assert.equal(warm.code, 0, `warm-up build failed:\n${warm.output.slice(-2000)}`);
        fx.restore(fx.override('PriceTag.tsx'));
      },
      expect: { outcome: 'pass', command: 'build', render: STANDARD_RENDER },
    },
  ];
}

// ---- dev server, driven in a real browser -----------------------------------------------------------------
function loadPlaywright() {
  const tries = [createRequire(path.join(REPO, 'package.json'))];
  try { tries.push(createRequire(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'noop.js'))); } catch {}
  for (const req of tries) { try { return req('playwright'); } catch {} }
  throw new Error('the dev-server probe needs Playwright: npm i -g playwright@1.56.1 && playwright install chromium');
}

/**
 * Drives `<dev command>` in Chromium WITHOUT restarting it: remove/re-add an override (new decision in the same
 * rebuild), then F2a, F3, F5, F7 and F1a each show in the dev overlay and clear when fixed.
 * @param {object} t
 * @param {string} t.dev       dev-server command (PORT env selects the port)
 * @param {string} t.overlay   CSS selector of the overlay element (iframe or element with a shadow root)
 * @param {string} [t.path]    page path (default '/')
 */
export function webpackDevProbe(t) {
  return async (fx, tc) => {
    const { chromium } = loadPlaywright();
    const port = 20000 + Math.floor(Math.random() * 20000);
    const bin = path.join(fx.app, 'node_modules', '.bin');
    const srv = spawn('sh', ['-c', t.dev], { cwd: fx.app, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PORT: String(port), NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let log = '';
    srv.stdout.on('data', (b) => { log += b; });
    srv.stderr.on('data', (b) => { log += b; });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (what, cond, ms = 30_000) => {
      const t0 = Date.now();
      for (;;) {
        if (await cond().catch(() => false)) { await sleep(1500); if (await cond().catch(() => false)) { tc.diagnostic(`dev: ${what} (${Date.now() - t0} ms)`); return; } } // must hold 1.5 s
        if (Date.now() - t0 > ms) throw new Error(`dev: timed out waiting for: ${what}\n--- dev server log (tail) ---\n${log.slice(-4000)}`);
        await sleep(150);
      }
    };
    const ov = (f) => path.join(fx.app, fx.override(f));
    const price = fs.readFileSync(ov('PriceTag.tsx'), 'utf8');
    const button = fs.readFileSync(ov('Button.tsx'), 'utf8');
    let browser;
    try {
      browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
      await until('dev server up', async () => (await fetch(`http://localhost:${port}${t.path ?? '/'}`)).ok, 120_000);
      const page = await browser.newPage();
      await page.goto(`http://localhost:${port}${t.path ?? '/'}`);
      const html = () => page.evaluate(() => document.body.innerHTML);
      const overlay = () => page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        return el.contentDocument?.body?.innerText ?? el.shadowRoot?.textContent ?? el.textContent ?? '';
      }, t.overlay);
      const clean = async () => (await overlay()) === null && (await html()).includes('BRAND_BUTTON');
      const shows = (re) => async () => re.test((await overlay()) ?? '');

      await until('initial render with overrides', async () => (await clean()) && (await html()).includes('BRAND_PRICE'));
      fs.rmSync(ov('PriceTag.tsx'));
      await until('PriceTag override removed -> SDK default renders', async () => (await html()).includes('SDK_DEFAULT_PRICETAG') && !(await html()).includes('BRAND_PRICE') && (await overlay()) === null);
      fs.writeFileSync(ov('PriceTag.tsx'), price);
      await until('PriceTag override re-added -> override renders', async () => (await html()).includes('BRAND_PRICE') && !(await html()).includes('SDK_DEFAULT_PRICETAG') && (await overlay()) === null);

      const mistakes = [
        ['F2a typo', () => fs.writeFileSync(ov('Buton.tsx'), button), () => fs.rmSync(ov('Buton.tsx')), /\[F2\][^\n]*Buton\.tsx[^\n]*did you mean "Button"/],
        ['F3a required slot missing', () => fs.renameSync(ov('Logo.tsx'), ov('_Logo.tsx')), () => fs.renameSync(ov('_Logo.tsx'), ov('Logo.tsx')), /\[F3\] required slot "Logo"/],
        ['F5a wrong export', () => fs.writeFileSync(ov('Button.tsx'), button.replace('export function Button', 'export default function Button')), () => fs.writeFileSync(ov('Button.tsx'), button), /\[F5\][^\n]*must export a named `Button`/],
        ['F7 self import', () => fs.writeFileSync(ov('Button.tsx'), `import { Button as Self } from '@acme/core';\nconsole.log(Self);\n${button}`), () => fs.writeFileSync(ov('Button.tsx'), button), /\[F7\][^\n]*Button\.tsx/],
        ['F1a contract', () => fs.writeFileSync(ov('Button.tsx'), button.replace("props: SlotProps['Button']", "props: SlotProps['Button'] & { tone: 'loud' }")), () => fs.writeFileSync(ov('Button.tsx'), button), /\[F1\] Button[^\n]*TS2322/],
      ];
      for (const [name, make, fix, re] of mistakes) {
        make();
        await until(`${name}: overlay shows ${re}`, shows(re));
        fix();
        await until(`${name}: overlay clears after the fix`, clean);
      }
    } finally {
      await browser?.close().catch(() => {});
      try { process.kill(-srv.pid, 'SIGTERM'); } catch {}
    }
  };
}
