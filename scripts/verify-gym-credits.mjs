// Verify the reconstructed gym Pexels ids against the API's own alt text and
// dimensions before trusting them for the credits manifest. Read-only.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const env = readFileSync(resolve(root, ".env"), "utf8");
const key = (env.match(/^PEXELS_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!key) { console.error("no PEXELS_API_KEY in .env"); process.exit(1); }

const EXPECT = [
  [1552103, "hero", "deadlift", "hero-deadlift.jpg", "deadlift|barbell|weight|lift"],
  [1552249, "program-1", "strength", "program-1-strength.jpg", "gym|dumbbell|weight|strength|barbell"],
  [29825226, "program-2", "dumbbell", "program-2-dumbbell.jpg", "dumbbell|gym|weight"],
  [13018401, "program-4", "barbell", "program-4-barbell.jpg", "barbell|gym|weight|deadlift"],
  [5327534, "coach-1", "coach-arjun", "coach-1-coach-arjun.jpg", "trainer|coach|man|portrait|fitness"],
  [3837439, "coach-2", "coach-meera", "coach-2-coach-meera.jpg", "trainer|coach|woman|portrait|fitness"],
  [14524650, "coach-3", "coach-kabir", "coach-3-coach-kabir.jpg", "trainer|coach|man|portrait|fitness"],
  [4234912, "wide", "cable", "wide-cable.jpg", "cable|gym|pulley|lat"],
  [9545911, "wide", "kettlebell-floor", "wide-kettlebell-floor.jpg", "kettlebell|weight|floor"],
  [8611295, "wide", "kettlebells", "wide-kettlebells.jpg", "kettlebell|weight"],
  [19025670, "wide", "plates", "wide-plates.jpg", "weight|plate|dumbbell|gym"],
  [19025674, "wide", "dumbbell-rack", "wide-dumbbell-rack.jpg", "dumbbell|rack|weight|gym"],
];

let bad = 0;
for (const [id, slot, name, file, hint] of EXPECT) {
  try {
    const r = await fetch(`https://api.pexels.com/v1/photos/${id}`, {
      headers: { Authorization: key },
    });
    if (!r.ok) { console.log(`✗ ${String(id).padEnd(9)} HTTP ${r.status}`); bad++; continue; }
    const m = await r.json();
    const alt = (m.alt || "").toLowerCase();
    const match = new RegExp(hint).test(alt);
    if (!match) bad++;
    console.log(
      `${match ? "ok" : "??"} ${String(id).padEnd(9)} ${file.padEnd(26)} ` +
      `${String(m.width).padStart(5)}x${String(m.height).padEnd(5)} ` +
      `${(m.photographer || "?").slice(0, 22).padEnd(22)} | ${(m.alt || "").slice(0, 70)}`
    );
  } catch (e) {
    console.log(`✗ ${id} ${e.message}`);
    bad++;
  }
  await new Promise((r) => setTimeout(r, 150));
}
console.log(`\n${bad} id(s) need a second look.`);
