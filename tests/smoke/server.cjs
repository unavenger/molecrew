// server.cjs — serves the game on :8199 with Three.js swapped for a do-nothing stand-in,
// so the smoke tests can run in a browser with no graphics card or CDN access.
//
// DECISION (Claude): the page is the real index.html with only the import-map line rewritten,
// so the test page can never drift from the game page.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'); // project root
const THREE_CDN = /"three":\s*"[^"]+"/;

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const send = (type, body) => { res.writeHead(200, { 'Content-Type': type }); res.end(body); };
  if (url === '/' || url === '/index.html') {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(THREE_CDN, '"three": "/__mock/three.js"');
    return send('text/html', html);
  }
  const file = url === '/__mock/three.js' ? path.join(__dirname, 'three-mock.js') : path.join(ROOT, url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    send(file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : 'application/octet-stream', data);
  });
}).listen(8199, () => console.log('smoke server on http://localhost:8199'));
