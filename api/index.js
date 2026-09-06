// Vercel serverless entrypoint (plain JavaScript — zero transpiler risk).
// Build (npm run build) emits dist/ first; this handler lazily creates the
// Express app once per warm instance. Static express import keeps framework
// detection and bundle tracing fully static.
import express from 'express';
import { createApp } from '../dist/app.js';

let app = null;

async function getApp() {
  if (!app) app = await createApp();
  return app;
}

export default async function handler(req, res) {
  const instance = await getApp();
  return instance(req, res);
}
