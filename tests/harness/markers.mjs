// Render markers shared by every example app (the "fixture contract", see tests/README.md).
//
// Every component that can render in a slot position stamps data-sd="<MARKER>" (and, where it reads a
// context, data-ctx="<value>"):
//   SDK defaults (from @acme/core):   SDK_DEFAULT_BUTTON(ctx = in-cart | none), SDK_DEFAULT_PRICETAG,
//                                     SDK_DEFAULT_BADGE (1.1.0), SDK_DEFAULT_PRICE (2.0.0)
//   SDK components using VALUE slots: SDK_TOTAL(ctx = the checkout total, formatted by the effective formatPrice)
//   project overrides (examples):     BRAND_BUTTON(ctx = app theme), BRAND_PRICE, BRAND_LOGO, BRAND_FOOTER, ...
// The app renders two sections: <section data-probe="app"> (app-level imports from '@acme/core') and
// <section data-probe="sdk"> (the SDK's <Checkout>, i.e. SDK-internal slot positions).

export const RENDER_LINE = 'STUNT-DOUBLE-RENDER ';

/** Extract the rendered HTML from a probe's stdout. */
export function parseRenderOutput(stdout) {
  const line = String(stdout).split(/\r?\n/).find((l) => l.startsWith(RENDER_LINE));
  if (!line) return null;
  return JSON.parse(line.slice(RENDER_LINE.length));
}

export function section(html, name) {
  return html.split(`data-probe="${name}"`)[1]?.split('</section>')[0] ?? '';
}

/** Ordered marker tokens, e.g. ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)']. */
export function markers(html) {
  return [...String(html).matchAll(/data-sd="([A-Z0-9_]+)"(?: data-ctx="([^"]*)")?/g)].map((m) => (m[2] ? `${m[1]}(${m[2]})` : m[1]));
}

export function summarize(html) {
  const app = markers(section(html, 'app'));
  const sdk = markers(section(html, 'sdk'));
  return { html, app, sdk, all: markers(html) };
}

const count = (list, token) => list.filter((t) => t === token || (!token.includes('(') && t.split('(')[0] === token)).length;

/**
 * Compare a summary with an expectation:
 *   { app: ['BRAND_BUTTON(dark)', ...] }          exact ordered sequence
 *   { sdk: { BRAND_PRICE: 3, SDK_DEFAULT_PRICETAG: 0, 'BRAND_BUTTON(dark)': '>=1' } }   counts
 * A token without "(ctx)" counts every context. Returns a list of mismatch descriptions (empty = ok).
 */
export function compareRender(summary, expect) {
  const errors = [];
  for (const [where, want] of Object.entries(expect)) {
    const got = summary[where];
    if (!got) { errors.push(`unknown render section "${where}"`); continue; }
    if (Array.isArray(want)) {
      if (JSON.stringify(got) !== JSON.stringify(want)) errors.push(`${where}: expected [${want.join(', ')}], got [${got.join(', ')}]`);
      continue;
    }
    for (const [token, n] of Object.entries(want)) {
      const c = count(got, token);
      if (!matchCount(c, n)) errors.push(`${where}: expected ${token} x ${n}, got ${c} (markers: ${got.join(', ') || 'none'})`);
    }
  }
  return errors;
}

/** n: exact number, or a string like '>=1', '>0', '<=2'. */
export function matchCount(c, n) {
  if (typeof n === 'number') return c === n;
  const m = /^(>=|<=|>|<|=)?\s*(\d+)$/.exec(String(n));
  if (!m) throw new Error(`bad count expectation ${n}`);
  const v = Number(m[2]);
  switch (m[1]) {
    case '>=': return c >= v;
    case '<=': return c <= v;
    case '>': return c > v;
    case '<': return c < v;
    default: return c === v;
  }
}
