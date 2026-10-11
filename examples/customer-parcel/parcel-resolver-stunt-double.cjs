// Parcel only loads resolver plugins named "parcel-resolver-*" or given as relative paths, so this two-line
// file is how .parcelrc reaches stunt-double/parcel. It runs the stunt-double checks inside `parcel build`.
// (CommonJS on purpose: Parcel 2.16 warns "ES module dependencies are experimental" for an .mjs plugin.)
const { stuntDouble } = require('stunt-double/parcel');

module.exports = stuntDouble({ root: __dirname });
