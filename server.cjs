// server.cjs — a tiny local web server, using only what ships with Node (no installs).
// Browsers refuse to load JavaScript modules and 3D model files straight from disk,
// so the game must be opened through http://localhost instead of double-clicking index.html.
//
// Run:  node server.cjs   (or double-click start.bat)

const http = require('http'); // Node's built-in web server
const fs = require('fs'); // Node's built-in file reading
const path = require('path'); // helpers for building file paths safely
const { exec } = require('child_process'); // runs another program (used to open the browser)

const PORT = 8137; // DECISION (Claude): an unusual port, unlikely to clash with anything else
const ROOT = __dirname; // the folder this file lives in

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    // Refuse anything outside this folder.
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not found');
      }
      // DECISION (Claude): no caching, so a refresh always shows the latest files.
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Mole Crew running at ${url}  (close this window to stop)`);
    // DECISION (Claude): open the browser automatically on Windows.
    if (process.platform === 'win32') exec(`start "" "${url}"`);
  });
