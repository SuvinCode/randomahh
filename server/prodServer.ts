/**
 * Production server (Render, or any Node host): serves the built game from
 * dist/ and the API routes from api/. Bundled by `npm run build` into
 * dist-server/prodServer.js; started with `npm start`.
 *
 * Also hosts the party-room WebSockets (/ws, server/wsServer.ts).
 *
 * Env: PORT (set by Render), MISTRAL_API_KEY, MISTRAL_MODEL.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import * as commandRoute from '../api/command';
import { sendLan } from './lan';
import { apiRouteName, handleApi, notFound, type RouteModule } from './nodeAdapter';
import { attachRooms } from './wsServer';

const ROUTES: Record<string, RouteModule> = { command: commandRoute };

const here = fileURLToPath(new URL('.', import.meta.url));
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? join(here, '..', 'dist'));
const PORT = Number(process.env.PORT ?? 3000);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.webmanifest']);

/** Static files are small and immutable per deploy: keep them (and their gzip) in memory. */
const fileCache = new Map<string, { raw: Buffer; gz?: Buffer }>();

function securityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Frame-Options', 'DENY');
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  // Resolve inside STATIC_DIR only (no path traversal).
  let file = resolve(STATIC_DIR, '.' + normalize(decodeURIComponent(pathname)));
  if (!file.startsWith(STATIC_DIR + sep) && file !== STATIC_DIR) return notFound(res);
  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = join(file, 'index.html');
    info = await stat(file).catch(() => null);
  }
  // Unknown non-asset paths fall back to the game page.
  if (!info) {
    if (extname(pathname)) return notFound(res);
    file = join(STATIC_DIR, 'index.html');
  }
  const ext = extname(file);
  let entry = fileCache.get(file);
  if (!entry) {
    const raw = await readFile(file);
    entry = { raw, gz: COMPRESSIBLE.has(ext) && raw.length > 1024 ? gzipSync(raw) : undefined };
    fileCache.set(file, entry);
  }
  res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
  // Vite puts content hashes in asset names, so those can be cached forever.
  res.setHeader('Cache-Control', file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.setHeader('Vary', 'Accept-Encoding');
  const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  const body = entry.gz && acceptsGzip ? entry.gz : entry.raw;
  if (body === entry.gz) res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Content-Length', body.length);
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = createServer((req, res) => {
  void (async () => {
    securityHeaders(res);
    const origin = `http://${req.headers.host ?? 'localhost'}`;
    const { pathname } = new URL(req.url ?? '/', origin);
    if (pathname === '/healthz') {
      res.setHeader('Content-Type', 'text/plain');
      res.end('ok');
      return;
    }
    // Local `npm start` only: LAN addresses for the join QR code (Render sets RENDER).
    if (pathname === '/api/lan' && !process.env.RENDER) return sendLan(res);
    const route = apiRouteName(pathname);
    if (route !== null) {
      const mod = ROUTES[route];
      return mod ? handleApi(req, res, mod, origin) : notFound(res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.end();
      return;
    }
    await serveStatic(req, res, pathname);
  })().catch((err) => {
    console.error('[server] request failed:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify({ error: 'Internal server error' }));
  });
});

const rooms = attachRooms(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] Random Ahh on :${PORT} (static: ${STATIC_DIR})`);
  if (!process.env.MISTRAL_API_KEY || !process.env.MISTRAL_MODEL) {
    console.warn('[server] MISTRAL_API_KEY / MISTRAL_MODEL not set: the god box will only understand built-in words.');
  }
});

// Render sends SIGTERM on deploys/restarts: finish in-flight requests, then exit.
process.on('SIGTERM', () => {
  rooms.close();
  server.close(() => process.exit(0));
});
