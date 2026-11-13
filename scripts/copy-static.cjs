// Copies the entire public/ directory into dist/public/ so the serverless
// bundle is fully self-contained (CSS, JS, images, HTML pages). Vercel serves
// dist/public as the output directory; without this, auth pages load as
// unstyled HTML because auth.css/auth.js/logo.svg never reach the bundle.
const { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const srcPublic = join(root, 'public');
const distPublic = join(root, 'dist', 'public');
mkdirSync(distPublic, { recursive: true });

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dest, name);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

if (!existsSync(srcPublic)) {
  console.error('[build] missing public/ directory');
  process.exit(1);
}
copyDir(srcPublic, distPublic);
console.log('[build] copied public/ -> dist/public/');
