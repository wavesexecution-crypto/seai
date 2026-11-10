---
title: SEAI — Public Site
updated: 2026-09-27T00:00:00.000Z
type: system
scope: seai
status: IN PROGRESS
provenance: code-verified 2026-09-27
---

# SEAI — Public Site (`D:\seai.public`)

The marketing site, demo showroom and lead-intake surface. Static-first, no server.

> **The single most important fact about this repo: there is no checkout.**
> A full-repo search finds **zero** references to `seai.payments`, zero Razorpay
> references, and no checkout code. The pricing is displayed and the CTA deep-links to
> the intake form, but the funnel dead-ends at a form. See [[08 — Payments]].

## Stack

`package.json` name `seai-public` v2.0.0, `"private": true`, ESM.
**Vite 6** + **React 19** + **Tailwind 3.4** + **GSAP 3.15** (`devDependencies`:
`@vitejs/plugin-react` 5.2, `postcss` 8.5, `autoprefixer`, `playwright-core` 1.63,
`typescript` 7.0.2; runtime `gsap`, `react`, `react-dom`).

Scripts: `dev` (vite), `build` (`vite build && node scripts/inline-page-css.mjs`),
`preview`, `typecheck`, plus three demo-asset scripts — `sync:demo-css`,
`fetch:demo-images`, `optimize:demo-images` (Python).

Config files: `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`,
`tsconfig.json`, `tsconfig.node.json`.

Only four React files exist: `src/main.tsx`, `src/components/homepage/Homepage.tsx`,
`src/components/ui/card-fan-carousel.tsx`, `src/components/ui/example-icons.tsx`.
Five stylesheets: `base.css`, `home.css` (25 KB), `pages.css`, `responsive.css`,
`fan-carousel.css`.

## Git state — 2026-09-27

- Branch has **2 commits only**: `fc11f0a` "SEAI public site: demo showroom, intake flow,
  and Examples carousel", then `cc5da01` "Ignore .vercel".
- **No git remote configured.** Nothing has ever been pushed. This repo is untracked by
  any host — there is no upstream, no PR history, and no deploy-from-git pipeline.
- `.vercel/` exists locally (so a `vercel` CLI link exists) but is now gitignored.
- `.env` and `.env.example` present.

> This is a launch blocker of its own kind: a production marketing site with no remote
> repository. There is no backup, no history, and no review trail. See
> [[15 — Known Issues]].

## FOUC — partially solved, still the named launch blocker

The project decision names FOUC as a launch blocker. The current state:

**Already fixed** — `scripts/inline-page-css.mjs` runs automatically on every `npm run
build`. Its header comment explains the original failure precisely: `intake.html`,
`terms.html`, `privacy.html` and `404.html` are fully static HTML whose only styling came
from an **external render-blocking bundle**, so any stall or failure of that single
request painted raw unstyled HTML. The script now inlines the built CSS into each of
those four pages in `dist/`, making styled first paint structurally guaranteed. It
replaces every local `/assets/*.css` link and touches only `dist/`, so the dev workflow
and source HTML are unchanged. Demo pages inline their CSS via `npm run sync:demo-css`.

**Still open** —
1. `index.html:26` still loads **Google Fonts** (Inter 400–700 + JetBrains Mono 400) via
   an external render-blocking `<link>`. The inliner deliberately leaves external links
   alone. So the font request is still a third-party blocking dependency on every page.
   Self-host the two families, or add `media="print" onload` swapping, or accept the
   risk explicitly.
2. The React homepage cannot flash unstyled HTML (content only exists after JS mounts),
   but that trades FOUC for a **blank-until-hydrate** experience. A JS failure or a slow
   main thread means an empty page with no fallback. `[VERIFY]` whether a static
   skeleton/pre-hydration shell is wanted.
3. `term-page`, `support.html` and the demo pages were not all enumerated in the
   inliner's `pages` array — it covers exactly `intake.html`, `terms.html`,
   `privacy.html`, `404.html`. `[VERIFY]` that `support.html` and the seven
   `examples/*.html` are covered by the demo-CSS path, not left on an external link.

## Content pages

