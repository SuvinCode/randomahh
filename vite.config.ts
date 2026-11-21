import { defineConfig } from 'vitest/config';
import { loadEnv, type Plugin, type ViteDevServer } from 'vite';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { sendLan } from './server/lan';
import { apiRouteName, handleApi, notFound, type RouteModule } from './server/nodeAdapter';
import { attachRooms } from './server/wsServer';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Dev-only: serve `api/<name>.ts` at `/api/<name>` through the same adapter as
 * the production server (server/prodServer.ts), with hot reloading of handlers.
 */
function apiRoutes(): Plugin {
  return {
    name: 'random-ahh-api-routes',
    configureServer(server: ViteDevServer) {
      // Server-side secrets (e.g. MISTRAL_API_KEY) for the handlers. Only VITE_*
      // variables ever reach client code, and we don't define any.
      Object.assign(process.env, loadEnv(server.config.mode, root, ''));
      // Party rooms (phones join by QR code) share the dev server's port.
      if (server.httpServer) attachRooms(server.httpServer as Server);
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] === '/api/lan') return sendLan(res);
        const name = apiRouteName(new URL(req.url ?? '/', 'http://dev').pathname);
        if (name === null) return next();
        if (!existsSync(`${root}api/${name}.ts`)) return notFound(res);
        server
          .ssrLoadModule(`/api/${name}.ts`)
          .then((mod) => handleApi(req, res, mod as RouteModule, `http://${req.headers.host ?? 'localhost'}`))
          .catch((err: Error) => {
            server.ssrFixStacktrace(err);
            next(err);
          });
      });
    },
  };
}

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [apiRoutes()],
  // Listen on the LAN too, so phones on the same Wi-Fi can join a party room.
  server: { host: true },
  // public/ (manifest, icon) belongs to the game in dist/, not the server bundle.
  publicDir: isSsrBuild ? false : 'public',
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    // Phaser alone is ~1.4 MB minified; that's expected.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
}));
