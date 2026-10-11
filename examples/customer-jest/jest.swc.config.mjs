import { withStuntDouble } from 'stunt-double/jest';

// Same project, compiled by @swc/jest instead of babel-jest.
export default withStuntDouble({
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } } }],
  },
});
