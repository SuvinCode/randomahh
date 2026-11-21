/**
 * Bridges Node's http server and our web-standard handlers
 * (`(request: Request) => Response`). Used by the Vite dev server and by the
 * production server (server/prodServer.ts), so both behave identically.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export type WebHandler = (request: Request) => Response | Promise<Response>;
/** A route module: named exports per HTTP method (GET, POST, ...). */
export type RouteModule = Partial<Record<string, unknown>>;

const MAX_BODY_BYTES = 16 * 1024; // our API only ever receives tiny JSON bodies

export class BodyTooLargeError extends Error {}

export async function toWebRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const url = new URL(req.url ?? '/', origin);
  const method = req.method ?? 'GET';
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(', '));
  }
  // Our API only accepts small JSON bodies, so text is the simplest portable form.
  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) throw new BodyTooLargeError('Request body too large');
      chunks.push(chunk as Buffer);
    }
    body = Buffer.concat(chunks).toString('utf8');
  }
  return new Request(url, { method, headers, body });
}

export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** Run `/api/<name>` against a route module. Unknown methods → 405. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, mod: RouteModule, origin: string): Promise<void> {
  const method = req.method ?? 'GET';
  const handler = mod[method];
  if (typeof handler !== 'function') {
    res.setHeader('Allow', Object.keys(mod).filter((k) => /^[A-Z]+$/.test(k)).join(', '));
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  try {
    const request = await toWebRequest(req, origin);
    await sendWebResponse(res, await (handler as WebHandler)(request));
  } catch (err) {
    if (err instanceof BodyTooLargeError) return sendJson(res, 413, { error: err.message });
    throw err;
  }
}

export function notFound(res: ServerResponse): void {
  sendJson(res, 404, { error: 'Not found' });
}

/** Route names are plain words: /api/search, /api/level. */
export function apiRouteName(pathname: string): string | null {
  const m = /^\/api\/([a-z0-9-]+)\/?$/i.exec(pathname);
  return m ? m[1] : null;
}
