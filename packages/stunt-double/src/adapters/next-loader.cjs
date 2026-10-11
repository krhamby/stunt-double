// stunt-double/next, Turbopack dev only: a pass-through loader on project sources; it checks the override files
// and the files they import (next-validate.mjs), everything else passes straight through.
//
// Turbopack recompiles a saved override at once, before any file watcher could poison the shims. If that save
// made the override render its own slot (F7), the dev server would evaluate an infinite render in that window and
// hang. This loader runs INSIDE the compilation: it re-validates (without writing anything; the dev watcher owns
// the shims) and throws on any injection error, so the module fails to compile and Next shows the [Fx] report.
'use strict';

const { validateFor } = require('./next-validate.mjs');

module.exports = function stuntDoubleOverrideLoader(source, map) {
  const genOpts = this.getOptions ? this.getOptions() : (this.query || {});
  const message = validateFor(genOpts, this.resourcePath);
  if (message) throw new Error(message);
  this.callback(null, source, map);
};
