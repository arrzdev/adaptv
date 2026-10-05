# adaptv — architecture & the cross-platform contracts

> The **higher-up design**: the contracts the whole framework hangs off, decided before the leaf-level
> primitives so the leaves compose onto them. Where `VISION.md` is the north star and `docs/design/behaviors.md` is
> the catalogue of fixes, **this doc is the load-bearing structure**: the shell, the frame, storage, and
> the seam that keeps TanStack invisible.
>
> Doctrine, not a changelog. Each section states the **contract**, what **already holds** in the code
> today, and the **delta** to close. Started **2026-07-14**.

---

## 0. Doctrine (the non-negotiables)

These govern every decision below. They are deliberately more opinionated than a general-purpose UI kit —
that opinion **is** the product.

1. **Opinionated by default; granular control only where it genuinely belongs to the developer.** adaptv
   makes the app-lifecycle and cross-platform engineering calls. The consumer configures intent in
   `adaptv.config.ts`, not mechanism. A framework that lets you choose the wrong thing can't guarantee the
   app feels right — that guarantee is the whole value.
2. **Everything exported abstracts the hybrid heavy-lifting.** Every public API hands the consumer a
   **tier-2** simple surface and hides the `isNativePlatform()` branch underneath. The consumer never
   writes a per-platform branch to get correct behavior; that is adaptv's job, structurally.
3. **The shell is inherited, never authored.** Creating a root layout or a page must not require the
   consumer to write meta injection, viewport tags, critical CSS, the platform stamp, the splash gate, or
   the edge-to-edge/safe-area wiring. All of it is framework-owned and always present.
4. **The frame is owned above the route, not detected inside it.** Root-ness comes from the framing layer
   (the shell) seeding a full-viewport, inset-aware slot — never from a primitive inspecting the DOM or
   mutating the consumer's tree. (This *revises* `VISION.md §2` principle 4: the intent — "no runtime
   magic that rewrites user code" — stands; the mechanism is a framework-owned frame, à la React
   Native's navigator, not a self-inspecting `Screen`.)
5. **Every primitive is cross-platform end-to-end.** A `Drawer` avoids the keyboard via a `visualViewport`
   heuristic in the browser and via the **native** keyboard primitive on device. Even the native
   avoid-keyboard hook returns *native* machinery to do the work — the split is internal, invisible above.
6. **Don't reinvent the solved.** Gestures, viewport hacks, composition animations — Ionic stress-tested
   these for years. Study their solution and their open issues (`../research/capacitor-internals.md`,
   `../decisions/prior-art.md`), adopt the hard-won edge
   cases, and diverge only where adaptv's model genuinely differs. Rent the stable core; own the seam.
7. **Mechanisms live at the JS layer; platform config stays dumb.** Anything a user can *see* belongs in
   React — styleable, themeable, testable, i18n-able, and identical on all six targets. The platform
   layer beneath it (native splash screen, service worker, inset plugin) does the minimum required to
   get the app booted and then gets out of the way. **Where a behaviour could live in either place, it
   goes in React**, because a platform-level implementation can only ever cover the targets that have
   that platform — which forces a second implementation for the others and guarantees they drift.

   | Concern | Dumb platform layer | Real behaviour |
   |---|---|---|
   | Splash | native launch screen = flat colour mask | `splashScreen` component, self-unmounting |
   | Offline | SW serves a bootable shell | offline UI rendered in place by the failing route |
   | Insets | plugin reports raw numbers | `View safe="…"` |
   | Back | OS event → priority chain | overlay/route handlers in React |

   The test to apply: *"if I implemented this in the platform layer, how many targets would it cover?"*
   If the answer is fewer than six, it belongs in React. → `docs/design/rendering.md §3.0` works this through for
   the offline case, which is the fullest worked example.

