# adaptv — ChopChop and Veralens move from `packages/nativ` to the published `adaptv`

> **Status: decided 2026-10-09, scheduled after the alpha is on npm. Not started.** Nothing here has
> been built against adaptv; the counts are read from source, not from a typecheck.
>
> **Size: medium per app. Risk: medium** — the components carry over by name; the work is the frame
> around them (config, generated files, service worker, build and deploy).

---

## 0. Why

ChopChop and Veralens are the two apps the landing shows under "Built with adaptv"
(`website/src/components/sections/built-with.tsx`). Both run on `packages/nativ`, an in-repo copy of
the framework from before it was extracted, renamed and published, so the section has to say so.
When both apps install `adaptv` from npm and `packages/nativ` is gone from both repos, that caveat
goes, and adaptv has two real consumers that catch a broken release before anyone else does.

The source for the ChopChop half is the `adaptv-migration-report` document on TUD-423 (steps 1–3 of
[`migration-skill.md`](migration-skill.md), chopchop `apps/frontend` at `8d02cdc`). The Veralens half
was read from veralens `origin/main` at `8950772` for this file, with the same method but less depth.

## 1. What each app uses today

Both repos carry their own copy of `@repo/nativ` (`packages/nativ`, `"private": true`, version
`0.0.0`, consumed as `workspace:*`). The two copies have drifted apart: 14 files differ. ChopChop's was
last changed 2026-07-24, Veralens's 2026-07-30.

| | ChopChop (`apps/frontend`) | Veralens (`apps/website`) |
|---|---|---|
| What it is | Todo PWA, offline-first (`@repo/synq` + Dexie), iOS/Android later | Marketing site, docs, blog and a signed-in dashboard; web only |
| `@repo/nativ` import statements | **71** in 43 files | **17** in 12 files |
| Distinct symbols | 58 | 16 |
| Move as is (subpath rename only) | 36 statements | all but `cn` and the `vite` plugin |
| Need a change | 35 (27 of them are `cn`) | 2 (`cn`, `nativ` from `/vite`) |
| Blocked imports | 0 | 0 |
| Hand-written service worker (`src/sw.ts`) | yes | yes |
| `providers:` in config | yes | yes |
| `pressed:` variant | 13 uses in 6 files | none |
| Hand-written `@tanstack/react-router` imports (L20) | 5 files | **43 files** |
| Per-route `head` | no | yes: blog, docs, platform layout |
| Deploy | `wrangler.toml` `main = "@tanstack/react-start/server-entry"` | same |

Symbols Veralens imports: `AvoidKeyboard`, `Input`, `InputHandle`, `TextArea`, `TextAreaHandle`,
`Link`, `LinkProps` (`/components`); `useGestureEngine`, `useReducedMotion` (`/hooks`); `defineApp`
(`/config`); `rootRoute`, `index`, `route`, `layout` (`/routes`); `cn` (`/utils`); `nativ` (`/vite`).
Every one has a counterpart on adaptv `main` except `cn`.

## 2. What changes in each app

The same list for both, from the TUD-423 report §1–§2:

- **`cn`**: adaptv no longer exports it (Tailwind is optional, O24). An app-local `@/utils/cn` on
  `clsx` + `tailwind-merge`. Veralens already has both dependencies.
