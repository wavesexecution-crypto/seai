// Fetch the Google Fonts CSS with a modern UA (to get woff2 + unicode-range),
// then download the latin subset files so the demos stop depending on a
// third-party request and can be preloaded precisely.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const FAMILIES = [
  { q: "Instrument+Serif:ital,wght@0,400;1,400", want: ["latin"] },
  { q: "Inter:wght@400..700", want: ["latin"] },
  { q: "JetBrains+Mono:wght@400..600", want: ["latin"] },
];

const OUT = resolve(process.cwd(), "public/fonts");
mkdirSync(OUT, { recursive: true });

const faces = [];
let n = 0;

for (const fam of FAMILIES) {
  const url = `https://fonts.googleapis.com/css2?family=${fam.q}&display=swap`;
  const css = await (await fetch(url, { headers: { "User-Agent": UA } })).text();

  // Google's CSS emits one @font-face per subset, each preceded by a
  // /* latin */ style comment.
  const blocks = css.split("/*").slice(1);
  for (const b of blocks) {
    const subset = b.slice(0, b.indexOf("*/")).trim();
    if (!fam.want.includes(subset)) continue;
    const body = b.slice(b.indexOf("*/") + 2);
    const src = /src:\s*url\((https:[^)]+)\)/.exec(body);
    const range = /unicode-range:\s*([^;]+);/.exec(body);
    const weight = /font-weight:\s*([^;]+);/.exec(body);
    const style = /font-style:\s*([^;]+);/.exec(body);
    const family = /font-family:\s*'([^']+)'/.exec(body);
    if (!src || !family) continue;

    const file = `${family[1].toLowerCase().replace(/\s+/g, "-")}-${subset}-${style ? style[1].trim() : "normal"}.woff2`;
    const bin = Buffer.from(await (await fetch(src[1], { headers: { "User-Agent": UA } })).arrayBuffer());
    writeFileSync(resolve(OUT, file), bin);
    n++;
    console.log(`${file.padEnd(38)} ${String(Math.round(bin.length / 1024)).padStart(4)} KB`);

    faces.push(
      `@font-face {\n` +
      `  font-family: "${family[1]}";\n` +
      `  font-style: ${style ? style[1].trim() : "normal"};\n` +
      `  font-weight: ${weight ? weight[1].trim() : "400"};\n` +
      `  font-display: swap;\n` +
      `  src: url("/fonts/${file}") format("woff2");\n` +
      (range ? `  unicode-range: ${range[1].trim()};\n` : "") +
      `}`
    );
  }
}

writeFileSync(resolve(OUT, "fonts.css"), faces.join("\n\n") + "\n");
console.log(`\n${n} woff2 file(s) + public/fonts/fonts.css`);
