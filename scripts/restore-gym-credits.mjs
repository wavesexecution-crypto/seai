// Restore the gym entries in the selection file, then merge gym credits into
// CREDITS.json WITHOUT re-downloading: finalize() rm -rf's each folder first,
// which would risk swapping an already-audited photo for a different one.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const env = readFileSync(resolve(root, ".env"), "utf8");
const key = (env.match(/^PEXELS_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!key) { console.error("no PEXELS_API_KEY in .env"); process.exit(1); }

const GYM = [
  { id: 1552103,  slot: "hero",     name: "deadlift" },
  { id: 1552249,  slot: "program-1", name: "strength" },
  { id: 29825226, slot: "program-2", name: "curl" },
  { id: 13018401, slot: "program-4", name: "barbell" },
  { id: 5327534,  slot: "coach-1",  name: "coach-arjun" },
  { id: 3837439,  slot: "coach-2",  name: "coach-vikram" },
  { id: 14524650, slot: "coach-3",  name: "coach-rhea" },
  { id: 4234912,  slot: "wide",     name: "row" },
  { id: 9545911,  slot: "wide",     name: "kettlebell-floor" },
  { id: 8611295,  slot: "wide",     name: "kettlebells" },
  { id: 19025670, slot: "wide",     name: "plates" },
  { id: 19025674, slot: "wide",     name: "dumbbell-rack" },
];

// 1. selection file — put gym back so future finalize runs stay complete
const selPath = resolve(root, "scripts/demo-image-selection.json");
const sel = JSON.parse(readFileSync(selPath, "utf8"));
const { _comment, ...rest } = sel;
const merged = { _comment: _comment, gym: GYM, ...rest };
writeFileSync(selPath, JSON.stringify(merged, null, 1) + "\n");
console.log(`selection file: gym restored (${GYM.length} slots), demos = ` +
  Object.keys(merged).filter((k) => k !== "_comment").join(", "));

// 2. credits — merge gym metadata in, replacing any previous gym rows
const credPath = resolve(root, "public/assets/demos/CREDITS.json");
const cred = JSON.parse(readFileSync(credPath, "utf8"));
const others = cred.images.filter((i) => i.demo !== "gym");

const gymCredits = [];
for (const pick of GYM) {
  const r = await fetch(`https://api.pexels.com/v1/photos/${pick.id}`, {
    headers: { Authorization: key },
  });
  if (!r.ok) { console.error(`  ✗ ${pick.id} HTTP ${r.status}`); continue; }
  const m = await r.json();
  gymCredits.push({
    demo: "gym",
    file: `/assets/demos/gym/${pick.slot}-${pick.name}.jpg`,
    pexels_id: pick.id,
    slot: pick.slot,
    name: pick.name,
    photographer: m.photographer,
    photographer_url: m.photographer_url,
    source_page: `https://www.pexels.com/photo/${m.id}/`,
    license: "Pexels License — free for commercial use, no attribution required",
    rendition:
      pick.slot === "hero" || pick.slot === "wide" ? "large2x" : "large",
    width: m.width,
    height: m.height,
  });
  await new Promise((r) => setTimeout(r, 150));
}

cred.images = [...gymCredits, ...others];
writeFileSync(credPath, JSON.stringify(cred, null, 1) + "\n");

const byDemo = {};
for (const i of cred.images) byDemo[i.demo] = (byDemo[i.demo] || 0) + 1;
console.log(`CREDITS.json: ${cred.images.length} images ->`,
  Object.entries(byDemo).map(([k, v]) => `${k}=${v}`).join(" "));
