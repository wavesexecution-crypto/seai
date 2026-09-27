// Move the fixed "Back to SEAI" pill into the header flow so it stops
// overlapping the brand lockup, and make the SEAI mark legible on dark themes.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const slugs = ["gym", "restaurant", "salon", "clinic", "real-estate", "business"];

for (const slug of slugs) {
  const f = resolve(root, `examples/${slug}.html`);
  let h = readFileSync(f, "utf8");
  const before = h;

  // lift the <a class="demo-back">…</a> out of body flow
  const m = h.match(/[ \t]*<a class="demo-back"[\s\S]*?<\/a>\r?\n?/);
  if (m) {
    const link = m[0].trim();
    h = h.replace(m[0], "");
    // re-insert as the first child of the header container
    h = h.replace(/(<div class="container demo-container">)/, `$1\n    ${link}`);
  }

  if (h !== before) {
    writeFileSync(f, h);
    console.log(`moved back-link into header: ${slug}`);
  } else {
    console.log(`unchanged: ${slug}`);
  }
}
