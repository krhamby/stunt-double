import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformIgnorePatternsFor } from '../src/adapters/jest.mjs';

test('jest transformIgnorePatternsFor: transforms the SDK in npm and pnpm layouts, ignores everything else', () => {
  const [pattern] = transformIgnorePatternsFor(['@acme/core', '@acme/brand']);
  const ignored = (f) => new RegExp(pattern).test(f);
  assert.equal(ignored('/app/node_modules/@acme/core/dist/index.js'), false);
  assert.equal(ignored('/app/node_modules/.pnpm/@acme+core@1.0.0/node_modules/@acme/core/dist/index.js'), false);
  assert.equal(ignored('/app/node_modules/@acme/brand/layer/Button.js'), false);
  assert.equal(ignored('/app/node_modules/react/index.js'), true);
  assert.equal(ignored('/app/node_modules/.pnpm/react@19.3.0/node_modules/react/index.js'), true);
  assert.equal(ignored('/app/node_modules/@acme/core-extra/index.js'), true, 'a package whose name only starts with the SDK name');
  assert.equal(ignored('/app/sdk-slots/gen/Button.jsx'), false);
});
