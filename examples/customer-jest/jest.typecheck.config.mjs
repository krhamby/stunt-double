import { withStuntDouble } from 'stunt-double/jest';

// Opt-in: also run the contract type gate when Jest loads the config, so `jest` itself exits 1 on [F1]/[F9]
// (babel-jest and @swc/jest never type-check). Costs one tsc run per Jest start (~0.2-0.5 s with TypeScript 7).
export default withStuntDouble({ testEnvironment: 'jsdom' }, { typecheck: true });
