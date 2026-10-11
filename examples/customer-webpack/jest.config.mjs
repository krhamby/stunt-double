import { withStuntDouble } from 'stunt-double/jest';

// withStuntDouble() refuses to start Jest on any injection mistake (the same [Fx] report as the build), maps
// @acme/core-slots/* to the generated shims, and transforms the ESM SDK.
export default withStuntDouble({
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.[jt]s?(x)'],
});