8. **Rent at a frozen version — pin exact, and key every patch to that version.** Renting a stable core
   (6) only *stays* stable if the version can't move under you. So every direct dependency and peer is
   pinned to an **exact** version — no `^`, no `~` — and the lockfile is committed; an upstream release can
   never silently enter a fresh install. This matters most for the packages adaptv **patches**: a
   `pnpm patch` is written against one specific version's source, so its `patchedDependencies` key carries
   the exact version (`pkg@x.y.z`, never a bare `pkg`). If the resolved version ever drifts, pnpm fails the
   install **loudly** ("no package matches") instead of applying the patch to code that may have changed
   underneath it — turning a silent, shipped-to-users breakage into an install-time stop. Bumping a rented
   core is therefore a **deliberate act**: update the pin, re-verify the patch against the new source,
   update the version key. The more adaptv leans on patches and injection to keep its underlying packages
   invisible to the consumer (§3, and the CLI's Capacitor ownership), the more this guardrail is what makes
   that ownership safe rather than fragile. → `docs/decisions/register.md` L21 (register), L19/L20 (the patch doctrine it
   guards).

---

## 1. Surface 1 — the shell, edge-to-edge, and the `View` contract

The app skeleton. Everything renders inside it, so it is designed first.

### 1.1 The three layers of the frame

The full-bleed, inset-correct app frame is owned by **three cooperating layers**, top to bottom:

```
┌─ OS / native layer ───────────────────────────────────────────────────────┐
│  Draws edge-to-edge; reports the REAL insets (status bar, nav bar, cutout,  │
│  keyboard) to the WebView.                                                  │
│  Today: StatusBar.overlaysWebView:true + community plugins + useStatusBar.  │
│  Target: a first-party @adaptv/shell Capacitor plugin owning this in one     │
│  native module, hardened against the Android-15/SDK-35 inset+keyboard       │
│  breakage (../research/capacitor-internals.md (upstream issues to watch), HIGH RISK). Roadmap #2.                          │
├─ Shell layer (framework — RN's "navigator") ──────────────────────────────┤
│  Wraps EVERY route. Owns <html>/<head>/meta, critical CSS, the pre-paint    │
│  platform+theme stamp, the splash gate, and the full-viewport flex frame.   │
│  Exposes insets as CSS custom properties that resolve identically on web    │
│  (env(safe-area-inset-*)) and native (plugin-reported).                     │
│  Today: createRootRoute → RootDocument → RoutingShell → AppShell.           │
├─ View layer (consumer-facing primitive) ──────────────────────────────────┤
│  A dumb-but-correct flex box. Column by default, min-h-0-safe, fills the    │
│  frame the shell established. Never asks "am I the root."                   │
│  Today: <View> (row/center/fill/safe).                                      │
└────────────────────────────────────────────────────────────────────────────┘
```

The key inversion, learned from React Native: **RN's `View` is not smart — it's a flex box.** The screen
frame comes from the *navigator above the route*, and `View` just fills it. adaptv already has that
navigator: it's the **shell**. So there is no self-detecting `Screen`; there is a framework-owned frame
and a dumb-correct `View`.

### 1.2 One primitive: `View` (no `Screen`, no `Page`)

`View` is the single box primitive, mirroring RN. Contract:

- **`flex flex-col` by default** (RN parity — column is the common case; write `row` to go horizontal).
- **`min-h-0`-safe when it fills.** `fill` → `flex-1 min-h-0`, so a scroll region deeper in the tree can
  never collapse to zero height (the DOM flex-chain trap). This is the correctness win over both RN —
  whose Yoga engine doesn't have the trap, so RN devs never learned to guard it — and Ionic, which needs
  `ion-content` ceremony to get it.
- **`safe` is structural.** Safe-area padding wins over a conflicting `className` (registered into
  tailwind-merge's padding groups — `docs/design/behaviors.md §6`). Resolves to `0` in a browser tab, the real inset
  when installed/native.
- **Behavior is props (`row`/`center`/`fill`/`safe`); look is `className`.** Unchanged from today.

`Screen` is **removed**. It was never in the public barrel (`src/interface/components.index.ts`) and its class contract
(`flex min-h-0 w-full flex-1 flex-col`) is exactly `View fill` (the `w-full` is redundant under a
flex-col parent's default `align-stretch`). Static full-screen surfaces (404, empty states, rotate
prompt) use a plain `<View>` at the route root — it fills automatically (§1.3).

### 1.3 The frame stretches its route child — ✅ **CLOSED** (2026-07-30)

**Contract:** a bare `<View>` or `<ScrollView>` at the top of a route fills the screen **without** the
consumer remembering `fill`. The shell's screen slot is a full-viewport flex column that stretches its
route child.

**Shipped:** `shell-layout.tsx` stamps `data-adaptv-screen` on the screen-frame element and
`styles/screen.css` carries the rule. `fill` is now an *inner-tree* convenience rather than a root
requirement, and `ScrollViewProps.fill` / `ViewProps.fill` say so.

```css
@layer adaptv.components {
  [data-adaptv-screen] > :only-child { flex: 1 1 0%; min-height: 0; }
}
```

**`:only-child`, not `> *`** — the delta as originally specced. Measured while implementing: a route
that renders several siblings would have every one of them stretch and fight under `> *`, and a
single-cell grid on the frame (the other candidate) stacks them on top of each other. `:only-child`
cannot silently rearrange an existing page, which is the property worth having; `screen-frame.spec.ts`
pins both halves.

**The open sub-question is answered: no shell prop.** A root that deliberately must not fill writes
`className="flex-none"`. That works with no new API and no `!important`, because the stretch lives in
`adaptv.components` and a Tailwind utility compiles into `utilities`, which outranks it — the layer
order (§6 of `docs/decisions/styling.md`) doing exactly the job it exists for. Also pinned in `screen-frame.spec.ts`,
with the caveat that Tailwind's JIT only emits a class it finds in the consumer's own source.

**What this removed:** apps were papering over the missing default with their own wrapper. The
playground's `Page` opened with `<View fill className="w-full">` around its `ScrollView`, and that div
measured as the *same box* as the frame it sat inside — same `flex flex-col`, same `flex-1`, same
`min-h-0`, same height. Both the wrapper and both `fill`s are gone.

### 1.4 Edge-to-edge is always on (opinionated)

Edge-to-edge is **not** a toggle. Every installed/native surface draws under the system bars; the shell
pads it back via safe-area. The consumer's granular control is **which edges a given surface pads**
(`View safe="…"`), never *whether* edge-to-edge happens. Rationale: a per-app "turn off edge-to-edge"
switch is exactly the kind of choice that lets the app feel wrong on some target — doctrine §1.

Native specifics (status-bar tint follows theme, overlay mode, the Android-15 risk) live in
`docs/design/behaviors.md §5` and `../research/capacitor-internals.md` (upstream issues to watch); this section owns only the *contract* that they implement.

### 1.5 Surface-1 acceptance (what "done" means, testably)

- [ ] `Screen` removed from the codebase; no consumer-facing reference; `screen.test.tsx` retired or
      re-pointed at `View`.
- [ ] A route whose root is a bare `<View>` (no `fill`) fills the viewport on all six targets.
- [ ] A `ScrollView`/`List` three levels deep in `View`s scrolls correctly (no `min-h-0` collapse) with
      no hand-rolled flex classes.
- [ ] `View safe="bottom" className="pb-0"` keeps the safe padding (structural win).
- [ ] Edge-to-edge holds with content under the status bar and the correct inset on installed targets.

---

## 2. Surface 2 — hybrid storage (the "adaptv kv")

One `storage` namespace, **three tiers**, each hiding its per-target backend behind a tier-2 API
(doctrine §2). Matches the shape `VISION.md §6` already uses (`storage.secure.set("token", jwt)`).

| Tier | API shape | Web / PWA backend | Native backend | For |
|---|---|---|---|---|
| `storage.kv` | **sync** + reactive hook | `localStorage` (sync, durable) | in-memory mirror ↔ `@capacitor/preferences` | flags, settings, small values read in render |
| `storage.store` | **async** + reactive hook | IndexedDB (Dexie) | IndexedDB (the WebView's) | large values, offline cache |
| `storage.secure` | **async**, no hook | best-effort `localStorage` | Keychain / Keystore | tokens, secrets |

Encoding is **per tier**: `kv` JSON-encodes into string storage, so its values must be
JSON-serializable; `secure` takes and returns strings only (§2.3) and stores them as given; `store`
keeps values by structured clone (§2.2). All tiers are **SSR-safe** (reads return
`undefined`/fallback on the server; hooks use a server snapshot, mirroring `useIsOffline`). `kv` and
`secure` prefix every key (`adaptv:kv:`, `adaptv:secure:`), and the `kv` prefix is what keeps its
`clear()` and cross-tab sync off the consumer's own `localStorage`; `store` needs no prefix because
it owns its own IndexedDB database (`adaptv-store`).

### 2.1 `storage.kv` — fast KV, **sync**, memory-backed

The MMKV model (decided over async-everywhere): reads never `await`, so a flag is readable during render.

```ts
storage.kv.get<T>(key): T | undefined
storage.kv.get<T>(key, fallback): T
storage.kv.set<T>(key, value): void
storage.kv.remove(key): void
storage.kv.clear(): void
const [seen, setSeen] = useKv("onboarded", false)   // reactive
```

**Mechanism (hybrid, one API):**
- Both targets read from an in-memory `Map` + a subscriber set (so same-process reactivity works — the
  browser `storage` event is cross-tab only, so an emitter is required on web too).
- **Web:** the Map hydrates **synchronously** from `localStorage` at module load (no boot gate). A write
  updates the Map, emits, and write-throughs to `localStorage` synchronously → **durable immediately, no
  lag on web.** A `storage` listener folds cross-tab writes back into the Map, and a whole-storage
  `localStorage.clear()` in another tab (a logout wipe) drops every key it took. sessionStorage raises the
  same event and is ignored, so a frame clearing its own never touches kv.
- **Native:** the Map hydrates from `@capacitor/preferences` (async) **at boot**, gated by the shell
  before first render (behind the splash — the shell already does eager init: keyboard listeners, theme;
  KV hydration joins it via an `initKv()`). A write updates the Map, emits, and fire-and-forget-persists
  to Preferences → **a ~1-tick durability lag exists only on native**; a hard crash in that window loses
  the last write. Anything that cannot tolerate that belongs in `store` or `secure` (both durable).
- `useKv` is `useSyncExternalStore(subscribe, snapshot, serverSnapshot)`. The Map holds the *parsed*
  value and only replaces it on `set`, so `map.get(key)` is referentially stable between renders (no
  `getSnapshot` thrash). Object fallbacks are applied in-hook via `useMemo` to stay stable.

### 2.2 `storage.store` — large / structured, **async**

```ts
await storage.store.get<T>(key): Promise<T | undefined>
await storage.store.set<T>(key, value): Promise<void>
await storage.store.remove(key): Promise<void>
const { data, isLoading } = useStore<T>(key)         // reactive, async-backed
```

Dexie over IndexedDB, on native the WebView's own IndexedDB. **Scope boundary (important):**
`store` is an **async large-value KV**, *not* a query engine / ORM. A real query layer (indexes,
where-clauses, migrations) is **consumer-owned** — `docs/design/rendering.md` already makes the data layer the
consumer's (client token + IndexedDB / TanStack Query persister). adaptv's job is to (a) provide the
simple async blob store for framework-level offline needs, and (b) guarantee the substrate exists and
offer the Query-persister wiring — **not** to grow into a database. This keeps adaptv from ballooning and
respects the consumer-wired-data doctrine.

> ### ✅ BUILT — and it deviates from the Dexie call above, deliberately
>
> `storage.store` ships on **raw IndexedDB, not Dexie**. Its tests run against a real IndexedDB
> implementation (`fake-indexeddb`) rather than a mock.
>
> **Why the deviation:** every reason to reach for Dexie — queries, indexes, schema migrations, live
> queries — is explicitly out of scope per the boundary stated directly above. What is left is
> `get`/`set`/`remove`/`keys`/`clear` over a single object store: about eighty lines against the
> platform API. Taking the dependency would make every consumer ship a query engine to get a blob KV,
> including the many that never touch this tier. **The scope boundary and the dependency choice have to
> agree**, and this is the option that agrees with it. If adaptv ever genuinely needs queries, that is a
> decision to revisit *with* Dexie — not a reason to pre-pay for it now.
>
> **Structured clone, not JSON** — `Date`, `Map`, `Set` and `Blob` survive a round trip. That is the
> substantive difference from `storage.kv`, which JSON-encodes and silently turns a `Date` into a
> string (a bug that surfaces much later, at the first `.getTime()`).
>
> **Degrades to memory** when IndexedDB is absent — SSR, Safari private mode, some embedded webviews.
> The framework's own offline path depends on this tier, so throwing there would turn missing storage
> into a boot failure. The same holds per key when IndexedDB is present but refuses a write (a quota
> overrun at commit): the value stays readable for the session instead of the read falling back to
> what the database held before. A write counts only once its transaction commits. `isPersistent()`
> reports which mode is in play, and turns `false` while any value lives only in memory.
>
> `useStore` has a loading state and `useKv` does not; that asymmetry is inherent, not an oversight —
> the backing store is genuinely asynchronous. Its reactivity is the same as `useKv`'s within a page:
> `subscribeStore` wakes every hook on the key after any `set`, `remove` or `clear`, and the hook
> re-reads. Other tabs are not observed (IndexedDB has no `storage` event).

### 2.3 `storage.secure` — secrets, **async**

```ts
await storage.secure.get(key): Promise<string | undefined>
await storage.secure.set(key, value): Promise<void>
await storage.secure.remove(key): Promise<void>
```

Strings only; no reactive hook (you don't watch a secret). **Hard platform truth, stated loudly:**
**there is no true secure storage on the web.** The web branch is best-effort `localStorage`; the
browser has no Keychain equivalent. The consumer's threat model must assume a web token is *not*
protected. On native it's Keychain (iOS) / Keystore (Android) via a maintained Capacitor secure-storage
plugin (plugin choice is a pinned dependency decision — see `docs/research/capacitor-internals.md`). This is where the
bearer token lives on native, consistent with `docs/design/rendering.md` (cookies don't work in a native WebView →
bearer tokens).

### 2.4 Surface-2 acceptance (testable)

- [ ] `storage.kv.get`/`set` are synchronous on every target; a value set then read returns immediately.
- [ ] On native, `initKv()` completes during boot (behind splash) before the app reads KV; a value
      written pre-background survives an app restart (persisted to Preferences).
- [ ] `useKv` re-renders a second component when a first component calls `set` (same-process reactivity).
- [ ] `storage.store` round-trips a large structured object async on web and native (IndexedDB on both).
- [ ] `storage.secure` round-trips a token on native (Keychain/Keystore); the web path works and is
      documented as best-effort, not secure.
- [ ] Every tier returns `undefined`/fallback under SSR without throwing.

---

## 3. Surface 3 — TanStack opacity

**Goal: opacity, not absence.** The consumer's source imports only `adaptv` and never sees `@tanstack/*`
or a `*.gen` file. Fully *eliminating* generated files is out of scope — TanStack Router's typesafety
rests on a generated route tree, and killing it means forking the type layer (violates doctrine §0.6's
"rent the stable core"). So the target is: the generated files still exist, but they're **hidden** and
the consumer's imports are **branch-free of TanStack**.

### 3.1 The consumer experience (target)

```tsx
// a route file — the ONLY router symbol, from adaptv, no @tanstack/* anywhere in the app
import { createFileRoute } from "adaptv"
export const Route = createFileRoute("/settings")({ component: Settings })
```

- No `@tanstack/react-router` import in app source. No `routeTree.gen.ts` beside the routes. No
  `router.tsx`/`client.tsx` unless the app deliberately ejects (§3.4).
- `adaptv` re-exports the whole router surface the consumer touches: `createFileRoute`, `createRootRoute`
  (adaptv's wrapped one, `create-root-route.tsx`), `Link` (adaptv's primitive), `Outlet`, `redirect`,
  `useRouter`, `useNavigate`, `useParams`, `useSearch`, `notFound`, … — typed identically.

> ### ✅ CORRECTED (2026-07-20) — most of `.adaptv/` was codegen used as tape
>
> An audit of what was actually in each generated file, prompted by the owner asking why they exist:
>
> | File | Was | Now |
> |---|---|---|
> | `routeTree.gen.ts` | TanStack's output, derived from the app's real route files | **kept** — legitimately generated |
> | `router.gen.tsx` | the whole `createRouter` call, including framework opinions (`notFoundMode`, history) | **thinned to a call** into `createAdaptvRouter` |
| `root.gen.tsx` | `createRootRoute(<config>)` + static imports of the app's screens — almost entirely framework code | **deleted** → `src/routes/root-route.tsx` in the package, with the app-specific half served as `virtual:adaptv/root-route` |
> | `sw.gen.ts` | 38 lines of **pure framework code**, byte-identical per app | **deleted** → `src/sw/default-worker.ts`, a real module |
> | `register.d.ts` | 9 lines, **zero** app-specific content | **deleted** → shipped as `@arrzdev/adaptv/route-globals` |
>
> **The principle that was being violated:** emitting a framework opinion into every consumer means
> changing it requires every app to rebuild before the change takes effect. That is not a generated
> file, it is a *distributed copy*. `notFoundMode: "root"` belongs in adaptv, not stamped into a repo.
>
> Generating a **service worker** per app is the clearest example — nothing in it varied except a render
> mode and a build tag, both of which are what build-time constants are for.
>
> **`.adaptv/` is now ONE file:**
>
> ```
> .adaptv/
>   routeTree.gen.ts   TanStack's output, derived from the app's real route files
> ```
>
> `router.gen.tsx` went too. The justification for keeping it — *"Start needs a module PATH exporting
> `getRouter`"* — was true but weak: the path does not have to be **in the consumer's tree**. It is now
> `src/routes/router-entry.tsx` in the package, reaching the app's two variable inputs through:
>
> - **`#adaptv-route-tree`** → aliased for the bundler *and* mapped in the app's `tsconfig.paths`. Both
>   are required: the route tree's concrete **type** must flow into the `Register` augmentation, and a
>   bundler-only alias builds fine while silently collapsing typed routing to `any`.
> - **`virtual:adaptv/router-config`** → the `createRouter` options. Values only, so no types needed.
>
> `stamp.ts` now generates nothing at all — it is pure project wiring (one `.gitignore` line, two
> tsconfig entries), all of it idempotent and applied to files the consumer owns.
>
> The root route is now resolved by the route DSL through `ADAPTV_ROOT_ROUTE_FILE`, computed as a
> relative path from the app's routes folder into the **installed package**. That path looks unlovely in
> the generated tree, but it is derived from the module's real resolved location rather than guessed
> from a package name — so it is correct under pnpm symlinks, hoisted `node_modules`, and workspace
> links alike.
>
> ### Config surface removed in the same pass
>
> - **`providers` thunk — deleted.** App-wide providers are a **layout route**: declare one in
>   `routerConfig` and wrap `<Outlet />`. That is the router's own composition model — it nests, it
>   scopes, and the providers sit where anyone reading the route tree can see them. A config thunk was a
>   second, weaker way to express the same thing. Verified in project-zero.
> - **`generatedRouteTree` — deleted.** It lived in `.adaptv/` and adaptv *already ignored* whatever the
>   consumer set. A config field that is silently overridden is worse than no field: it lies.
> - **`virtualRouteConfig` → `routerConfig`.** adaptv *always* uses the declarative route config; it is
>   the framework's opinion, not a mode the consumer selects, so the name should not leak TanStack's
>   "virtual file routes" implementation detail.

### 3.2 `.adaptv/` — the hidden generated dir

Everything the plugin stamps today at the app root (`router.gen`, and TanStack's `routeTree.gen.ts`)
moves into a single hidden, git-ignored `.adaptv/`:

```
.adaptv/
  routeTree.gen.ts     the generated route tree (relocated via router.generatedRouteTree)
  router.gen.tsx       the stamped router entry (already produced; just relocated)
  register.d.ts        the `declare module "@tanstack/react-router" { interface Register … }`
                       augmentation — typesafety preserved, just hidden
```

Wiring (both adaptv-generated, so the consumer writes neither):
- `tsconfig.json` `paths` + a Vite `resolve.alias` point the internal route imports at `.adaptv/`, and the
  tsconfig `include`s `.adaptv/register.d.ts` so inference lights up.
- `.adaptv/` is added to `.gitignore` and treated as a build artifact (regenerated on `dev`/`build`, like
  `dist/`).
- `router.generatedRouteTree` (already a config field) is pointed into `.adaptv/`; the plugin's existing
  `stampGeneratedFiles` step writes there instead of the app root — a relocation, not new machinery.

> ### ✅ BUILT — `.adaptv/` relocation (2026-07-20), verified against project-zero
>
> `src/vite/adaptv-dir.ts` owns the layout; `stamp.ts` writes there; the plugin points Start's
> `generatedRouteTree` and router `entry` at it; the `.gitignore` entry is appended idempotently so the
> consumer wires nothing.
>
> **Result in the real app:** `.adaptv/` holds `routeTree.gen.ts` + `router.gen.tsx`, and the app's `src/`
> tree contains **exactly one** generated file.
>
> **Correction to this section, found by building rather than reasoning:** the design listed
> `__root.gen.tsx` as relocatable. It is not. The virtual-file-routes config references it by a path
> *relative to `routesDirectory`*, and TanStack's generator walks that tree to find it — so it is a route
> file adaptv happens to author, not a build output. It stays beside the routes (gitignored there).
> Removing it from `.adaptv/` is a correctness fix, not a compromise.
>
> **Path-resolution trap, measured against Start 1.167.13:** BOTH the router `entry` and
> `generatedRouteTree` resolve relative to **`src/`**, not the app root. A root-relative path does not
> error — the generator silently writes to `src/<path>`, so the route tree lands where nothing imports it
> and the build fails much later with an unresolved-import error pointing at a different file.

> ### ✅ BUILT — the second dot-dir, `.tanstack/` (2026-07-26), verified in project-zero
>
> Relocating the *outputs* left the generator's **scratch** dir behind. TanStack's route generator
> writes each file to a temp path and renames it into place, and its temp dir defaults to
> `<cwd>/.tanstack/tmp` — so every app carried a second dot-directory at its root, from a package the
> consumer never installed, left behind **empty** after every run (every temp file is renamed away).
>
> No patch: upstream already reads `TSR_TMP_DIR`, and a resolved `router.tmpDir` takes precedence over
> it. adaptv sets **both** — `tmpDir` for the generator Start owns, the env var as the catch-all for the
> sibling plugins (autoimport, code-splitter, HMR) that each re-parse their *own* options object and
> would otherwise re-derive the default. Scratch lands in `.adaptv/tmp/router/`: namespaced under `tmp/`
> so it can never be mistaken for an output, and under a per-producer folder so the next generator that
> wants scratch space gets a sibling rather than a shared bucket.
>
> **Absolute, not relative** — measured, not assumed: `tmpDir` resolves against `process.cwd()`, ignoring
> the root passed to `getConfig()`. A relative value scatters scratch dirs wherever Vite is invoked from.
>
> **Nothing prunes a `.tanstack/` that an older adaptv already left behind.** The redirect only stops new
> ones appearing. A pruner shipped with it, guarded to delete nothing but an empty husk, and was removed
> on 2026-08-15 without a migration path (pre-alpha), so an app that still carries the empty directory
> deletes it once, by hand.

> ### ✅ FIXED — the route tree named TanStack for the whole of `dev` and `preview` (2026-07-26)
>
> The opacity repair (`src/vite/route-tree-opacity.ts`) rewrites the generated tree's `@tanstack/*`
> type imports and the generator's own attribution to adaptv. It was hooked into `closeBundle` —
> **which only fires in a build.** The route generator runs from `configResolved`, which fires in dev,
> preview and build alike. So `adaptv build` left a correct file, while `adaptv dev` and
> `adaptv preview` left one that read `import type { CreateFileRoute } from "@tanstack/react-router"`
> and "generated by TanStack Router" for the entire life of the process — and dev is exactly when
> someone opens `.adaptv/routeTree.gen.ts`. Reported from a real `adaptv preview` run, reproduced
> live, and reproduced again as a unit test.
>
> The repair now runs wherever a generation can happen: `buildStart` (so a build that dies early still
> leaves it clean), dev-server start **and every write the watcher reports** (dev regenerates on each
> route change), preview start, and `closeBundle` as before.
>
> **And a net underneath the enumeration.** "The repair runs in build and nowhere else" was itself the
> result of trusting a list of lifecycle hooks, so the plugin also arms an `fs.watch` on the generated
> tree — armed by whichever hook a mode reaches first, exactly once, `unref()`d. Whatever writes
> `@tanstack/*` into that file, in whatever mode, is repaired within milliseconds without anyone having
> had to predict the code path. It watches the **directory and the file**: the generator writes a temp
> file and `rename()`s it into place, which kills a file-only watch's inode (silently — the worst
> failure for a net), while a directory watch does not report in-place writes. Measured on macOS, not
> assumed.
>
> **Why it is a repair and not correct-by-generation, in a consumer install:** every upstream lever is
> closed. `routeTreeFileHeader` only *prepends* — the attribution line is appended after it; the router
> specifier is hardcoded in the target template; and the generator's `plugins` array, the one hook that
> could rewrite content before the write, is **overwritten** by Start, which hardcodes its own list.
> adaptv's `pnpm patch` closes all three, but pnpm cannot carry a library's `patchedDependencies` into
> a consumer's install (L20), so the patched path only ever applies inside this repo.
>
> **The repair restores the file's mtime** after writing. TanStack's generator uses mtime alone as its
> change signal (it drops a watch event matching its cache, and `safeFileWrite` throws `rerun` on an
> unexpected mtime), so an ordinary write reads as an outside edit and invites a force-rewrite. Two
> honest limits, both documented at the call site: `utimesSync` restores to filesystem precision rather
> than exactly, and it is defence in depth — measured, a live dev server holds one (mtime, content)
> state across 40 samples, and seeding the generator's own text back three times converges every time.

> ### ✅ FIXED — booting a second dev server reloaded every page the first one served (2026-09-13)
>
> The "one server holds one state" measurement above does not survive a second server in the same
> checkout. The generator writes the tree on every boot (its output never equals the repaired copy on
> disk), and the running server's watcher sees that rename. Measured with a page open on one server
> and one boot of another: 19 `full-reload` messages naming `routeTree.gen.ts`, and the two
> generators — each reading the other's mtime as an outside edit of its output — renamed the file 139
> times over 13 seconds, with the in-place repair caught half-written (a parse error in SSR). The
> watcher's `emit` now drops a change whose REPAIRED text equals the last one the server let through,
> before either HMR or the generator hears it, and the repair writes beside the tree and renames.
> Six boots afterwards: zero reloads and 13 repairs in total, against 246 for the one boot before; a
> genuinely different tree still reloads the page. → `ignoreUnchangedRouteTree` in `src/vite/route-tree-opacity.ts`

> ### ✅ FIXED — the tree LOCATED adaptv instead of naming it, and typed routing was dead (2026-08-07)
>
> Raised as a question about one line: `routeTree.gen.ts` held
> `import type { getRouter } from "../../../../src/routes/router-entry.tsx"`, which looks like it only
> works because the playground shares this repo. It is not repo-special — the playground installs adaptv
> like any consumer, and Node realpaths the link, so that path IS what a consumer gets, just pointed
> somewhere else: `../node_modules/.pnpm/@arrzdev+adaptv@0.1.0_<peerhash>/node_modules/@arrzdev/adaptv/…`.
> The file is regenerated every run, so it is never stale. It is worse than stale: it encodes one
> machine's node_modules layout, resolves to nothing under an install that keeps none on disk, and dies
> on the dist cutover, where `src/` is gone and `resolveEntry` is `required: true`.
>
> **Upstream cannot emit anything else.** `resolveEntry` prepends `./` to any specifier that is not
> already relative, so a bare package name is structurally impossible as `router.entry`; the root route
> reaches the generator through the virtual-route DSL, which is likewise path-shaped. So the finished
> tree is repaired, in the same pass as the `@tanstack/*` rewrite.
>
> **Matched by where an import RESOLVES, not by the name the generator gave it.** That is what makes
> ejection free: an app writing its own `src/router.tsx` or root layout keeps a path into its own tree,
> matches nothing, and is left verbatim — repointing it would bind `Register` to adaptv's `getRouter`
> instead of theirs. It also means a renamed upstream binding cannot silently switch the rewrite off.
>
> **A second one existed and nobody knew.** The net (`assertRouteTreeIsPortable`) failed the first real
> build on `./../../../../src/routes/root-route` — adaptv's root route, a **value** import, so unlike the
> type-only footer it is a runtime edge. Both are now named through `exports`
> (`@arrzdev/adaptv/router`, `@arrzdev/adaptv/root-route`); `import.meta.resolve` confirms the specifier
> and the old relative path are the same file, and the built bundles carry one copy.
>
> **The invariant is checked, not the fix.** "No relative import may reach an install directory" — which
> means outside the app root (a workspace link) *or* through `node_modules` (a normal install). The
> second rule exists because a test written against the first one passed on the pnpm path: it resolves
> *inside* the app, so a root check alone waves through the case every consumer actually has.
>
> **What the audit turned up on the way: typed routing had never worked.** Three `unknown`s in a row,
> each individually defensible, each silently widening `to:` to `string` — no autocomplete, no
> wrong-route error, and nothing to report because a widening is not a failure. In chain order:
>
> 1. `virtual-adaptv-router-config.d.ts` shipped an ambient `declare module "#adaptv-route-tree"`. TS
>    consults ambient modules **before** `paths`, so it shadowed the `.adaptv/routeTree.gen.ts` mapping
>    `stamp.ts` writes into the app — the mapping existed and was dead. Ambients are program-global;
>    `paths` is not. The framework's own build now uses a `paths` entry
>    (`src/routes/route-tree-stub.d.ts`), which cannot leak downstream.
> 2. `virtual-adaptv-root-route.d.ts` typed the root route `unknown` ("re-stating TanStack's shape here
>    would mean maintaining a copy"). True, and `ReturnType<typeof createRootRoute>` avoids the copy
>    without going opaque. The generated tree builds every route off that import, so an opaque root made
>    the whole tree opaque — invisibly, because the tree carries `@ts-nocheck` and the suppressed error
>    surfaces as `any` rather than a diagnostic.
> 3. `createAdaptvRouter` took `routeTree: unknown` and returned whatever `createRouter` inferred from an
>    `as never` argument — i.e. `AnyRoute`. The comment claimed "the route tree carries the real typing,
>    which is what `Register` binds". It did not. It is now generic over the tree, with the return type
>    restated because `as never` erases inference along with the argument.
>
> Measured on the playground before and after: `{ to: "/definitely-not-a-real-route" }` was accepted
> without complaint, and is now rejected against the union of all 40 real routes.
>
> **The same widening was waiting in `dist/`, for the cutover to walk into.** `getRouter`'s return
> type was INFERRED, and an inferred type has to be materialised when `dist/*.d.mts` is emitted — at
> which point the only route tree in reach is the framework's own stub. So the published types
> hardcoded `RouterCore<AnyRoute, …>`: correct from source, dead the day `exports` points at `dist/`.
> Naming it (`export type AdaptvRouter = ReturnType<typeof createAdaptvRouter<typeof routeTree>>`)
> keeps `#adaptv-route-tree` as a live import in the declaration file, so the app's stamped `paths`
> still decides what it means. Verified against a dist-shaped fixture — a fake published package, a
> consumer tsconfig, a marker type on the app's tree — and the marker reaches
> `ReturnType<typeof getRouter>["routeTree"]`.
>
> That leaves one import in the published types that is *supposed* to be unresolvable, which attw
> reports as a packaging bug. The fix is NOT a `#adaptv-route-tree` entry in the package's own
> `imports` map: measured, that resolves and the consumer's `paths` still wins, but an app whose
> mapping never got stamped would then silently fall back to `AnyRoute` instead of failing with
> "cannot find module" — trading the loud failure for the exact silent one this section is about. So
> `internal-resolution-error` is ignored for attw's exit code and **re-audited against an allow-list of
> one specifier**; anything else fails the build, named. Proved by injecting a bogus unresolvable
> import into `dist/` and watching it fail.

### 3.3 The one hard spot — generator symbol recognition (spike-gated)

TanStack's route generator matches route files by the `createFileRoute`/`createRootRoute` **identifier
imported from `@tanstack/react-router`**. If the consumer imports adaptv's *re-exported* `createFileRoute`,
the generator may not recognize the file. This is the single non-trivial decision, and it wants a
**prototype-both-and-measure spike**, not an armchair pick:

- **Option A — Virtual File Routes** (preferred to try first). `@tanstack/virtual-file-routes` is
  **already a dependency**, and `router.virtualRouteConfig` is already a config field. VFR lets adaptv
  *override the generation convention and relocate output* via a `__virtual.ts` config — the supported
  hook, no patching. If it can also satisfy the re-exported-symbol case, this is the whole answer.
- **Option B — `pnpm patch` `@tanstack/router-generator`** to teach it adaptv's re-exported symbol. A
  surgical, well-scoped patch (`../decisions/facade-and-opacity.md §5`), but a patch to maintain across upgrades — the fallback
  if VFR can't cover it.

Recommendation: spike A first; fall to B only if VFR can't recognize the re-exported symbol. Everything
*except* this recognition question (the `.adaptv/` relocation, the barrel, the tsconfig/alias, the
`register.d.ts`) is buildable today with no patch.

### 3.4 Ejection stays intact

The escape hatches already in the plugin survive: writing `src/router.tsx` or `src/client.tsx` opts the
app out of the stamped versions (the plugin checks `routerEjected`/`clientEjected`). Opacity is the
default, not a cage.

This is roadmap #1 — the biggest "feels like a real framework" win — and the mechanism is buildable, with
one spike-gated decision (§3.3).

---

## 4. Cross-cutting — the hybrid primitive contract

Every primitive and capability follows the same shape so the split is structural, not per-file
discipline (doctrine §2). The rule that makes it work — and the answer to "what does a native primitive
*return*" — is: **push the platform branch to the lowest layer.** The bottom accessor is the *only* place
that knows web-vs-native; everything above it (geometry, driver hooks, components, consumer code) is
platform-agnostic and identical on every target. The shipped `useKeyboard` → `useKeyboardAvoidance` →
`AvoidKeyboard` stack is the canonical example and the template for all primitives:

```
┌─ 1. Accessor / reader — the ONLY hybrid layer ─────────────────────────────┐
│  A subscribe/get accessor + a thin hook. THE web/native branch lives here.  │
│  Returns a reactive VALUE, not machinery.                                   │
│  useKeyboard → { isOpen, height, unpaidHeight, resizesLayoutViewport }      │
│    visualViewport/virtualKeyboard on web; exact OS height from              │
│    @capacitor/keyboard on native ("returns something native" =              │
│    native-accurate data, same shape). unpaidHeight = the part of height     │
│    the layout viewport has not already given up: height everywhere but      │
│    Android native, whose WebView shrinks by the keyboard itself.            │
│  siblings: useNetwork, useAppState (§COORDINATION), haptics, share, storage │
├─ 2. Headless driver hook — platform-AGNOSTIC ─────────────────────────────┤
│  Takes a containerRef in; returns applyable state out (+ runs imperative    │
│  effects on the ref). Built ONLY on layer-1 values + pure DOM-free geometry │
│  (resolveAvoidanceSpace / computeScrollIntoViewTop — unit-tested in isolation).│
│  useKeyboardAvoidance({containerRef}) → { space, behavior, isKeyboardOpen } │
├─ 3. Component — the ergonomic wrapper, platform-AGNOSTIC ──────────────────┤
│  Spreads layer-2 state as `style` + `data-*` styling hooks; owns className. │
│  <AvoidKeyboard> → applies `space` as padding/margin; exposes               │
│  data-keyboard-open / data-keyboard-height                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

**Layer 1 hands layer 2 the value it would otherwise branch for.** On Android native the WebView pays
for the keyboard itself: Capacitor 8's `SystemBars` pads it by the IME inset, so `innerHeight` drops by
the keyboard (PR #83, Pixel 10 emulator: 923 → 587 under a 336px keyboard) while the plugin still
reports the whole height. Layout against `innerHeight - height` would count the keyboard twice. So the
accessor (`capabilities/keyboard.ts`, through `useKeyboard`) also answers `unpaidHeight`, the part the
layout viewport has not already given up, from one app-wide rest height it keeps from boot, and
`resizesLayoutViewport`. `useKeyboardAvoidance` reads only those and never asks which platform it is on
(`keyboard-signal.md` §3).

### 4.1 🔒 Permission-gated capabilities: four states, and the accessor never rejects

Established while fixing the geolocation exemplar (**2026-07-20, built + tested**). Every
permission-gated capability uses this shape:

```ts
type Permission = "granted" | "denied" | "prompt" | "unavailable"
```

**`"unavailable"` is not a permission.** It means the capability cannot be used at all right now, so
prompting is pointless — and callers must branch on it *differently*: `"denied"` sends the user to
**app** settings; `"unavailable"` sends them to **system** settings, or nowhere if the platform simply
lacks the API. A three-state model silently collapses these and produces a "grant permission" button
that cannot work.

Concretely, the case that forced it: **`@capacitor/geolocation`'s `checkPermissions()` throws when
system location services are switched off** — a device state arriving through a permission-shaped API.

**Two rules follow, and they apply to every capability:**

1. **An accessor must never reject.** It returns state, including failure state. An accessor that throws
   pushes a `try/catch` into every call site — exactly the per-platform burden doctrine §0.2 exists to
   absorb.
2. **Distinguish "can't ask" from "haven't asked."** The web branch is the sharp case: a missing
   `navigator.geolocation` is `"unavailable"` (asking cannot help), but a missing
   `navigator.permissions` is `"prompt"` — older Safari/Firefox can *request* geolocation while being
   unable to *query* it. Collapsing those two strands the user on old browsers. The same gap means a
   refusal there is known only from the request's own code 1 rejection, so it answers `"denied"`; a
   re-read could only say `"prompt"` again and keep offering a prompt that never appears.

Consequences that become **rules** for every new primitive:
- **Reactive → hook, imperative → API** (`VISION.md §6`): one-shot reads are async fns; live watches are
  hooks over a `subscribe`/`get` accessor (so **non-React** consumers — the OTA updater, auth — can
  subscribe too, e.g. `useAppState`'s accessor drives the OTA check).
- **A primitive returns a _value_, never platform-specific machinery-to-attach.** The native-ness is
  native-*accurate data* surfaced by layer 1 (the real keyboard height, real reachability), consumed
  uniformly above. This is what lets the consumer — and adaptv's own mid-layers — stay branch-free.
- **Geometry/decisions are extracted DOM-free** (layer between 1 and 2) so they're pure-unit-testable
  and shared across targets. No primitive hides math inside an effect.
- A driver that must drive a DOM node takes a **`ref` in** (layer 2) rather than returning a props-bag —
  the component (layer 3) is where spreading happens.

---

## 5. What becomes a primitive — selection & sourcing

§4 says *how* a primitive is built. This says **which things earn one, in what order, and whether we
write it or wrap it.** It is the answer to `VISION.md §9`'s "which 8–10 primitives are the 80/20?"

### 5.1 Two independent reasons something becomes a primitive

**A. Forced — cross-platform divergence.** If correct behaviour requires a *different implementation
per target*, it must be a primitive. Otherwise every consumer writes the platform branch, and most will
write it wrong. `Drawer` is the archetype: native keyboard avoidance needs the Capacitor keyboard plugin
(real OS height, will-show/hide events, easing); web needs `visualViewport` heuristics. Same component,
two mechanisms, and **the consumer must never see the seam.**

> This is doctrine §0.2 and §0.5 restated as a *selection rule*: if the answer to "does the consumer
> have to know what platform they're on?" is yes, adaptv has failed and the thing belongs in the
> framework.

**B. Elective — it's a genuinely useful building block.** No divergence required. `View`'s `min-h-0`
safety, `Button`'s press physics, `List`'s virtualisation wrapper. These earn their place by being the
correct-by-construction version of something people otherwise get subtly wrong.

**A is obligatory; B is a judgement call.** When unsure about B, don't ship it — an unbuilt primitive
costs nothing, a wrong one is a permanent API.

### 5.2 🔒 Ship the whole ladder, not just the top rung

**A primitive is not one export.** Every layer of §4's stack is independently useful, so every layer is
independently exported:

```
useKeyboard()            → { isOpen, height, unpaidHeight, … }  ← the accessor. THE hybrid branch lives here.
useKeyboardAvoidance()   → { space, behavior }                  ← headless driver, platform-agnostic
<AvoidKeyboard>                                                 ← the ergonomic wrapper
```

The consumer picks their altitude. Someone building a bespoke chat composer takes `useKeyboard` and owns
the layout; someone who just wants a form that doesn't get covered takes `<AvoidKeyboard>`. **Both get
the cross-platform correctness, because it lives at the bottom.**

Exporting only the component is the common framework mistake — it forces an eject-to-nothing cliff the
moment a design doesn't fit. **Rule: if a primitive has a non-trivial hybrid layer, that layer ships as
a public hook.**

### 5.3 Demand signals — how to decide *what* to build next

Do not derive the roadmap from `VISION.md §3` alone. That's a catalogue of ~100 *problems*, not a
priority order, and treating it as a backlog is the scope risk that has under-resourced every comparable
project.

Three sources, all of which are **filtered demand** — someone already paid to discover these are real:

| Signal | Reads as | Caveat |
|---|---|---|
| **Ionic's component list** | 10 years of "the community asked for this" | Some is Ionic-specific ceremony (`ion-content`); some is stale (MD2) |
| **React Native / Expo's API surface** | the same, for the native-first audience | RN solves some things adaptv gets free from the DOM |
| **Popular Capacitor / Ionic / Expo packages** | what people actually install to fill gaps | **A popular package is a gap in the framework** — that's the strongest signal on this list |

That last row is the sharpest tool: *if thousands of apps install a package to do X, X is missing.*

**These tell you _what_. `docs/decisions/prior-art.md` tells you _how_** — it's the ported implementation detail
(gesture arbitration, the input shims, the back-button chain), not the selection question. Two distinct
uses of the same prior art; don't conflate them.

### 5.4 🔒 Wrap by default — but popularity is not health

Doctrine §0.6 says don't reinvent the solved. Applied to third-party libs: **default to wrapping a
battle-tested one**, and treat writing our own as the thing that needs justification.

**⚠︎ But download count is the *worst* available health signal**, because it's dominated by inertia and
transitive deps. Two verified examples, both of which look like obvious "approved" picks:

| Library | Downloads | Reality |
|---|---|---|
| **`vaul`** (drawers) | 37M/week | **Dead.** README says unmaintained (2025-10); npm `latest` is **Dec 2024**; fixes merged to `main` in Jul 2025 were never published. Its open bugs are exactly the iOS/nested/keyboard class adaptv cares about. |
| **`@use-gesture/react`** | 5.6M/week | **~2 years dormant**, no deprecation notice, crash fixes unmerged, broken against its own sibling `react-spring` v10. |

Both would have passed a "is it popular?" test. Neither survives a health check.

**The check, before adopting anything:**
1. **Last publish date** — and whether `main` has unpublished commits (vaul's tell).
2. **Open-issue ratio vs stars**, and whether the *open* ones are in your use case.
3. **What the maintainer says** — an unmaintained notice in a README outranks any metric.
4. **Does it work on all six targets**, or silently only on web?

### 5.5 🔒 "Don't depend on it" ≠ "ignore it" — dead libraries are prime source material

**Health decides whether you can `npm install` it. It says nothing about whether the code is worth
reading.** These are independent questions and collapsing them throws away the most valuable thing a
dormant library has: *someone already fought every edge case, and the fixes are sitting there in the
diff history.*

A frozen library is arguably **better** to read than a live one — no churn, and every hard-won
workaround is visible and stable.

**So there are three verdicts, not two:**

| Verdict | Means | Health matters? |
|---|---|---|
| ✅ **Wrap** | take the dependency | **yes — decisive** |
| 📖 **Read / port** | study the source, take the technique, attribute it | **no** |
| ⛔ **Ignore** | nothing to learn | n/a |

`vaul` and `@use-gesture` are **📖, not ⛔.** Don't depend on them; absolutely do read them.

#### The worked example is already in this repo

`src/components/drawer/` is the proof, and its history is the pattern: **started as vaul → patched and
fixed on top → migrated to fully custom.** vaul is *not* a dependency today; what survives is the
hard-won tuning, and the source already documents it —

```ts
/**
 * Tuning mirrors [vaul](https://github.com/emilkowalski/vaul/blob/3e97aac6a38e4481bade71d7233ed6002e80f9b0/src/constants.ts)
 * + its `helpers.ts`, the feel we settled on while drafting.
 */
// …and inline: "vaul: moved upwards — reset, don't close"
//              "@see vaul `dampenValue` in helpers.ts"
```

That is exactly the convention `docs/decisions/prior-art.md §0` prescribes for the Ionic port, arrived at independently
— which is a good sign it's the right one. **Generalise it: "we outgrew this library" is the expected
end state of a wrap, not a failure of one.** Wrap to learn the shape, then own it when the divergence
demands more than the library was built for.

**⚠︎ Two gaps to close on the existing attribution** (`docs/decisions/register.md` B27):

1. **The links point at `main`, not a pinned SHA.** `docs/decisions/prior-art.md §0` is explicit — a `main` link rots,
   and the reader loses the ability to diff what changed. Repin them.
2. **There is no `THIRD_PARTY_LICENSES`.** vaul is MIT. The current references look like
   technique-and-constant sourcing rather than substantial copying, so the notice requirement is
   arguably not triggered — but the file costs nothing, removes the ambiguity permanently, and is
   already required for the upcoming Ionic port anyway.

### 5.6 Current standing verdicts

From the research pass — re-check health before relying on the ✅ row.

- ✅ **Wrap:** `motion` (12.42.2, active — its engine only, driven imperatively; no motion component or provider around app content; `docs/decisions/animation.md` §3.1),
  `@tanstack/react-virtual`, `embla-carousel` (pin 8.x), `vite-plugin-pwa`.
- 📖 **Read, don't depend:** **`vaul`** (dead, but the sheet physics/snap-point/nested-scroll
  arbitration are the reference — and adaptv's `Drawer` already descends from it), **`@use-gesture`**
  (dormant, still instructive on pointer normalisation), **Ionic** (`docs/decisions/prior-art.md` — the whole port
  list), **Framework7** (alive, one-maintainer — closest prior art for web-first native-feel UI).
- 🔨 **Must build, nothing exists:** **keyboard-aware layout.** Verified — npm has no credible
  cross-platform option; everything is React Native (`react-native-keyboard-controller`) or a raw native
  shell (`@capacitor/keyboard`). Everyone hand-rolls it. Clearest differentiator available, and it's
  already `useKeyboard`'s job.
- 📖 **Port, don't wrap:** gesture *arbitration*. `motion`'s `drag` covers ~80%; the single-winner
  controller that stops a drawer drag, a swipeable row and a scroll from fighting has no standalone
  library — Ionic's is the reference. → `docs/decisions/prior-art.md §3`.

---

## 6. Where this doc sits

- `VISION.md` — the north star and principles. **§2 principle 4 is revised by §0.4 here.**
- `docs/design/lifecycle.md` — how these contracts get built, shipped, and updated (config → build → deploy → OTA →
  CLI). The hybrid split above is what its two build lineages compile.
- `docs/design/coordination.md` — the runtime lifecycle spine (app state, back, gestures, routes) that leaf primitives
  compose onto; consumes the §4 accessor pattern (`useAppState`).
- `docs/design/rendering.md` — the isomorphism boundary (no `createServerFn` on any target); Surface 3 respects it.
- `docs/design/behaviors.md` — the per-fix catalogue that the contracts here implement.
- [`../decisions/prior-art.md`](../decisions/prior-art.md) — what Ionic already solved, ranked, plus the attribution convention.
- [`../research/capacitor-internals.md`](../research/capacitor-internals.md) — version pins, native gotchas, and the upstream issues to re-check before any version bump.
