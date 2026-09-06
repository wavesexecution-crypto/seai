// Vercel serverless entrypoint. Build (npm run build) emits dist/ first;
// this handler lazily creates the Express app once per warm instance.
let app: any = null;

async function getApp(): Promise<any> {
  if (!app) {
    const mod = await import('../dist/app.js');
    app = await mod.createApp();
  }
  return app;
}

export default async function handler(req: any, res: any): Promise<void> {
  const instance = await getApp();
  return instance(req, res);
}
