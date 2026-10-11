// Module hooks for an adapter-less tool. Resolution is Node's (package "exports", realpath'd symlinks); the
// only additions are what any TS-aware tool adds: extensionless relative imports and a TS/JSX transform.
import { readFile } from 'node:fs/promises';
import { transform } from 'sucrase';

const TS_JSX = /\.(tsx?|jsx|mts)$/;

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.\.?\//.test(specifier) || /\.[a-z]+$/i.test(specifier)) throw e;
    for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
      try { return await next(specifier + ext, context); } catch {}
    }
    throw e;
  }
}

export async function load(url, context, next) {
  if (!url.startsWith('file:') || !TS_JSX.test(url)) return next(url, context);
  const source = await readFile(new URL(url), 'utf8');
  const { code } = transform(source, { transforms: ['typescript', 'jsx'], jsxRuntime: 'automatic', production: true, filePath: url });
  return { format: 'module', source: code, shortCircuit: true };
}
