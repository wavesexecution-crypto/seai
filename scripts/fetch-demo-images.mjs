// SEAI — self-hosted demo photography pipeline (Pexels).
//
//   node scripts/fetch-demo-images.mjs --candidates
//       Search Pexels per business, cache medium thumbs + build contact sheets
//       so the selection can be made by eye.
//
//   node scripts/fetch-demo-images.mjs --finalize
//       Read the curated selection, download the correct Pexels `src` variant
//       for each slot, write them into public/assets/demos/<slug>/, and emit
//       an attribution manifest.
//
// Why `src` variants instead of local resizing: Pexels already generates
// per-slot renditions (original / large2x / large / medium / portrait /
// landscape) with auto=compress. Pulling the right one gives art-directed
// crops at the right aspect AND optimal bytes with no re-encode, no extra
// dependency and no quality loss.
//
// Key handling: read from PEXELS_API_KEY in the environment, or from a local
// untracked .env. The key is never written to disk, never inlined into the
// build, and never emitted into the demos. .env is gitignored.

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = resolve(root, ".imgcache");
const OUT = resolve(root, "public/assets/demos");

/* ------------------------------------------------------------------- key -- */
function loadKey() {
  const fromEnv = process.env.PEXELS_API_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const envPath = resolve(root, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^\s*PEXELS_API_KEY\s*=\s*(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  console.error(
    "\n  ✗ PEXELS_API_KEY not found.\n" +
      "    Set it in one of these ways (do NOT paste it into chat):\n" +
      "      • create .env in the project root:  PEXELS_API_KEY=<your key>\n" +
      "      • or set a shell env var:           $env:PEXELS_API_KEY = '<your key>'\n" +
      "    Get a free key at https://www.pexels.com/api/\n" +
      "    .env is gitignored; see .env.example.\n"
  );
  process.exit(1);
}

/* --------------------------------------------------------------- queries -- */
// Art direction per business. Kept here so the pipeline is reproducible and
// the intent behind every pull is auditable.
const BUSINESS = {
  gym: {
    name: "SEAI Gym",
    // cinematic / athletic / precise
    queries: [
      "man barbell deadlift gym", "woman lifting weights gym", "gym interior weights",
      "athlete training squat", "kettlebell workout", "gym equipment rack",
      "boxer training gym", "woman yoga studio", "treadmill running gym",
      "personal trainer coaching", "gym mirror reflection", "athlete resting gym",
    ],
  },
  restaurant: {
    name: "SEAI Restaurant",
    queries: [
      "plated gourmet dish fine dining", "restaurant interior evening",
      "chef plating kitchen", "table setting restaurant", "wine glasses dining",
      "pasta dish close up", "restaurant bar counter", "fresh ingredients kitchen",
      "dessert plated restaurant", "private dining room", "chef portrait kitchen",
      "bread pastry display",
    ],
  },
  salon: {
    name: "SEAI Salon",
    queries: [
      "hair salon interior", "hairdresser styling hair", "hair colour salon",
      "scissors cutting hair close up", "hair styling product", "beauty portrait woman",
      "barber shop interior", "spa treatment room", "manicure salon", "blow dry hair",
      "salon shampoo basin", "makeup artist portrait",
    ],
  },
  cafe: {
    name: "SEAI Cafe",
    // daylight, craft, third-wave. Avoid "latte art" and smiling baristas —
    // both skew to generic stock.
    queries: [
      "coffee shop interior daylight", "cafe counter espresso machine",
      "pour over coffee brewing", "coffee cup on wooden table",
      "bakery pastry display case", "cafe seating window light",
      "barista grinding coffee beans", "croissant and coffee breakfast",
      "cafe exterior storefront", "latte art cup overhead",
      "coffee beans burlap sack", "cafe interior plants",
    ],
  },
  clinic: {
    name: "SEAI Clinic",
    queries: [
      "doctor portrait white coat", "modern clinic interior", "dentist office",
      "hospital corridor modern", "physician consulting patient", "laboratory microscope",
      "medical team hospital", "reception desk clinic", "nurse patient care",
      "dental chair clinic", "pharmacy shelves", "waiting room clinic",
    ],
  },
  "real-estate": {
    name: "SEAI Real Estate",
    queries: [
      "modern house exterior architecture", "luxury living room interior",
      "apartment building facade", "contemporary architecture detail",
      "penthouse apartment interior", "minimalist kitchen interior",
      "staircase architecture modern", "bedroom interior design", "urban skyline building",
      "house garden exterior", "office lobby interior", "concrete facade detail",
    ],
  },
  business: {
    name: "SEAI Business",
    queries: [
      "modern office interior", "business meeting boardroom", "consultant working desk",
      "corporate lobby architecture", "professional team portrait", "law office interior",
      "workspace minimal desk", "handshake business", "presentation office",
      "co working space", "business woman portrait", "server room technology",
    ],
  },
};

/* ------------------------------------------------------------------ api --- */
async function api(path, key) {
  const res = await fetch(`https://api.pexels.com/v1${path}`, {
    headers: { Authorization: key, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pexels ${res.status} ${res.statusText} ${body.slice(0, 160)}`);
  }
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------- candidates mode -- */
async function candidates(key, only) {
  mkdirSync(CACHE, { recursive: true });
  const manifest = {};

  // Only sweep the requested demo, and do not wipe the cache: the thumbnails
  // for the other demos are the record of what was already reviewed.
  const sweeps = Object.entries(BUSINESS).filter(([slug]) => !only || slug === only);
  for (const f of readdirSync(CACHE)) {
    if (f === "candidates.json") continue;
    const prefix = f.split("-")[0];
    if (sweeps.some(([slug]) => slug === prefix)) rmSync(resolve(CACHE, f), { force: true });
  }

  for (const [slug, cfg] of sweeps) {
    console.log(`\n=== ${cfg.name} (${slug}) ===`);
    const seen = new Map();
    for (const q of cfg.queries) {
      try {
        const j = await api(
          `/search?query=${encodeURIComponent(q)}&per_page=12&orientation=${q.includes("portrait") ? "portrait" : "landscape"}`,
          key
        );
        for (const p of j.photos || []) {
          if (seen.has(p.id)) continue;
          if (p.width < 1400) continue;               // editorial needs resolution
          seen.set(p.id, {
            id: p.id, q, alt: p.alt || "", photographer: p.photographer,
            photographer_url: p.photographer_url, pexels_url: p.url,
            w: p.width, h: p.height, src: p.src,
          });
        }
        process.stdout.write(`  ${q} -> ${(j.photos || []).length}\n`);
      } catch (e) {
        console.error(`  ! ${q}: ${e.message}`);
      }
      await sleep(220);
    }
    const list = [...seen.values()];
    manifest[slug] = list;
    console.log(`  => ${list.length} unique candidates`);

    // cache a medium thumb per candidate for contact-sheet review
    let n = 0;
    for (const p of list) {
      const f = resolve(CACHE, `${slug}-${p.id}.jpg`);
      try {
        const r = await fetch(p.src.medium, { headers: { Authorization: key } });
        if (!r.ok) continue;
        writeFileSync(f, Buffer.from(await r.arrayBuffer()));
        n++;
      } catch { /* skip */ }
    }
    console.log(`  cached ${n} thumbs in .imgcache/`);
  }

  // Merge: sweeping one demo must not drop the other demos' review records.
  const manifestPath = resolve(CACHE, "candidates.json");
  const keptManifest = {};
  if (existsSync(manifestPath)) {
    try {
      const prev = JSON.parse(readFileSync(manifestPath, "utf8"));
      for (const [k, v] of Object.entries(prev)) {
        if (!sweeps.some(([slug]) => slug === k)) keptManifest[k] = v;
      }
    } catch {
      /* corrupt manifest — start fresh */
    }
  }
  Object.assign(keptManifest, manifest);
  writeFileSync(manifestPath, JSON.stringify(keptManifest, null, 1));
  console.log(`\nCandidates written to ${CACHE}. Review the contact sheets, then edit
  scripts/demo-image-selection.json and run --finalize.`);
}

/* --------------------------------------------------------- finalize mode -- */
async function finalize(only) {
  const selPath = resolve(root, "scripts/demo-image-selection.json");
  if (!existsSync(selPath)) {
    console.error(`\n  ✗ Missing ${selPath}\n    Create it with the chosen photo ids per slot.`);
    process.exit(1);
  }
  const selection = JSON.parse(readFileSync(selPath, "utf8"));
  const credits = [];
  const targets = Object.entries(BUSINESS).filter(([slug]) => !only || slug === only);
  if (!targets.length) {
    console.error(`\n  ✗ No demo named "${only}". Known: ${Object.keys(BUSINESS).join(", ")}`);
    process.exit(1);
  }

  for (const [slug, cfg] of targets) {
    const picks = selection[slug];
    if (!picks || !picks.length) {
      console.error(`  ! no selection for ${slug} — skipping`);
      continue;
    }
    const dir = resolve(OUT, slug);
    mkdirSync(dir, { recursive: true });
    // NB: do not rm -rf the folder up front. A failed or partial run would
    // destroy already-audited, already-referenced images. Stale files are pruned
    // at the end, once every new file has landed.
    const expected = new Set();
    console.log(`\n=== ${cfg.name} -> public/assets/demos/${slug}/ ===`);

    for (const pick of picks) {
      // slot -> Pexels rendition. hero/wide want max resolution (they render
      // full-bleed or span the grid); cards use `large`.
      const variant =
        pick.slot === "hero" || pick.slot === "wide" ? "large2x" : "large";
      const file = `${pick.slot}-${pick.name}.jpg`;
      const dest = resolve(dir, file);
      expected.add(file);
      let done = false;
      // Renditions in preference order. `original` is a last resort and is
      // refused for very large source files — a 2.9 MB hero is worse than a
      // slightly softer 300 KB one.
      const order = [variant, "large", "original"];
      for (const v of order) {
        if (v === "original") {
          // only if the source itself is modest
        }
        try {
          const meta = await api(`/photos/${pick.id}`, key);
          if (v === "original" && (meta.width || 0) > 2600) break;
          const src = meta.src?.[v];
          if (!src) continue;
          const r = await fetch(src, { headers: { Authorization: key } });
          if (!r.ok) continue;
          writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
          credits.push({
            demo: slug, file: `/assets/demos/${slug}/${file}`,
            pexels_id: pick.id, slot: pick.slot, name: pick.name,
            photographer: meta.photographer, photographer_url: meta.photographer_url,
            source_page: `https://www.pexels.com/photo/${meta.id}/`,
            license: "Pexels License — free for commercial use, no attribution required",
            rendition: v, width: meta.width, height: meta.height,
          });
          console.log(`  ${file.padEnd(26)} ${String(meta.width).padStart(5)}x${String(meta.height).padEnd(5)} ${v}`);
          done = true;
          break;
        } catch (e) {
          if (String(e.message).includes("Pexels 4")) break;
        }
      }
      if (!done) console.error(`  ! failed ${slug}/${file} (id ${pick.id})`);
      await sleep(160);
    }

    // Only now that every new file has landed, drop images the new selection
    // no longer references. Doing this up front risks deleting good files.
    if (readdirSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (f.endsWith(".jpg") && !expected.has(f)) {
          rmSync(resolve(dir, f), { force: true });
          console.log(`  - pruned stale ${slug}/${f}`);
        }
      }
    }
  }

  // Merge rather than replace: finalizing one demo must not erase the
  // attribution records of the others.
  const credPath = resolve(root, "public/assets/demos/CREDITS.json");
  const touched = new Set(targets.map(([slug]) => slug));
  let previous = [];
  if (existsSync(credPath)) {
    try {
      previous = JSON.parse(readFileSync(credPath, "utf8")).images || [];
    } catch {
      previous = [];
    }
  }
  const kept = previous.filter((i) => !touched.has(i.demo));

  writeFileSync(
    credPath,
    JSON.stringify(
      {
        note:
          "SEAI demo showroom imagery. All photographs sourced from Pexels and " +
          "self-hosted. Pexels License permits free commercial use and does not " +
          "require attribution; credits are recorded here for good practice.",
        generated_by: "scripts/fetch-demo-images.mjs",
        images: [...credits, ...kept],
      },
      null,
      1
    )
  );
  console.log(
    `\nWrote public/assets/demos/CREDITS.json (${credits.length} updated, ${kept.length} kept, ` +
    `${credits.length + kept.length} total).`
  );
}

/* ------------------------------------------------------------------ main -- */
const mode = process.argv.includes("--finalize") ? "finalize" : "candidates";
// `node scripts/fetch-demo-images.mjs <demo>` — the demo slug, e.g. `cafe`.
const slug = process.argv.slice(2).find((a) => !a.startsWith("--")) || null;
const key = loadKey();
console.log(
  `Pexels key loaded (${key.length} chars). mode=${mode}` +
  (slug ? ` demo=${slug}` : " demo=<all>")
);
if (mode === "finalize") await finalize(slug);
else await candidates(key, slug);
