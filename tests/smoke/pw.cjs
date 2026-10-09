// pw.cjs — finds Playwright for the smoke tests.
// DECISION (Claude): the cloud workspace keeps Playwright in /opt/npm-tools; anywhere else,
// a normal `npm install playwright` works. require() loads a Node module by path or name.
try { module.exports = require('/opt/npm-tools/node_modules/playwright'); }
catch { module.exports = require('playwright'); }
