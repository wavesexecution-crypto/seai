import type { IncomingMessage, ServerResponse } from 'node:http';

export default async function health(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'seai' }));
}
