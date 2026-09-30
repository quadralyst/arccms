#!/usr/bin/env node
/**
 * `npm run docs`: serve docs/ at http://localhost:5180 for browsing. The files also open
 * straight from disk (docs/index.html); this is only for a real address, such as a phone
 * on the same network, or checking how a page looks behind a server.
 *
 *   npm run docs -- --port 5190
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { DOCS_DIR } from './docs-lib.mjs';

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
};

const at = process.argv.indexOf('--port');
const port = at >= 0 ? Number(process.argv[at + 1]) : 5180;

createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = normalize(join(DOCS_DIR, url));
    if (file !== DOCS_DIR && !file.startsWith(DOCS_DIR + sep)) {
        res.writeHead(403).end('Forbidden');
        return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Docs at http://localhost:${port}`));
