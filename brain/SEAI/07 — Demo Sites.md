---
title: SEAI — Demo Sites
updated: 2026-09-27T00:00:00.000Z
type: content
scope: seai
status: IN PROGRESS
provenance: code-verified 2026-09-27
---

# SEAI — Demo Sites

Seven static demo pages that are the project's main sales asset. They live in
`D:\seai.public\examples\`, are linked from the homepage examples carousel, and each
deep-links into `/intake.html`.

| File | Archetype | Homepage link | Entry in `scripts/demo-image-selection.json` |
|---|---|---|---|
| `gym.html` | SEAI Gym | `/examples/gym.html` | ✅ `gym` |
| `restaurant.html` | SEAI Restaurant | ✅ | ✅ |
| `salon.html` | SEAI Salon | ✅ | ✅ |
| `clinic.html` | SEAI Clinic | ✅ | ❌ **missing** |
| `real-estate.html` | SEAI Real Estate | ✅ | ✅ |
| `business.html` | SEAI Business | ✅ (`business`) | ✅ |
| `cafe.html` | SEAI Café | ✅ (`cafe`) | ✅ |

The homepage also maps extra personas onto existing demos rather than having their own
pages: `Consultants` and `Agencies` both point at `/examples/business.html`
(`Homepage.tsx:59-60`).

## Rules the demos must obey

- Use the **original SEAI logo**. No third-party brand marks, no borrowed client logos.
- Imagery must be realistic and legally safe — licensed, generated, or clearly
  placeholder. **No fabricated achievements, testimonials, awards, or statistics.**
- Six named industries: Gym, Restaurant, Salon, Clinic, Real Estate, Business.
- Demos are **demonstrations, not customers** and must never imply a real client
  relationship.
- The carousel frame is meant to be one thin black 1px sharp-cornered edge. That
  decision is currently **not implemented** — see [[06 — Public Site]].

## Demo content currently in the files

The pages contain real, plausible, business-appropriate pricing in rupees — menu items
and prices for `cafe.html` and `restaurant.html`, membership tiers for `gym.html`
(₹4,500 / ₹7,500 / ₹12,000), and a service price list for `salon.html`. These are
demo business content, which is appropriate and is the opposite of the failure mode to
avoid. `[VERIFY]` that no demo page asserts a real-named client, a verifiable award, or
a testimonial attributed to a real person — that is the line the project must not cross.

## The image manifest — clinic is the gap

`scripts/demo-image-selection.json` maps each business type to a set of image slots. Its
top-level keys are `_comment`, `gym` (12 slots), `restaurant` (14), `salon` (10),
`real-estate` (8), `business` (13), and `cafe` (12) — and **`clinic` appears zero times
in the file.**

### 🔴 The clinic demo is entirely imageless

This is worse than "the manifest is missing an entry". Measured directly:

| Demo | `<img>` tags in page | Committed images on disk | Manifest slots |
|---|---|---|---|
| `gym.html` | 14 | 12 | 12 |
| `restaurant.html` | — | 12 | 14 |
| `cafe.html` | — | 12 | 12 |
| `salon.html` | — | 9 | 10 |
| `business.html` | — | 10 | 13 |
| `real-estate.html` | — | 7 | 8 |
| **`clinic.html`** | **1 — and it is `/logo.svg`** | **no directory** | **none** |

- `clinic.html` is a complete 83 KB page (comparable to `cafe.html` at 94 KB) with
  **not a single content image**. Its only `<img>` is the logo.
- `public/assets/demos/` contains `business`, `cafe`, `gym`, `real-estate`,
  `restaurant`, `salon` — **no `clinic` directory exists at all.**
- `clinic.html` contains **zero** references to `/assets/demos/…`.
- `public/assets/demos/CREDITS.json` credits images for the other six demos; there is
  nothing to credit for clinic.

So the pipeline is not merely incomplete for this archetype — the page was authored
without photography and the tooling was never extended to supply any. Meanwhile
`clinic.html` **is** linked from the homepage carousel (`Homepage.tsx:17` is cafe, and
`BUSINESS_TYPES` maps both `Clinics` and `Local Services` to `/examples/clinic.html`), so
a visitor can reach an imageless demo from the main marketing surface.

Fix: add a `clinic` key to the manifest with the same shape as the other six (each entry
carries `id`, `slot`, `name`), add clinic image slots to `clinic.html` following the
`gym.html` pattern (`<img src="/assets/demos/clinic/…" width height loading alt>`), then
re-run `fetch:demo-images` and `optimize:demo-images`. Note the other demos are not fully
matched either — `restaurant` declares 14 slots against 12 committed files, `business`
13 against 10, `real-estate` 8 against 7, `salon` 10 against 9. `[VERIFY]` whether the
unmatched slots were fetched and skipped, or never fetched.

## Asset toolchain

Three scripts, all wired to `package.json`:

- `sync:demo-css` → `scripts/inline-demo-css.mjs` — inlines demo CSS so demo pages do
  not depend on an external stylesheet (the FOUC mitigation). Its demo list
  (`inline-demo-css.mjs:18`) includes all seven, so clinic **is** covered here.
- `fetch:demo-images` → `scripts/fetch-demo-images.mjs` — pulls slot images according to
  the manifest. Its per-demo query map (`fetch-demo-images.mjs:83` and following) must
  also gain a `clinic` entry.
- `optimize:demo-images` → `scripts/optimize-demo-images.py` — **Python**, an
  inconsistency in an otherwise Node/Vite project. `[VERIFY]` whether that tool actually
  runs in CI or on any developer machine, or is a manual one-off.

The manifest inventory is **10 scripts**, not 9 — `demo-image-selection.json` is
easy to overlook because it is data, not code.

## Carousel behaviour

The carousel is a GSAP-driven fan of cards; positions come from
`card-fan-carousel.tsx` while `fan-carousel.css` supplies stage height, base footprint and
the minimal index face (a mark plus a name, nothing else). Cards are absolutely
positioned with `aspect-ratio: 3/4`, `max-width: 62vw`, and
`will-change: transform, opacity`.

`[VERIFY]` The known carousel behaviours called out as acceptance items — return-to-`
previous` position after interaction, mobile layout, and touch handling — are not
verifiable by reading CSS alone and need a real browser pass. `playwright-core` is
already a devDependency, so a scripted check is feasible and has simply not been written.

## Related

- [[06 — Public Site]] · [[11 — Security]] · [[13 — Launch Checklist]] ·
  [[14 — Decisions Log]] · [[15 — Known Issues]]
