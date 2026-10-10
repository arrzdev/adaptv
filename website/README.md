# adaptv — the website

The adaptv site is **an adaptv app**, linked against the local checkout exactly as
[`../playground/`](../playground) is. That is deliberate: the site is the public demo, and building
it is the first time adaptv has been used for something that is mostly *content* rather than an
app — so it finds gaps the playground never will. The plan, and the survey of sixteen framework
sites behind it, is [`../docs/roadmap/website.md`](../docs/roadmap/website.md).

```bash
cd website
pnpm install        # its own pnpm project — the root install does not cover it
pnpm dev            # adaptv dev web → http://localhost:41760
pnpm typecheck
pnpm lint           # biome, with website/biome.json (the root config ignores this folder)
pnpm test:e2e       # Playwright smoke on the production build: build, serve, 10 page loads (~3 min)
pnpm format
```

From the repo root: `pnpm website:dev`.

`react`, `react-dom`, `vite` and `motion` are `link:`s to the **root** copies, not versions. adaptv
is linked from the root and resolves its own; a second copy here is two Reacts and a null-dispatcher
crash that names neither.

## Layout

| Path | What it is |
|---|---|
| `adaptv.config.ts` | The one config. `render` is left at its default, `"ssr"` — a public site is the case that default exists for. |
| `src/routing/` | `config.ts` declares the routes: `/`, `/docs`, `/docs/$slug`, `/blog`, `/blog/$slug`. |
| `src/components/sections/` | The landing page, one file per band, in page order. |
| `src/components/inbox/` | The hero's app: one `useInbox()` state, rendered as a phone layout and a desktop layout. Both are real adaptv components, so the hero is interactive rather than a picture. |
| `src/components/demos/` | The live *plain web view vs adaptv* side-by-sides. |
| `src/components/section.tsx`, `reveal.tsx` | The band primitive (figure number, claim left, one sentence right) and the scroll-in fade. |
| `src/components/frames.tsx` | Phone and browser frames drawn in CSS. They take children, because what is inside them runs. |
| `src/content/` | Everything the landing page and blog say: code samples, field notes. |
| `src/content/docs/` | The documentation. `pages/<slug>.ts` is one page; `index.ts` is the sidebar order, and the overview, search and pager all read it. `../blocks.ts` is the block vocabulary (prose, props tables, API signatures, per-target tables, live demos). |
| `src/components/docs-demos/` | One small live component per reference page, built from the real adaptv component. |
| `src/components/docs-layout.tsx`, `docs-home.tsx`, `prose.tsx` | The docs chrome (sidebar, search, on-this-page, pager, the mobile sheet), the `/docs` overview, and the block renderer. |
| `DOCS_AUTHORING.md` | How to write a docs page. Read it before adding one. |
| `src/assets/captures/` | Real captures of the playground app. See below. |

## Writing a "plain web view" specimen

adaptv's stylesheet patches the whole document — it re-points Tailwind's `active:` at the press
engine, contains overscroll, kills the tap highlight. So a control written with utilities inside
this site **is already fixed**, and would quietly demonstrate adaptv on both sides. The specimens
are therefore raw, unlayered CSS in `src/styles/main.css` (`.plain-press`, `.plain-scroll`). Keep
them that way, and say why in a comment when you add one.

## Design rules

The first draft read as a template: every band was eyebrow, headline, paragraph, cards. The second
was built after studying Tailwind, Linear, Bun, Resend, Raycast, Expo, Clerk and Next side by side.
What they share, and what this page now holds itself to:

- **The visual is the argument, the copy is its caption.** A headline is at most six words and a
  lede at most two lines. If a band needs a paragraph to land, it needs a better demo.
- **Show the thing running.** adaptv's one unfair advantage is that this site IS an adaptv app, so
  every feature card holds the live component, never a picture of it.
- **One structural idea, everywhere.** The page is a ruled sheet (`.sheet`, `.ruled` in
  `main.css`): hairlines down both sides, a hairline between bands, a registration mark where they
  cross. It is the logo's two brackets at page scale.
- **Neutral canvas, one light.** True near-black and true white. The only saturated colour is the
  glow behind the device stage and the gradient on one line of the hero and the closing band.
- **Hero motion is CSS** (`.rise`, `.stage-in`) so it plays before hydration; everything below the
  fold uses `Reveal`.

## Assets

`src/assets/captures/` holds two real iPhone-simulator captures of the playground app. The hero no
longer uses them — it runs a live app instead — so they are spare material for docs and posts. To
retake them:

```bash
cd playground/apps/frontend
VITE_APP_PORT=41930 pnpm exec adaptv preview ios --target <simulator udid> --force
```

then capture the simulator at full resolution, `sips --resampleWidth 660`, and drop the PNG in
`src/assets/captures/`. Import it with `?adaptv-image` and render it with `<Image>` so the build
measures it and the frame reserves its box.

Still owed: a real-device photo or capture for social cards.

## What is a draft here

- **Docs and field notes are data** (typed blocks in `src/content/`, rendered by
  `components/prose.tsx`). The intended shape is markdown files behind a build-time pipeline. The
  docs were written from the framework source on 2026-09-21 and say what the source did that day;
  pages carry `note` blocks where something is unbuilt or where the source and an internal doc
  disagree.
- **The highlighter** in `components/code.tsx` is forty lines of regex. It renders on the server
  with no async step, which is why it exists; a real grammar replaces it with the content pipeline.
- **The terminal in "It fails your build, not your users"** is illustrative output, not a capture.
- Docs search is a client-side filter over titles, summaries and headings, not full text. There
  is no `llms.txt`, no RSS, no sitemap yet.
