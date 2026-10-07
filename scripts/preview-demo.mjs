import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const base = '/inkverse-odyssey/';
const files = new Map(['index.html', 'app.js', 'transport.js', 'styles.css', 'favicon.svg', 'browser-demo.js', 'demo-content.js', 'extra-content.js', 'learning-core.js'].map(name => [base + name, name]));
files.set(base, 'index.html');
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' };
http.createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') { res.writeHead(302, { Location: base }); res.end(); return; }
  const file = files.get(path);
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  try {
    res.writeHead(200, { 'Content-Type': (types[file.split('.').at(-1)] ?? 'text/plain') + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(readFileSync(root + file));
  } catch { res.writeHead(503); res.end('Run npm run build:demo first.'); }
}).listen(3211, '127.0.0.1', () => console.log('Pages subpath preview: http://127.0.0.1:3211/inkverse-odyssey/'));