`index.html` (React mount), `intake.html`, `privacy.html`, `terms.html`, `404.html`, and
`examples/` with seven demo pages. **No `support.html` was found in the repo root listing**
— yet `docs/APP_STORE_LISTING.md` in CDF references a support page. `[VERIFY]`

The three legal pages hardcode `https://www.seai.store` as their contact/legal domain,
contradicting the no-`www` decision. See [[03 — Domains & Infrastructure]].

## Examples carousel

`src/components/ui/card-fan-carousel.tsx` (GSAP-driven) + `src/css/fan-carousel.css`.

> **The locked carousel frame decision is not implemented anywhere.** The decision is
> *one thin black 1px sharp-cornered frame, with no red/debug outlines, glow, shadow, or
> gradient*. Reality in `fan-carousel.css:20-45`:
>
> | Property | Locked decision | Actual |
> |---|---|---|
> | Corner | sharp | `border-radius: 1.1rem` — **rounded** |
> | Border | thin **black** 1px | `1px solid rgba(10,10,11,0.09)` — **translucent grey** |
> | Shadow | **none** | `0 12px 36px rgba(10,10,11,0.08)`, rising to `0 18px 48px rgba(...,0.12)` on hover |
> | Animation | — | `transition: border-color 260ms, box-shadow 260ms` |
>
> A search of **all five** stylesheets for a solid black / `#000` / `#111` 1px border
> returns exactly **one** hit — `.btn-dark:hover { border-color: #000 }` in
> `base.css:145` — and nothing resembling a card frame. The decision has not been
> started. Recorded in [[14 — Decisions Log]].
>
> The card is also `position: absolute` with GSAP-computed transforms, `max-width: 62vw`,
> `aspect-ratio: 3/4`, and `will-change: transform, opacity` — so a redesign must respect
> the transform-driven layout rather than reintroduce flow layout.

Positive details worth preserving: the CSS documents *why* it does things, e.g. lines
21-23 explain that `--fan-w` and `--fan-scale` are set by the component from the same
multiplier so card overlap stays constant at every viewport. Focus management is
deliberate — lines 111-114 record that Tailwind's `outline-none` left keyboard users
with **no visible focus indicator at all**, and real `outline: 2px solid var(--ink)`
focus rings are restored for arrows (118-119) and dots (127-128). Do not regress that.

**Cosmetic bug:** double-encoded UTF-8 mojibake in two comments — line 2
(`SEAI A<mojibake> fan carousel`) and line 113 (`outline to transparent A<mojibake> a
keyboard user…`), 5-byte `C3 A2 E2 82 AC` sequences, i.e. a double-encoded U+2019.
Comment-only, zero functional impact, no BOM. Cheap to clean up.

**Stale comment:** `fan-carousel.css:2` points to `card-fan-carousel.tsx` as being in the
homepage folder; it actually lives at `src/components/ui/card-fan-carousel.tsx`.

## Lead intake

`intake.html` + `src/intake.js`. Homepage CTAs deep-link with the plan preselected:
`/intake.html?plan=${plan.plan}` (`Homepage.tsx:432`), so plan attribution survives into
the form. `intake.js:12-14` carries the same three prices as the homepage.

`[VERIFY]` Where a completed intake is actually delivered — emailed, posted to an API,
written to a file? There is no backend in this repo and no observed call to
`seai.payments`. An intake submission's fate is currently unknown, which means leads may
be silently dropped. This is a **launch blocker**.

## Design principles as implemented

The stated direction is Zara × Apple × Palantir as *principles, not direct copying*, and
explicitly not generic SaaS, not fake glassmorphism, not excessive gradients. The code is
consistent with a restrained editorial direction: a near-black ink
(`rgba(10,10,11,…)`, `var(--ink)`), generous whitespace, real focus rings, documented
reasoning, no `!important` abuse visible. Whether the *visual result* honours the
principles is a human judgement that cannot be settled from code. `[VERIFY]`

## Related

- [[01 — Business Model]] · [[07 — Demo Sites]] · [[11 — Security]] ·
  [[13 — Launch Checklist]] · [[15 — Known Issues]]
