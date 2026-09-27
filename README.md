# SEAI — public website

> AI that operates your Shopify business.

The public marketing site for SEAI — an autonomous AI commerce operator
for Shopify. Built with Vite, vanilla HTML/CSS/JS. No framework, no
trackers, no dependencies beyond the build tool.

## Commands

```bash
npm install     # one-time
npm run dev     # local dev server
npm run build   # production build → dist/
npm run preview # preview the production build
```

## Stack

- **Vite** — zero-config production build (minified, hashed assets)
- **Hand-written CSS** — SEAI design tokens (black · white · neutral greys),
  Inter + system mono, responsive breakpoints
- **~2 KB of JS** — header state, mobile menu, scroll reveals, FAQ accordion

## Pages

| Path           | Purpose                        |
| -------------- | ------------------------------ |
| `/`            | Marketing page (10 sections)   |
| `/terms.html`  | Terms of Service               |
| `/privacy.html`| Privacy Policy                 |
| `/404.html`    | Not found                      |

## Brand

- Logo/favicons: `D:\seai\public` (source of truth — copied to `public/`)
- Tagline: *AI that operates your Shopify business*
- Loop: Observe → Analyze → Decide → Execute → Measure → Learn → Repeat
- Canonical app URL for CTAs: `https://seai.store`