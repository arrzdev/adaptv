# nativ — development handoff

Start-here doc for continuing **nativ** development in a fresh session, independently of the app-unification work. Read this + the linked docs and you have full context. Last updated **2026-07-14**.

---

## 1. What nativ is (30 seconds)

A **cross-platform React framework**: write React (DOM/CSS), ship the same code as desktop web (SSR), an installable PWA, and native iOS/Android (Capacitor) — correct on every target, no per-platform babysitting. Capacitor is a thin seam; on top are **correct-by-construction primitives** + capability hooks that pick browser/polyfill/native. "Expo's ambition on Capacitor's mechanism," web-first. Beats Ionic on correctness + DX by being opinionated end-to-end.

- **Repo:** `arrzdev/nativ` (private, GitHub). Local: `~/Documents/Github/nativ`.
- **Package:** `@arrzdev/nativ`, single-package (repo root IS the framework — not a `packages/*` monorepo).
- **Extracted from** chopchop's `packages/nativ` (which is the "gold"/source of truth for the framework).

**Read next (in order):**
1. `README.md` — roadmap + status + quick start.
2. `docs/VISION.md` — the north star, principles, primitive/capability API targets, sequencing.
3. `docs/RENDERING.md` — **the hard constraint: nativ code must be isomorphic — NO `createServerFn`/server routes** (they die in a static Capacitor bundle). SSR/SPA per target, SW/OTA model.
4. `docs/BEHAVIORS.md` — every cross-platform behavior nativ fixes, how, and how to test it.
5. `docs/RESEARCH.md` — gaps + Ionic/Capacitor/TanStack prior art + specific issues/PRs to study before reinventing.
6. `docs/capacitor-internals.md` — version pins + native build gotchas.

---

## 2. Current state (2026-07-14) — GREEN

- **CI live + green:** `.github/workflows/ci.yml` runs `install → typecheck → biome → vitest` on every push/PR, with a `$GITHUB_STEP_SUMMARY` table. No envs/deploys. Both pushes so far passed.
- **Gate:** `pnpm typecheck` (0) · `pnpm biome:check` (0) · `pnpm test` (**180 vitest**, 24 files).
- **Built + working** (transported + verified on both simulators during the extraction session):
  - Platform foundation (`isNativePlatform`/`isInstalledApp`/`getOS`, pre-paint `data-nativ-platform`/`data-nativ-os` stamp, `app:`/`web:` variants).
  - Shell (root document, critical CSS, memory-history-when-installed, edge-to-edge, safe-area).
  - Capabilities (browser/polyfill/native behind `isNativePlatform`): haptics, keyboard, network, status bar, geolocation, Android back, native-theme, splash, external-link browser.
  - Splash: colour-driven mask, `splashMaskMode` (preferences/system/light/dark), theme-aware both platforms, self-unmounting React splash, Android-12 icon stripped.
  - Config: flat `nativ.config.ts` (`appId`, `splashScreen`, `splashScreenInBrowser`, `splashMaskMode`, …) → generates capacitor.config + web manifest + native projects.
  - Vite plugin: web = SSR + SW; capacitor = static SPA, no SW.
  - Native build: Capacitor iOS+Android, debug `.apk` + unsigned `.ipa`.
  - CLI `bin/nativ.mjs`: `dev`/`run`/`build`/`sync`/`assets`/`doctor` (owns the native toolchain + templates).
  - **Primitives (chopchop is the proven code-superset — nativ already has best-of-breed):** `View`, `List`, `Button`, `Link`, `ExternalLink`, `ScrollView`, `Image`, `Swipeable` (+ `isSwipeableGestureTarget`), `PullToRefresh`, `Drawer`/`Sheet` (drum wheel, `Drawer.Footer`, keyboard-avoidance), `Input`, `checkbox`, `switch`.

---

## 3. How to develop it

```bash
cd ~/Documents/Github/nativ
pnpm install          # pnpm 11; esbuild build-script allowed via pnpm-workspace.yaml `allowBuilds`
pnpm typecheck        # 0
pnpm biome:check      # 0
pnpm test             # vitest, 180
```

