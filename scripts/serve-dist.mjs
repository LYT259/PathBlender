// Minimal static server for packages/web/dist — a drop-in `vite preview`
// replacement for environments where vite preview dies (ETIMEDOUT under
// long-lived task harnesses). Usage: node scripts/serve-dist.mjs [port].
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../packages/web/dist/', import.meta.url).pathname;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};
createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'content-length': data.length });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
const PORT = Number(process.argv[2] ?? 4173);
}).listen(PORT, '127.0.0.1', () => console.log(`static up on ${PORT}`));
