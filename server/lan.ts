/**
 * When the host opens the game on `localhost`, phones can't use that address.
 * This lists the machine's LAN addresses so the QR code can point at one.
 * Served at GET /api/lan by the dev server and by a local `npm start` (never on Render).
 */
import { networkInterfaces } from 'node:os';
import type { ServerResponse } from 'node:http';

export function lanAddresses(): string[] {
  const out: { ip: string; score: number }[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // Prefer real Wi-Fi/Ethernet over virtual adapters (WSL, Docker, VPNs).
      const virtual = /vethernet|wsl|docker|vmware|virtualbox|hyper-v|tailscale|zerotier|vpn|loopback/i.test(name);
      const privateNet = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      out.push({ ip: a.address, score: (virtual ? 0 : 2) + (privateNet ? 1 : 0) + (a.address.startsWith('192.168.') ? 1 : 0) });
    }
  }
  return out.sort((a, b) => b.score - a.score).map((a) => a.ip);
}

export function sendLan(res: ServerResponse): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ ips: lanAddresses() }));
}
