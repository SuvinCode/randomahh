/**
 * WebSockets for party rooms, on the same http server as the game (dev: Vite's,
 * prod: server/prodServer.ts). Only upgrades to WS_PATH are taken; anything
 * else (e.g. Vite's HMR socket) is left alone.
 */
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_HOST_MESSAGE_BYTES, WS_PATH } from '../shared/room';
import { RoomHub } from './rooms';

const PING_MS = 15_000;

export function attachRooms(server: Server, hub = new RoomHub()): { hub: RoomHub; close: () => void } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_HOST_MESSAGE_BYTES + 1024 });
  const alive = new WeakSet<WebSocket>();

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname } = new URL(req.url ?? '/', 'http://x');
    if (pathname !== WS_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      alive.add(ws);
      const session = hub.connect({
        send: (data) => {
          if (ws.readyState === ws.OPEN) ws.send(data);
        },
        close: () => ws.close(),
      });
      ws.on('pong', () => alive.add(ws));
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        session.message(data.toString());
      });
      ws.on('close', () => session.closed());
      ws.on('error', () => ws.terminate());
    });
  };
  server.on('upgrade', onUpgrade);

  // Phones that sleep or lose signal don't always close cleanly: ping, and drop the silent ones.
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, PING_MS);
  timer.unref();

  return {
    hub,
    close: () => {
      clearInterval(timer);
      server.off('upgrade', onUpgrade);
      hub.closeAll();
      wss.close();
    },
  };
}
