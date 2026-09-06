// Vercel serverless entrypoint. Build (npm run build) emits dist/ first.
// Static imports (not dynamic) so the platform detects the Express app and
// traces dist/ into the function bundle. The app is still created lazily once
// per warm instance.
import express from 'express';
import { createApp } from '../dist/app.js';

let app: express.Application | null = null;

async function getApp(): Promise<express.Application> {
  if (!app) app = await createApp();
  return app;
}

export default async function handler(req: any, res: any): Promise<void> {
  const instance = await getApp();
  return (instance as any)(req, res);
}