- **pnpm-11 quirks already handled** (don't undo): `pnpm-workspace.yaml` has `allowBuilds: esbuild: true`; `.npmrc` has `verify-deps-before-run=false`. Without these, every `pnpm <script>` fails on the esbuild build-script gate.
- **Ships TypeScript source** (exports point at `src/interface/*.index.ts`). Works when a consumer's bundler compiles it. Real GitHub Packages publishing needs a `dist` build (tsup/unbuild) + `.d.ts` — **not done yet** (roadmap #6).
- **Test against a real app** via a local link (no playground by design): in the app's `package.json`, `"@arrzdev/nativ": "link:../nativ"` (or `file:`). Dogfood target is chopchop once it's wired as project-0 (pending — see §5).
- **Testing discipline:** TDD; six-target discipline in `docs/TESTING.md` (`docs/BEHAVIORS.md` has how-to-test per behavior). iOS sim + Android emulator available for native verification.
- **Distribution/versioning:** private GitHub Packages; consumers pin per-project and a deploy builds from the lockfile — **updates never auto-propagate** (bump + commit lockfile per project). `.npmrc` in a consumer needs `@arrzdev:registry=https://npm.pkg.github.com` + a `GITHUB_TOKEN`.

---

## 4. Roadmap — what's next (pick up here)

None started; each has enough context in the docs to begin. Rough priority order:

1. **`.nativ/` re-export barrel + hidden generated dir** — apps still import `@tanstack/*` and see `*.gen` files. Plan: generated files → hidden `.nativ/` (tsconfig path + Vite alias, both nativ-generated); re-export the router surface from `nativ` so apps import only `nativ`. The one non-trivial spot is the route generator recognizing a re-exported `createFileRoute` — that's a surgical `pnpm patch` of `@tanstack/router-generator`, OR use Virtual File Routes (`__virtual.ts`) to override generation. See `docs/RESEARCH.md` §2 (links). **Highest "feels like a real framework" win.**
2. **First-party `@nativ/shell` Capacitor plugin** — collapse edge-to-edge + splash + status/nav bar + theme into ONE owned native module (Swift/Kotlin), instead of composing community plugins + CLI string-patching. The wedge vs Ionic. Study Capacitor's plugin authoring + the Android-15/SDK-35 edge-to-edge+keyboard breakage in `docs/RESEARCH.md` §3 (real risk).
3. **`create-nativ`** — `pnpm create nativ` scaffolder (a new package or a `bin`). Emits an app + native templates.
4. **Deployment-target knob** — web SSR presets (`cloudflare`/`vercel`/`node`/`static`). Today the example hardcodes Cloudflare. **Keep TanStack Start** precisely for this deploy-anywhere flexibility (its whole value — do not fork/replace it; see `docs/RENDERING.md`).
5. **Capacitor OTA** — live-update bundle swap (download → unpack → `serverBasePath` → apply next launch). Study Capgo `@capgo/capacitor-updater` + Capawesome + Apple §3.3.2 (JS/assets-only) in `docs/RESEARCH.md` §5. Web/standalone OTA already falls out of the SW.
6. **Published `dist` build** — tsup/unbuild → `dist` + `.d.ts`, switch `exports` to built output, for real GitHub Packages publishing. Enables true semver consumption.

Plus conceptual gaps flagged in `docs/RESEARCH.md` §1: page/route lifecycle hooks, app-resume lifecycle (`useAppState`), a back-button **priority handler chain**, a gesture **arbiter** (study Ionic's gesture controller).

---

## 5. Relationship to the app repos (context you need)

- **chopchop is the gold/source.** nativ was extracted from chopchop's `packages/nativ`. For shared **primitives**, chopchop is the proven **code-superset** across chopchop/veralens/escolhe — so nativ already holds the best-of-breed (verified this session via 3-way diff). The drawer keyboard patch people remember (`maxKeyboardLiftRef`) was **superseded** by moving de-jitter into `useKeyboard` (CH #87) — nativ has the better version.
- **A cross-project unification is finalizing** (separate from nativ dev): 3 open PRs converge chopchop/veralens/escolhe to the union (primitives, dev tooling, skills, conventions, a security fix) — chopchop #92, veralens #22, escolhe #4. Not blocking nativ.
- **chopchop-as-project-0 wiring is PENDING the user's explicit command.** Do NOT wire chopchop to consume `@arrzdev/nativ` until the user says go. When they do: replace chopchop's workspace `packages/nativ` with the external dep (`link:` during dev), keep a `pnpm link` loop.

---

## 6. Decisions locked in (don't re-litigate)

- **Single-package repo** (root = the framework). Promote to a `packages/*` monorepo only when the native plugin or `create-nativ` need separate publishing.
- **No hard forks** of Capacitor / TanStack Router / TanStack Start. Own the *seams*, rent the stable cores. Escalate on the ownership spectrum only as needed: re-export barrel → `.nativ/` → `pnpm patch` → vendor one small module → replace a layer. (Full reasoning in the vision/rendering docs + the project memory.)
- **Keep TanStack Start** — for its deploy-anywhere presets (roadmap #4).
- **Isomorphic-only** — no `createServerFn`/server routes/server-only reads (breaks Capacitor). Data is consumer-wired (client token, IndexedDB/Query persister). `docs/RENDERING.md` is the authority.
- **Splash/edge-to-edge opinions:** native splash = solid colour mask (mascot only in the React splash); React splash = installed-only (browser opt-in); mask follows app theme by default; always edge-to-edge.

## 7. Open questions to resolve as you build

- `.nativ/` generator hiding: `pnpm patch` the generator vs Virtual File Routes override — prototype both, pick the least brittle.
- OTA mechanism: wrap Capgo/Capawesome vs DIY bundle-swap.
- Deployment presets: expose Start's adapter targets directly, or a nativ-level `deployment` config field.
- `@nativ/shell` plugin: how much to own natively vs keep as CLI template patches.
