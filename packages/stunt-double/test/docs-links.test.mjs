// Every report ends with links into docs/ (docsUrl): each must land on a real heading, or the help a user is
// sent to is a dead link. Anchors are computed the way GitHub does for Markdown headings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { docsUrl, DOCS_BASE } from '../src/core/index.mjs';
import { REPO_ROOT } from './helpers.mjs';

/** GitHub's heading anchor: lowercase, drop punctuation (keeps letters, digits, spaces, - and _), spaces -> -. */
const slug = (heading) => heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\- _]/gu, '').replace(/ /g, '-');

function anchorsOf(file) {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'docs', file), 'utf8');
  return new Set([...text.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1])));
}

test('every message code links to an existing heading in docs/', () => {
  const codes = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'W7', 'F8', 'F9', 'STALE', 'TS-PNP', 'X1', 'X2', 'X3', 'X4',
    'STUNT-DOUBLE-NOT-WIRED', 'STUNT-DOUBLE-ERROR', 'TS', 'CFG', 'SETUP', 'L1', 'L2', 'DOCTOR', 'SDK1', 'SDK6', 'SDK'];
  const cache = new Map();
  for (const code of codes) {
    const url = docsUrl(code);
    assert.ok(url?.startsWith(DOCS_BASE), `${code} has a docs URL`);
    const [file, anchor] = url.slice(DOCS_BASE.length).split('#');
    if (!cache.has(file)) cache.set(file, anchorsOf(file));
    assert.ok(cache.get(file).has(anchor), `${code}: docs/${file} has no heading with anchor #${anchor}`);
  }
});
