// tools/export-lines.mjs — writes every narrator line to assets/voice/lines.json,
// so the Python voice generator (make_voices.py) can read them.
// Run from the project folder:  node tools/export-lines.mjs
import { writeFileSync, mkdirSync } from 'node:fs'; // Node's built-in file tools
import { LINES } from '../src/narration.js';

mkdirSync('assets/voice', { recursive: true }); // make the folder if it isn't there yet
writeFileSync('assets/voice/lines.json', JSON.stringify(LINES, null, 2));
console.log(`Wrote ${Object.keys(LINES).length} lines to assets/voice/lines.json`);
