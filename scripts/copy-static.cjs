// Copies the SPA shell and standalone HTML pages into dist/ so the
// serverless bundle is self-contained. Vercel serves all other public/*
// assets from outputDirectory. Plain node, no dependencies.
const { copyFileSync, mkdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const distPublic = join(root, 'dist', 'public');
mkdirSync(distPublic, { recursive: true });

const pages = ['index.html', 'staff.html', 'onboarding.html', 'sign-in.html', 'create-account.html', 'forgot-password.html', 'reset-password.html', 'verify-email.html', 'privacy.html', 'terms.html'];
for (const page of pages) {
  const src = join(root, 'public', page);
  if (!existsSync(src)) {
    console.error(`[build] missing public/${page}`);
    process.exit(1);
  }
  copyFileSync(src, join(distPublic, page));
  console.log(`[build] public/${page} -> dist/public/${page}`);
}
