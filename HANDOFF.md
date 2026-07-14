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
3. `docs/ARCHITECTURE.md` — **the cross-platform contracts** (higher-up design): the doctrine/non-negotiables, the shell + edge-to-edge + one-`View` frame contract (no `Screen`), the three-tier hybrid `storage` API (sync `kv` / async `store` / async `secure`), and the TanStack-opacity plan.
4. `docs/LIFECYCLE.md` — **the framework lifecycle end-to-end**: `nativ.config.ts` as the one knob surface, the Vite-plugin deploy decision model (SSR+SW / SPA per target, with the static-SPA-on-web override), web vs native build lineages, native APK/IPA, the OTA design (fingerprint-gated bundle swap hosted on the app's own web deploy), native opt-out, and the full CLI surface.
5. `docs/COORDINATION.md` — **the runtime app-lifecycle spine**: `useAppState` (resume/pause — the OTA + refetch trigger), the back-handler priority chain, the full gesture controller, and route lifecycle (no DOM retention). The correct-by-construction substrate the leaf primitives compose onto.
6. `docs/RENDERING.md` — **the hard constraint: nativ code must be isomorphic — NO `createServerFn`/server routes** (they die in a static Capacitor bundle). SSR/SPA per target, SW/OTA model.
7. `docs/BEHAVIORS.md` — every cross-platform behavior nativ fixes, how, and how to test it.
8. `docs/RESEARCH.md` — gaps + Ionic/Capacitor/TanStack prior art + specific issues/PRs to study before reinventing.
9. `docs/capacitor-internals.md` — version pins + native build gotchas.

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
  - CLI `bin/nativ.mjs`: `run`/`build`/`sync`/`assets`/`doctor` (owns the native toolchain + templates). *(No `dev`/`ota` yet — both designed in `docs/LIFECYCLE.md` §2.2, §7.4; web dev is bare `vite dev` today.)*
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

None started as **code**. Every item below now has a **full design** in the docs (2026-07-14 design pass) — the next step for each is TDD/implementation, not more design. Rough priority order:

1. **`.nativ/` re-export barrel + hidden generated dir** — apps still import `@tanstack/*` and see `*.gen` files. **Design: `docs/ARCHITECTURE.md` §3** (`.nativ/` layout, the `nativ` barrel, tsconfig/alias, `register.d.ts`; the one spike-gated call is Virtual File Routes vs `pnpm patch` for generator symbol recognition). **Highest "feels like a real framework" win.**
2. **First-party `@nativ/shell` Capacitor plugin** — collapse edge-to-edge + splash + status/nav bar + theme into ONE owned native module. The wedge vs Ionic. **Design: `docs/NATIVE-SHELL.md`** (scope, JS API, the Android-15/SDK-35 `WindowInsets`/IME crux, phased migration off CLI string-patching).
3. **`create-nativ`** — `pnpm create nativ` scaffolder. **Design: `docs/LIFECYCLE.md` §8.**
4. **Deployment-target knob** — a first-class `web` config block (`render`/`host`/`sw`) → SSR presets (`cloudflare`/`vercel`/`node`/`static`); keep TanStack Start for this. **Design: `docs/LIFECYCLE.md` §1.2, §3–4.**
5. **Capacitor OTA** — fingerprint-gated bundle swap of `dist-capacitor/`, hosted on the app's own web deploy (no third-party server), applied next launch, resume-driven check. **Design: `docs/LIFECYCLE.md` §5.**
6. **Published `dist` build** — tsup/unbuild → `dist` + `.d.ts`, switch `exports` to built output. (Mechanical — not separately designed.)

Conceptual gaps from `docs/RESEARCH.md` §1 are now designed in **`docs/COORDINATION.md`**: `useAppState` (resume/pause — also the OTA trigger), the back-button **priority handler chain**, the full **gesture controller**, and route lifecycle (no DOM retention). Build order there: app-state → back chain → gesture controller → route lifecycle.

---

## 5. Relationship to the app repos (context you need)

- **chopchop is the gold/source.** nativ was extracted from chopchop's `packages/nativ`. For shared **primitives**, chopchop is the proven **code-superset** across chopchop/veralens/escolhe — so nativ already holds the best-of-breed (verified this session via 3-way diff). The drawer keyboard patch people remember (`maxKeyboardLiftRef`) was **superseded** by moving de-jitter into `useKeyboard` (CH #87) — nativ has the better version.
- **A cross-project unification is finalizing** (separate from nativ dev): 3 open PRs converge chopchop/veralens/escolhe to the union (primitives, dev tooling, skills, conventions, a security fix) — chopchop #92, veralens #22, escolhe #4. Not blocking nativ.
- **chopchop-as-project-0 wiring is PENDING the user's explicit command.** Do NOT wire chopchop to consume `@arrzdev/nativ` until the user says go. When they do: replace chopchop's workspace `packages/nativ` with the external dep (`link:` during dev), keep a `pnpm link` loop.

---

## 6. Decisions locked in (don't re-litigate)

**Foundational (pre-2026-07-14):**
- **Single-package repo** (root = the framework). Promote to a `packages/*` monorepo only when the native plugin or `create-nativ` need separate publishing.
- **No hard forks** of Capacitor / TanStack Router / TanStack Start. Own the *seams*, rent the stable cores. Escalate on the ownership spectrum only as needed: re-export barrel → `.nativ/` → `pnpm patch` → vendor one small module → replace a layer. (Full reasoning in the vision/rendering docs + the project memory.)
- **Keep TanStack Start** — for its deploy-anywhere presets (roadmap #4).
- **Isomorphic-only** — no `createServerFn`/server routes/server-only reads (breaks Capacitor). Data is consumer-wired (client token, IndexedDB/Query persister). `docs/RENDERING.md` is the authority.
- **Splash/edge-to-edge opinions:** native splash = solid colour mask (mascot only in the React splash); React splash = installed-only (browser opt-in); mask follows app theme by default; always edge-to-edge.

**Design pass (2026-07-14) — the architecture/lifecycle decisions:**
- **Frame owned _above_ the route; one `View`, no `Screen`.** RN's navigator model: the framework shell seeds a full-viewport slot and stretches its child; `View` is a dumb-correct `flex-col` box (`min-h-0`-safe). Root-ness comes from framework-seeded context/CSS, never DOM sniffing. → `docs/ARCHITECTURE.md §1` (revises `VISION.md §2` principle 4).
- **Storage = three tiers under `storage`.** Sync memory-backed `kv` (MMKV model — boot-hydrated on native), async `store` (a blob KV, **not** an ORM — the query/data layer stays consumer-wired), async `secure` (Keychain/Keystore on native; **best-effort only, not secure, on web**). Static-fn **and** reactive-hook per tier. → `docs/ARCHITECTURE.md §2`.
- **TanStack opacity = opacity, not absence.** Gen files hidden in `.nativ/`; consumer imports only `nativ`. Not eliminated (typesafety needs the generated tree). → `docs/ARCHITECTURE.md §3`.
- **Hybrid primitives push the platform branch to the lowest layer** (accessor returns native-*accurate data*, not machinery); geometry is DOM-free/unit-testable; drivers take a `ref` in, components spread state out. → `docs/ARCHITECTURE.md §4`.
- **Deploy = a first-class `web` config block** (`render`/`host`/`sw`). `target:capacitor` is absolute (forced SPA + no SW); on web the consumer chooses (incl. static SPA+SW). → `docs/LIFECYCLE.md §1,§3`.
- **Native OTA = self-hosted on the app's own web deploy** (no third-party server), `nativeFingerprint`-gated (JS-safe vs needs-store-build), applied next launch, resume-triggered, watchdog rollback. nativ owns the policy, rents the low-level swap. → `docs/LIFECYCLE.md §5`.
- **App-lifecycle spine:** `useAppState` (accessor+hook; also the OTA/refetch trigger) → back **priority handler chain** → **full** Ionic-style gesture controller → route lifecycle with **no DOM retention**. → `docs/COORDINATION.md`.
- **`@nativ/shell` = own it, phased** — phase 1 edge-to-edge + inset/IME reporting (the Android-15 fix), phase 2 absorb status-bar/splash/theme off the CLI's native-source patching. Study Capawesome's `WindowInsets` as reference, don't depend on it. → `docs/NATIVE-SHELL.md`.

## 7. Open questions to resolve as you build

*(Resolved this pass, moved to §6: OTA mechanism, deployment presets, `@nativ/shell` scope.)*

- **TanStack generator symbol-recognition** (`.nativ/` hiding): Virtual File Routes override vs a `pnpm patch` of `@tanstack/router-generator` — the one spike-gated call; prototype both, pick least brittle. → `docs/ARCHITECTURE.md §3.3`.
- **KV native durability/hydration edge cases:** the boot-hydration gate, the ~1-tick write-persist lag, `useSyncExternalStore` snapshot stability + object-fallback handling. → `docs/ARCHITECTURE.md §2.1`.
- **Plugin picks (pinned deps):** which maintained secure-storage plugin (Keychain/Keystore), and which low-level OTA swap plugin (Capawesome Live Update vs Capgo vs DIY). → `docs/ARCHITECTURE.md §2.3`, `docs/LIFECYCLE.md §5.5`.
- **Config back-compat:** migration path from the flat `appId`/`router.render`/`sw` fields to the `web`/`native`/`ota` blocks.
- **Six-target automation:** can the native matrix run in CI (`nativ e2e` driving sim/emulator) or stay local. → `VISION.md §9`, `docs/LIFECYCLE.md §7.2`.
