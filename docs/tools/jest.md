# Jest 30

```js
// jest.config.mjs
import { withStuntDouble } from 'stunt-double/jest';

export default withStuntDouble({ testEnvironment: 'node' });
```

`withStuntDouble()` returns an async config (Jest accepts one). When Jest loads it:

- every validation error fails `jest` before a single test runs, with the same `[Fx]` report as the build;
- `moduleNameMapper` maps `@acme/core-slots/<Slot>` to the generated shim, including requires from inside `node_modules` (the SDK's own);
- `transformIgnorePatterns` lets the transformer handle the ESM SDK (unless you set your own patterns: then keep the SDK transformable yourself).

Contracts are not type-checked by default, because babel-jest and @swc/jest never type-check: the build or `stunt-double check` in CI is the gate. Opt in with `withStuntDouble(config, { typecheck: true })`.

**Transformer:** babel-jest (with `@babel/preset-env`, `@babel/preset-typescript` and `@babel/preset-react`) or @swc/jest. Not ts-jest: it has no TypeScript 7 support and forces Node10 resolution.

**Verified with** jest 30.5.2 + babel-jest 30.5.2 + Babel 8 in `examples/customer-webpack`: `tests/webpack.test.mjs` runs `jest` in the positive scenario and requires it to fail on F2, F3, F4, F5, F7 and the value-slot mistakes V2 and V7.
