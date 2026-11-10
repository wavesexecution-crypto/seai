// Smart build script: detects which Vercel project is building
// and runs the appropriate build command.
import { execSync } from 'child_process';

const projectId = process.env.VERCEL_PROJECT_ID || '';
const projectName = process.env.VERCEL_PROJECT_NAME || '';

console.log(`[build] VERCEL_PROJECT_ID=${projectId} VERCEL_PROJECT_NAME=${projectName}`);

if (projectName === 'seai.public' || projectId === 'prj_mmNhoyv3d3SIxifxaeWkGSRkFLiw') {
  console.log('[build] Public site project detected → vite build');
  execSync('npx vite build && node scripts/inline-page-css.mjs', { stdio: 'inherit' });
} else {
  console.log('[build] Dashboard project detected → tsc type-check + emit + copy-static');
  // Type-check first (noEmit), then emit compiled server JS to dist/
  execSync('npx tsc -p tsconfig.json --noEmit', { stdio: 'inherit' });
  execSync('npx tsc -p tsconfig.server.json', { stdio: 'inherit' });
  execSync('node scripts/copy-static.cjs', { stdio: 'inherit' });
}
