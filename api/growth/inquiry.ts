// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const info: any = {
    method: req.method,
    contentType: req.headers['content-type'],
    readable: (req as any).readable,
    readableEnded: (req as any).readableEnded,
    destroyed: (req as any).destroyed,
    hasBody: (req as any).body !== undefined,
  };
  // try reading stream
  let streamData = '';
  try {
    const chunks: any[] = [];
    for await (const c of req as any) chunks.push(c);
    streamData = Buffer.concat(chunks.map((x: any) => Buffer.isBuffer(x) ? x : Buffer.from(x))).toString();
  } catch (e: any) {
    streamData = 'STREAM ERR: ' + e.message;
  }
  info.streamData = streamData;
  // try req.body
  try {
    info.body = req.body;
  } catch (e: any) {
    info.bodyErr = e.message;
  }
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(info);
}