- **`nativ.config.ts` → `adaptv.config.ts`**: `router.render` → top-level `render`;
  `generatedRouteTree` / `virtualRouteConfig` / `quoteStyle` → `router.routerConfig`; `sw:` goes;
  `providers:` becomes a layout route wrapping `<Outlet />`. Other `createRouter` options
  (Veralens's `scrollToTopSelectors`, `defaultPreload*`, `defaultPending*`) are spread through as they
  are.
- **`src/sw.ts` is deleted.** adaptv owns the worker. `registerIncrementalNavigationRoute`, which both
  apps call, does not exist in adaptv. Offline navigation, `/api/` never cached and update on deploy
  are re-verified, not ported.
- **Generated root and router files** (`router.gen.tsx`, `__root.gen.tsx`) are deleted; adaptv
  generates them.
- **`vite.config.ts`**: `nativ()` → `adaptv()` from `adaptv/vite`; `@cloudflare/vite-plugin` goes,
  because adaptv builds the server itself (Nitro, preset `cloudflare_module`).
- **Styles**: `@import "@repo/nativ/styles.css"` + `tailwindcss-safe-area` → `@import
  "adaptv/tailwind.css"`. ChopChop: `pressed:` → `active:`.
- **L20**: hand-written `@tanstack/react-router` imports move to `adaptv/router`, and `Link` to
  `adaptv/components`.
- **Deploy**: the build owns the worker entry; `wrangler deploy` reads `.output/server/wrangler.json`.
  The deploy job in each repo changes (Head of Platform).

ChopChop only: `Screen` is gone (a page root is `ScrollView` or `View fill`); `ScrollView`'s
`edgeFades` / `edgeClassName` → `fade`; `useVibrate` → `useHaptics` after the switch. The playground
(`playground/apps/frontend`) is a copy of ChopChop already moved, so most of these edits exist there.

## 3. What blocks the switch

| # | Blocker | Blocks | Unblocked by |
|---|---|---|---|
| **K1** | **`adaptv` is not on npm.** `package.json` is `"private": true` at `0.1.0-alpha.1`. This item is about the *published* package; a tarball or git dependency would not prove the published artefact works. | Both apps | The alpha publish (TUD-424) |
| **K2** | **`adaptv/router` has no `Navigate`**, which Veralens renders in `platform/root/redirect-to-jobs.page.tsx`. `notFound` (thrown in `blog/$slug.page.tsx`) is already exported, so that call site only changes its import. **Decided 2026-10-09 (TUD-441): `Navigate` stays out of the curated surface;** Veralens throws `redirect` from that route's `beforeLoad`, which also redirects before render under SSR. | Veralens | Rewriting the one call site in the switch PR |
| **K3** | **Per-route `head` reaching server-rendered HTML** is unproven for Veralens. Its `SEO-PLAN.md` already flags that the root route is owned by the framework. adaptv owns the root route too, so the blog and docs pages need a check that their `<title>` and meta tags are in the SSR response, not only after hydration. | Veralens's SEO | A test in the switch PR; a framework fix if it fails |
| **K4** | **ChopChop's repo has no Actions minutes**; its PRs merge on `.github/scripts/local-gate.sh` (TUD-315). | Nothing technical; the switch PR takes a long local gate run | — |

Native targets (iOS/Android) are **not** part of this item. ChopChop's report lists three native-only
blockers (absolute API base URL and CORS, token in `storage.secure`, OAuth through the system
browser); they come after the web switch and do not affect the landing claim, which is about the
installed web apps.

## 4. Order

**ChopChop first.** It uses most of the surface (71 imports, drawers, swipe, gestures, wheel, offline
worker), the playground already holds most of its edits, and it has a full migration report. If the
published package works for ChopChop, it works for the smaller surface Veralens uses. Veralens follows
because K3 is open and its 43 L20 call sites are mechanical but many.

1. **Prep in ChopChop, on `@repo/nativ`, any time**: the app-local `cn` (27 files); the token module
   behind an async-ready read/write pair. Both are in the TUD-423 report §5 (P1, P2).
2. **After K1**: ChopChop switch PR (S1) and its deploy change (S2), merged together; then QA on
   staging (every main flow, offline reload, worker update after a second deploy, drawers and edge
   swipe on iOS Safari and the installed PWA).
3. **Delete `packages/nativ` from ChopChop** in its own PR, once S1 has run on staging. Deleting a
   package is ask-first in that repo.
4. **Veralens**: the `Navigate` rewrite (K2), `cn`, the L20 imports, config, worker and deploy in
   one switch PR, with the K3 check in it. Then delete its `packages/nativ`.
5. **Landing**: drop the `packages/nativ` caveat from `built-with.tsx` (follows TUD-440). Then move
   this file out of `roadmap/`.

## 5. The check that proves it

For each app, on its `main`:

- `apps/<app>/package.json` depends on `adaptv` with a registry version (`"adaptv": "0.1.0-alpha.N"`
  or later), not `workspace:`, `link:`, `file:` or a git URL; the lockfile resolves it from
  `registry.npmjs.org`.
- `packages/nativ` does not exist, and `git grep -n "@repo/nativ" -- ':!*.md'` is empty.
- The app's own gate is green: build, typecheck, Biome, unit tests and its Playwright specs (ChopChop:
  all 10 e2e specs; Veralens: its specs plus the K3 head check).
- The deployed staging app loads, works offline after one visit (ChopChop) and picks up a second
  deploy through the worker update.

This file moves out of `roadmap/` when both apps pass and the landing caveat is gone.

## 6. Out of scope

- Doing the move itself; each step above becomes its own task in the app's project.
- The landing copy (TUD-440).
- iOS/Android builds of either app (§3, last paragraph).
- Style rewrites the move does not force (`div` → `View`, font loading).
