import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function health(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ ok: true, service: 'seai' });
}
