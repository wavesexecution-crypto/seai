// Interim branding + theming pass.
//
// Phase 1 (CSS corruption) is complete; this is the smallest change that makes
// the new design system actually observable and satisfies the brand rule:
//   * <body> carries a per-demo class so the art direction in demo.css engages
//   * the fabricated placeholder marks (IF / R / L / MH / HK / A) are replaced
//     with the real SEAI logo already used on seai.store
//   * names become "SEAI <Business>"
//
// The full markup rebuild (Phase 3) supersedes this; it is a stopgap so the
// showroom is not shipping with invented logos and dead theming.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const MAP = {
  gym: { cls: "demo-gym", name: "SEAI Gym" },
  restaurant: { cls: "demo-restaurant", name: "SEAI Restaurant" },
  salon: { cls: "demo-salon", name: "SEAI Salon" },
  clinic: { cls: "demo-clinic", name: "SEAI Clinic" },
  "real-estate": { cls: "demo-realestate", name: "SEAI Real Estate" },
  business: { cls: "demo-business", name: "SEAI Business" },
};

for (const [slug, cfg] of Object.entries(MAP)) {
  const f = resolve(root, `examples/${slug}.html`);
  let h = readFileSync(f, "utf8");
  const before = h;

  // 1. body class
  h = h.replace(/<body(\s[^>]*)?>/, (m, attrs = "") =>
    `<body${attrs.replace(/\s*class="[^"]*"/, "")} class="${cfg.cls}">`);

  // 2. real SEAI logo + correct name in the header brand
  h = h.replace(
    /<span class="demo-logo"[^>]*>[\s\S]*?<\/span>/,
    `<img class="demo-logo" src="/logo.svg" width="30" height="30" alt="" />`
  );
  h = h.replace(
    /<span class="demo-name">[^<]*<\/span>/,
    `<span class="demo-name">${cfg.name}</span>`
  );
  h = h.replace(/aria-label="[^"]*-- Home"/, `aria-label="${cfg.name} — home"`);

  if (h !== before) {
    writeFileSync(f, h);
    console.log(`branded ${slug}: body.${cfg.cls}, logo=/logo.svg, name="${cfg.name}"`);
  } else {
    console.log(`unchanged ${slug}`);
  }
}
