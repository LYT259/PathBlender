/**
 * Static server that serves packages/web/dist under a URL subpath, mimicking
 * a GitHub Pages project site (https://user.github.io/PathBlender/).
 * Used to verify the production build is subpath-safe before each release.
 *
 * Usage: node scripts/serve-subpath.mjs   → http://localhost:4174/PathBlender/
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../packages/web/dist', import.meta.url));
const PREFIX = '/PathBlender/';
const PORT = Number(process.env.PORT ?? 4174);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (!pathname.startsWith(PREFIX)) {
      res.writeHead(404).end('expected subpath ' + PREFIX);
      return;
    }
    let rel = pathname.slice(PREFIX.length) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';

    let file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }

    let data;
    try {
      data = await readFile(file);
    } catch {
      // SPA fallback for extension-less routes; assets 404 hard.
      if (extname(file)) {
        res.writeHead(404).end('not found');
        return;
      }
      file = join(ROOT, 'index.html');
      data = await readFile(file);
    }

    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(500).end();
  }
}).listen(PORT, () => {
  console.log(`subpath preview: http://localhost:${PORT}${PREFIX} (root: ${ROOT})`);
});
