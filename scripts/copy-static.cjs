// Copies the SPA shell into dist/ so the serverless bundle is self-contained.
// Vercel serves all other public/* assets from outputDirectory; the function
// only needs index.html for SPA-route sendFile. Plain node, no dependencies.
const { copyFileSync, mkdirSync, existsSync } = require('node:fs');
const { join, dirname } = require('node:path');

const root = join(__dirname, '..');
mkdirSync(join(root, 'dist', 'public'), { recursive: true });
const src = join(root, 'public', 'index.html');
if (!existsSync(src)) {
  console.error('[build] missing public/index.html');
  process.exit(1);
}
copyFileSync(src, join(root, 'dist', 'public', 'index.html'));
console.log('[build] public/index.html -> dist/public/index.html');
