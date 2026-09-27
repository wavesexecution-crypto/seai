// SEAI — inline page CSS into the static vanilla pages (post-build step).
//
// Why: intake.html, terms.html, privacy.html and 404.html are fully static
// HTML whose only styling came from an external render-blocking bundle.
// Any stall or failure of that one request painted raw unstyled HTML.
// Inlining the built CSS into each page makes styled first paint
// structurally guaranteed — the page carries its own critical styling.
// (The React homepage is unaffected: its content only exists after its JS
// mounts, so it cannot flash unstyled HTML; demo pages already inline
// their CSS via `npm run sync:demo-css`.)
//
// Runs automatically via `npm run build`. Zero dependencies. Only touches
// dist/ (source HTML and the dev workflow are unchanged). Replaces every
// local /assets/*.css link; external links (Google Fonts) are left alone.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const pages = ["intake.html", "terms.html", "privacy.html", "404.html"];
const linkRe = /<link rel="stylesheet" crossorigin href="(\/assets\/[^"]+\.css)">/g;

let ok = true;
for (const name of pages) {
  const file = resolve(dist, name);
  if (!existsSync(file)) {
    console.error(`inline-page-css: missing ${file} — skipping`);
    ok = false;
    continue;
  }
  let html = readFileSync(file, "utf8");
  const hrefs = [...html.matchAll(linkRe)].map((m) => m[1]);
  if (!hrefs.length) {
    console.log(`inline-page-css: no local css links in ${name} — skipping`);
    continue;
  }
  for (const href of hrefs) {
    const cssFile = resolve(dist, href.replace(/^\//, ""));
    if (!existsSync(cssFile)) {
      console.error(`inline-page-css: missing ${cssFile} referenced by ${name}`);
      ok = false;
      continue;
    }
    const css = readFileSync(cssFile, "utf8");
    if (css.includes("</style>")) throw new Error(`unsafe to inline: ${cssFile} contains </style>`);
    html = html.replace(
      `<link rel="stylesheet" crossorigin href="${href}">`,
      () => `<style>/* SEAI page styles — inlined post-build from ${href}. Source: src/css/*.css via main.js/main.tsx imports. */\n${css}\n</style>`
    );
    console.log(`inline-page-css: inlined ${href} (${css.length} chars) -> dist/${name}`);
  }
  writeFileSync(file, html);
}
if (!ok) process.exit(1);
console.log("inline-page-css: done.");
