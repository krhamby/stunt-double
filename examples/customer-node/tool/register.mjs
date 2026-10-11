// The "unknown tool": Node's own ESM loader plus a transpile-only hook. Nothing here knows about stunt-double.
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
