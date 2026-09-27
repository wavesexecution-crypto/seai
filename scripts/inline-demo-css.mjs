// SEAI — inline public/demo.css into the six static demo pages.
//
// Why: the demos' entire visual system hung on a single external
// render-blocking request (/demo.css). Any stall or failure of that one
// request painted the page as raw unstyled HTML (FOUC). Inlining makes
// styled first paint structurally guaranteed — no extra request needed.
// public/demo.css remains the single source of truth; re-run this script
// after editing it:  npm run sync:demo-css
//
// Zero dependencies. Idempotent.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = resolve(root, "public/demo.css");
const demos = ["restaurant", "gym", "salon", "cafe", "clinic", "real-estate", "business"].map(
  (s) => resolve(root, `examples/${s}.html`)
);

const START = "<!--DEMO-CSS:START-->";
const END = "<!--DEMO-CSS:END-->";
const LINK = '<link rel="stylesheet" href="/demo.css" />';

const css = readFileSync(cssPath, "utf8");
if (css.includes("</style>")) throw new Error("demo.css contains </style> — cannot inline safely");

/* ---------------------------------------------------------------------------
   Corruption guard.
   public/demo.css was once overwritten with a multi-kilobyte xxd/hex dump of a
   binary blob, and this script faithfully inlined that garbage into all six
   pages. The browser silently skipped the invalid tokens, so the demos rendered
   under-styled instead of visibly broken and nobody caught it. Refuse to
   propagate anything that is not plausibly CSS.
   --------------------------------------------------------------------------- */
function assertLooksLikeCss(text, label) {
  const problems = [];

  // 1. hex-dump lines: long runs of bare byte pairs, e.g. "47 42 32 61 61 ..."
  const hexLine = /^[ \t]*(?:[0-9a-f]{2}[ \t]+){24,}\S/m.exec(text);
  if (hexLine) {
    problems.push(
      `hex-dump line at offset ${hexLine.index} — a binary dump was written into the CSS`
    );
  }

  // 2. NUL bytes or other control characters that never appear in real CSS
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    problems.push("control characters (possible NUL/binary content) present");
  }

  // 3. braces must balance
  const open = (text.match(/{/g) || []).length;
  const close = (text.match(/}/g) || []).length;
  if (open !== close) problems.push(`unbalanced braces: ${open} '{' vs ${close} '}'`);

  // 4. a stylesheet with no rules at all is not a stylesheet
  if (open < 20) problems.push(`suspiciously few rules (${open} blocks) — is this the right file?`);

  if (problems.length) {
    console.error(`\n  ✗ ${label} failed validation:\n`);
    for (const p of problems) console.error(`      • ${p}`);
    console.error(`\n  Refusing to inline corrupt CSS into ${demos.length} pages.\n`);
    process.exit(1);
  }
}

assertLooksLikeCss(css, "public/demo.css");

const block = `${START}\n<style>/* SEAI demo styles — inlined from public/demo.css. Do not edit here; edit public/demo.css and run: npm run sync:demo-css */\n${css}\n</style>\n${END}`;

let changed = 0;
let stripped = 0;
for (const file of demos) {
  // A UTF-8 BOM survives a utf8 read as U+FEFF, so a page that picked one up
  // from a PowerShell edit keeps it forever. Drop it here so the page always
  // starts with the doctype.
  let html = readFileSync(file, "utf8");
  let dirty = false;
  if (html.charCodeAt(0) === 0xfeff) {
    html = html.slice(1);
    dirty = true;
    console.log(`stripped UTF-8 BOM -> ${file}`);
  }
  let next;
  if (html.includes(START) && html.includes(END)) {
    next = html.replace(new RegExp(`${START}[\\s\\S]*?${END}`, ""), () => block);
  } else if (html.includes(LINK)) {
    next = html.replace(LINK, () => block);
  } else {
    throw new Error(`no demo.css link or markers found in ${file} — refusing to guess`);
  }
  if (next !== html || dirty) {
    writeFileSync(file, next);
    changed++;
    if (next === html) console.log(`removed UTF-8 BOM -> ${file}`);
    else console.log(`inlined demo.css -> ${file}`);
  } else {
    console.log(`unchanged (already in sync): ${file}`);
  }
}

// Post-condition: the inlined block in every page must be byte-identical to source.
const tail = css.slice(-64);
for (const file of demos) {
  const html = readFileSync(file, "utf8");
  if (!html.includes(tail)) {
    throw new Error(`post-check failed: ${file} does not contain the tail of demo.css`);
  }
  if (/(?:^|\n)\s*(?:[0-9a-f]{2}\s+){24,}/.test(html)) {
    throw new Error(`post-check failed: hex-dump still present in ${file}`);
  }
}
console.log(`done. ${changed}/${demos.length} files updated. all pages verified clean.`);
