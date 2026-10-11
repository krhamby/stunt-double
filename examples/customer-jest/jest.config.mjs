import { withStuntDouble } from 'stunt-double/jest';

// withStuntDouble(): validates src/overrides when Jest loads this file (any injection error exits 1 before a
// test runs), maps @acme/core-slots/* to the generated shims (also for requires from inside node_modules) and
// lets babel-jest compile the ESM SDK.
export default withStuntDouble({
  testEnvironment: 'jsdom',
});
