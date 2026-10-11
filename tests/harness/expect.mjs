// Assertions shared by every suite: exit status (non-zero, never an exact code), message regexes, render
// markers and bundle contents. Failures quote the tail of the command output.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseRenderOutput, summarize, compareRender } from './markers.mjs';
import { glob, tail } from './util.mjs';

/**
 * The render every fixture app produces with its standard overrides (the "fixture contract", tests/README.md):
 * wrapped Button (BRAND_BUTTON reading the app theme "dark", wrapping the SDK default), replaced PriceTag
 * (BRAND_PRICE; the SDK default never renders), the required Logo, both app-level and inside SDK <Checkout>.
 */
export const STANDARD_RENDER = Object.freeze({
  app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'],
  sdk: {
    BRAND_LOGO: 1,
    BRAND_PRICE: 3,
    SDK_DEFAULT_PRICETAG: 0,
    'BRAND_BUTTON(dark)': 3,
    'SDK_DEFAULT_BUTTON(in-cart)': 3,
  },
});

/** The client bundle of the standard fixture: the replaced default is ABSENT, the wrapped original PRESENT. */
export const STANDARD_BUNDLE = Object.freeze({
  contains: ['BRAND_BUTTON', 'BRAND_PRICE', 'BRAND_LOGO', 'SDK_DEFAULT_BUTTON'],
  absent: ['SDK_DEFAULT_PRICETAG'],
});

const describeRun = (r) => `\`${r.command}\` ${r.timedOut ? 'TIMED OUT' : `exited ${r.code ?? r.signal}`} after ${r.ms} ms`;

export function assertFailed(r, what = '') {
  assert.ok(!r.timedOut, `${what}${describeRun(r)}\n${tail(r.output)}`);
  assert.notEqual(r.code, 0, `${what}expected a NON-ZERO exit, but ${describeRun(r)}: the mistake passed silently (north star: it must fail the build)\n${tail(r.output)}`);
}

export function assertPassed(r, what = '') {
  assert.ok(!r.timedOut, `${what}${describeRun(r)}\n${tail(r.output)}`);
  assert.equal(r.code, 0, `${what}expected exit 0, but ${describeRun(r)}\n${tail(r.output)}`);
}

export function assertMessages(r, messages = [], absent = [], what = '') {
  for (const re of [].concat(messages)) assert.match(r.output, re, `${what}output of ${describeRun(r)} does not match ${re}\n${tail(r.output, 60)}`);
  for (const re of [].concat(absent)) assert.doesNotMatch(r.output, re, `${what}output of ${describeRun(r)} must not match ${re}\n${tail(r.output, 60)}`);
}

/** Parse a render probe's output (the STUNT-DOUBLE-RENDER line) and compare it with an expectation. */
export function assertRender(r, expect, what = '') {
  assertPassed(r, `${what}render probe: `);
  const html = parseRenderOutput(r.stdout);
  assert.ok(html != null, `${what}the render probe printed no STUNT-DOUBLE-RENDER line\n${tail(r.output)}`);
  const s = summarize(html);
  const errors = compareRender(s, expect);
  assert.deepEqual(errors, [], `${what}rendered markers differ:\n  ${errors.join('\n  ')}\n  app: ${s.app.join(' > ')}\n  sdk: ${s.sdk.join(', ')}`);
  return s;
}

/**
 * Bundle contents: { files: 'dist/assets/*.js', contains: [...], absent: [...] } (strings or RegExps), searched in
 * the concatenation of every matching file below `root`.
 */
export function assertBundle(root, spec, what = '') {
  const files = [].concat(spec.files).flatMap((g) => glob(root, g));
  assert.ok(files.length > 0, `${what}no bundle files match ${[].concat(spec.files).join(', ')} in ${root}`);
  const text = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const rel = files.map((f) => path.relative(root, f)).join(', ');
  const test = (needle) => (needle instanceof RegExp ? needle.test(text) : text.includes(needle));
  for (const n of spec.contains ?? []) assert.ok(test(n), `${what}bundle (${rel}) should contain ${n}`);
  for (const n of spec.absent ?? []) assert.ok(!test(n), `${what}bundle (${rel}) must NOT contain ${n}`);
  return files;
}
