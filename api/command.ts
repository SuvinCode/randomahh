// Route: POST /api/command. Logic lives in server/interpretCommand.ts.
// Served by server/prodServer.ts in production and the Vite plugin in dev.
import { handleCommand } from '../server/interpretCommand';

export function POST(request: Request): Promise<Response> {
  return handleCommand(request);
}
