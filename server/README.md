# server/

Server-side logic behind the route modules in `../api/`. Everything uses
web-standard `fetch`/`Request`/`Response`, so the same code runs in the
production Node server (`prodServer.ts`, deployed on Render), in the Vite dev
server (the `apiRoutes` plugin in `vite.config.ts`), and in tests with a fake
`fetch`. `nodeAdapter.ts` bridges Node's http server to those handlers.

| Route | Entry | Logic |
|---|---|---|
| `POST /api/command` `{ text, fighters }` | `api/command.ts` | `interpretCommand.ts`: god-box text the client's local parser couldn't read → Mistral (JSON-schema output) → Zod-validated, sanitised `CommandPlan` |
| `GET /healthz` | `prodServer.ts` | Render health check |

The prompt `prompts/godCommands.md` is imported with `?raw`, so it is bundled
into `dist-server/prodServer.js` (no files to ship separately).

## Environment (server only)

- `MISTRAL_API_KEY`, `MISTRAL_MODEL`: the AI god box. Optional: without them
  `/api/command` answers 503 with a friendly hint, and the game still
  understands all the built-in words locally.
- `PORT`: set by Render (default 3000 locally).

Never import anything from here into `src/`.

## Limits

A per-client limit of 20 AI interpretations per minute, in memory (resets when
the process restarts, e.g. Render free-plan sleep).
