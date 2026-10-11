#!/usr/bin/env node
// `storybook <args>` for the test harness: runs the real Storybook CLI and exits with ITS exit code, then
// reprints its output with Storybook's logger wrapping undone. Storybook wraps every log message at no more
// than ~80 columns ("|  " continuation lines, MAX_OPTIMAL_WIDTH in storybook/dist/node-logger), whatever the
// terminal width, so one `[Fx] … did you mean "Button"` line would otherwise be split across several.
//
//   node probes/storybook.mjs build -o storybook-static
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkg = require.resolve('storybook/package.json');
const bin = path.join(path.dirname(pkg), require(pkg).bin.storybook ?? require(pkg).bin);
const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], { stdio: ['inherit', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
child.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
child.on('close', (code, signal) => {
  // A continuation line is "|  <text>" right after another "|  " line, unless <text> starts a new report line.
  const lines = out.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/);
  const joined = [];
  for (const l of lines) {
    const m = /^[|│]  (.*)$/.exec(l);
    const prev = joined.length ? joined[joined.length - 1] : null;
    if (m && prev !== null && /^[|│]  \S/.test(prev) && !/^(\[[A-Z0-9-]+\]|stunt-double:|at\s)/.test(m[1])) joined[joined.length - 1] = `${prev} ${m[1]}`;
    else joined.push(l);
  }
  process.stdout.write(`\n---- storybook output, log lines unwrapped ----\n${joined.join('\n')}\n`);
  process.exit(code ?? (signal ? 1 : 0));
});
