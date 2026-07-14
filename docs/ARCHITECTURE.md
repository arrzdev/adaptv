# nativ — architecture & the cross-platform contracts

> The **higher-up design**: the contracts the whole framework hangs off, decided before the leaf-level
> primitives so the leaves compose onto them. Where `VISION.md` is the north star and `BEHAVIORS.md` is
> the catalogue of fixes, **this doc is the load-bearing structure**: the shell, the frame, storage, and
> the seam that keeps TanStack invisible.
>
> Doctrine, not a changelog. Each section states the **contract**, what **already holds** in the code
> today, and the **delta** to close. Started **2026-07-14**.

---

## 0. Doctrine (the non-negotiables)

These govern every decision below. They are deliberately more opinionated than a general-purpose UI kit —
that opinion **is** the product.

1. **Opinionated by default; granular control only where it genuinely belongs to the developer.** nativ
   makes the app-lifecycle and cross-platform engineering calls. The consumer configures intent in
   `nativ.config.ts`, not mechanism. A framework that lets you choose the wrong thing can't guarantee the
   app feels right — that guarantee is the whole value.
2. **Everything exported abstracts the hybrid heavy-lifting.** Every public API hands the consumer a
   **tier-2** simple surface and hides the `isNativePlatform()` branch underneath. The consumer never
   writes a per-platform branch to get correct behavior; that is nativ's job, structurally.
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
   these for years. Study their solution and their open issues (`RESEARCH.md`), adopt the hard-won edge
   cases, and diverge only where nativ's model genuinely differs. Rent the stable core; own the seam.

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
│  Target: a first-party @nativ/shell Capacitor plugin owning this in one     │
│  native module, hardened against the Android-15/SDK-35 inset+keyboard       │
│  breakage (RESEARCH.md §3, HIGH RISK). Roadmap #2.                          │
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
frame comes from the *navigator above the route*, and `View` just fills it. nativ already has that
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
  tailwind-merge's padding groups — `BEHAVIORS.md §6`). Resolves to `0` in a browser tab, the real inset
  when installed/native.
- **Behavior is props (`row`/`center`/`fill`/`safe`); look is `className`.** Unchanged from today.

`Screen` is **removed**. It was never in the public barrel (`components/index.ts`) and its class contract
(`flex min-h-0 w-full flex-1 flex-col`) is exactly `View fill` (the `w-full` is redundant under a
flex-col parent's default `align-stretch`). Static full-screen surfaces (404, empty states, rotate
prompt) use a plain `<View>` at the route root — it fills automatically (§1.3).

### 1.3 The frame stretches its route child — the delta to close

**Contract:** a bare `<View>` at the top of a route fills the screen **without** the consumer remembering
`fill`. The shell's screen slot is a full-viewport flex column that stretches its direct child.

**Today:** `AppShell` renders the frame — an outer `div[data-app-shell]` (`h-dvh flex flex-col
overflow-hidden`) and an inner screen-frame `div` (`flex-1 flex-col min-h-0 overflow-hidden`) — and the
route's `<Outlet/>` renders inside it (`shell-layout.tsx`). But the frame does **not** stretch its direct
child, so a route whose root `<View>` omits `fill` collapses to content height.

**Delta:** the screen-frame element stretches its direct child via a CSS child rule, e.g.

```css
[data-nativ-screen] > * { flex: 1 1 0%; min-height: 0; }
```

so the root `View` (or any root element) fills for free, and `fill` becomes an *inner-tree* convenience
rather than a root requirement. This is the last mechanical piece of "the shell owns the frame."

> **Open sub-question:** apply the stretch to the *direct child only* (clean, predictable) vs. exposing a
> shell prop for routes that deliberately want a non-filling root (rare). Leaning direct-child-only;
> a non-filling root can wrap in `<View className="flex-none">`.

### 1.4 Edge-to-edge is always on (opinionated)

Edge-to-edge is **not** a toggle. Every installed/native surface draws under the system bars; the shell
pads it back via safe-area. The consumer's granular control is **which edges a given surface pads**
(`View safe="…"`), never *whether* edge-to-edge happens. Rationale: a per-app "turn off edge-to-edge"
switch is exactly the kind of choice that lets the app feel wrong on some target — doctrine §1.

Native specifics (status-bar tint follows theme, overlay mode, the Android-15 risk) live in
`BEHAVIORS.md §5` and `RESEARCH.md §3`; this section owns only the *contract* that they implement.

### 1.5 Surface-1 acceptance (what "done" means, testably)

- [ ] `Screen` removed from the codebase; no consumer-facing reference; `screen.test.tsx` retired or
      re-pointed at `View`.
- [ ] A route whose root is a bare `<View>` (no `fill`) fills the viewport on all six targets.
- [ ] A `ScrollView`/`List` three levels deep in `View`s scrolls correctly (no `min-h-0` collapse) with
      no hand-rolled flex classes.
- [ ] `View safe="bottom" className="pb-0"` keeps the safe padding (structural win).
- [ ] Edge-to-edge holds with content under the status bar and the correct inset on installed targets.

---

## 2. Surface 2 — hybrid storage (the "nativ kv")

One `storage` namespace, **three tiers**, each hiding its per-target backend behind a tier-2 API
(doctrine §2). Matches the shape `VISION.md §6` already uses (`storage.secure.set("token", jwt)`).

| Tier | API shape | Web / PWA backend | Native backend | For |
|---|---|---|---|---|
| `storage.kv` | **sync** + reactive hook | `localStorage` (sync, durable) | in-memory mirror ↔ `@capacitor/preferences` | flags, settings, small values read in render |
| `storage.store` | **async** + reactive hook | IndexedDB (Dexie) | SQLite / Filesystem | large values, offline cache |
| `storage.secure` | **async**, no hook | best-effort `localStorage` | Keychain / Keystore | tokens, secrets |

All backends store **strings**; nativ JSON-encodes/decodes, so values must be JSON-serializable. All
tiers are **SSR-safe** (reads return `undefined`/fallback on the server; hooks use a server snapshot,
mirroring `useNetworkStatus`). nativ-managed keys carry a stable prefix so `clear()` and cross-tab sync
never touch the consumer's own `localStorage`.

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
  lag on web.** A `storage` listener folds cross-tab writes back into the Map.
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

Dexie over IndexedDB (web) / SQLite table or Filesystem (native). **Scope boundary (important):**
`store` is an **async large-value KV**, *not* a query engine / ORM. A real query layer (indexes,
where-clauses, migrations) is **consumer-owned** — `RENDERING.md` already makes the data layer the
consumer's (client token + IndexedDB / TanStack Query persister). nativ's job is to (a) provide the
simple async blob store for framework-level offline needs, and (b) guarantee the substrate exists and
offer the Query-persister wiring — **not** to grow into a database. This keeps nativ from ballooning and
respects the consumer-wired-data doctrine.

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
plugin (plugin choice is a pinned dependency decision — see `capacitor-internals.md`). This is where the
bearer token lives on native, consistent with `RENDERING.md` (cookies don't work in a native WebView →
bearer tokens).

### 2.4 Surface-2 acceptance (testable)

- [ ] `storage.kv.get`/`set` are synchronous on every target; a value set then read returns immediately.
- [ ] On native, `initKv()` completes during boot (behind splash) before the app reads KV; a value
      written pre-background survives an app restart (persisted to Preferences).
- [ ] `useKv` re-renders a second component when a first component calls `set` (same-process reactivity).
- [ ] `storage.store` round-trips a large structured object async on web (IndexedDB) and native (SQLite).
- [ ] `storage.secure` round-trips a token on native (Keychain/Keystore); the web path works and is
      documented as best-effort, not secure.
- [ ] Every tier returns `undefined`/fallback under SSR without throwing.

---

## 3. Surface 3 — TanStack opacity

**Goal: opacity, not absence.** The consumer's source imports only `nativ` and never sees `@tanstack/*`
or a `*.gen` file. Fully *eliminating* generated files is out of scope — TanStack Router's typesafety
rests on a generated route tree, and killing it means forking the type layer (violates doctrine §0.6's
"rent the stable core"). So the target is: the generated files still exist, but they're **hidden** and
the consumer's imports are **branch-free of TanStack**.

### 3.1 The consumer experience (target)

```tsx
// a route file — the ONLY router symbol, from nativ, no @tanstack/* anywhere in the app
import { createFileRoute } from "nativ"
export const Route = createFileRoute("/settings")({ component: Settings })
```

- No `@tanstack/react-router` import in app source. No `routeTree.gen.ts` beside the routes. No
  `router.tsx`/`client.tsx` unless the app deliberately ejects (§3.4).
- `nativ` re-exports the whole router surface the consumer touches: `createFileRoute`, `createRootRoute`
  (nativ's wrapped one, `create-root-route.tsx`), `Link` (nativ's primitive), `Outlet`, `redirect`,
  `useRouter`, `useNavigate`, `useParams`, `useSearch`, `notFound`, … — typed identically.

### 3.2 `.nativ/` — the hidden generated dir

Everything the plugin stamps today at the app root (`router.gen`, and TanStack's `routeTree.gen.ts`)
moves into a single hidden, git-ignored `.nativ/`:

```
.nativ/
  routeTree.gen.ts     the generated route tree (relocated via router.generatedRouteTree)
  router.gen.tsx       the stamped router entry (already produced; just relocated)
  register.d.ts        the `declare module "@tanstack/react-router" { interface Register … }`
                       augmentation — typesafety preserved, just hidden
```

Wiring (both nativ-generated, so the consumer writes neither):
- `tsconfig.json` `paths` + a Vite `resolve.alias` point the internal route imports at `.nativ/`, and the
  tsconfig `include`s `.nativ/register.d.ts` so inference lights up.
- `.nativ/` is added to `.gitignore` and treated as a build artifact (regenerated on `dev`/`build`, like
  `dist/`).
- `router.generatedRouteTree` (already a config field) is pointed into `.nativ/`; the plugin's existing
  `stampGeneratedFiles` step writes there instead of the app root — a relocation, not new machinery.

### 3.3 The one hard spot — generator symbol recognition (spike-gated)

TanStack's route generator matches route files by the `createFileRoute`/`createRootRoute` **identifier
imported from `@tanstack/react-router`**. If the consumer imports nativ's *re-exported* `createFileRoute`,
the generator may not recognize the file. This is the single non-trivial decision, and it wants a
**prototype-both-and-measure spike**, not an armchair pick:

- **Option A — Virtual File Routes** (preferred to try first). `@tanstack/virtual-file-routes` is
  **already a dependency**, and `router.virtualRouteConfig` is already a config field. VFR lets nativ
  *override the generation convention and relocate output* via a `__virtual.ts` config — the supported
  hook, no patching. If it can also satisfy the re-exported-symbol case, this is the whole answer.
- **Option B — `pnpm patch` `@tanstack/router-generator`** to teach it nativ's re-exported symbol. A
  surgical, well-scoped patch (`RESEARCH.md §2`), but a patch to maintain across upgrades — the fallback
  if VFR can't cover it.

Recommendation: spike A first; fall to B only if VFR can't recognize the re-exported symbol. Everything
*except* this recognition question (the `.nativ/` relocation, the barrel, the tsconfig/alias, the
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
│  useKeyboard  → { isOpen, height }   (visualViewport/virtualKeyboard on web;│
│                                       exact OS height from @capacitor/keyboard│
│                                       on native — "returns something native" │
│                                       = native-accurate data, same shape)   │
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

Consequences that become **rules** for every new primitive:
- **Reactive → hook, imperative → API** (`VISION.md §6`): one-shot reads are async fns; live watches are
  hooks over a `subscribe`/`get` accessor (so **non-React** consumers — the OTA updater, auth — can
  subscribe too, e.g. `useAppState`'s accessor drives the OTA check).
- **A primitive returns a _value_, never platform-specific machinery-to-attach.** The native-ness is
  native-*accurate data* surfaced by layer 1 (the real keyboard height, real reachability), consumed
  uniformly above. This is what lets the consumer — and nativ's own mid-layers — stay branch-free.
- **Geometry/decisions are extracted DOM-free** (layer between 1 and 2) so they're pure-unit-testable
  and shared across targets. No primitive hides math inside an effect.
- A driver that must drive a DOM node takes a **`ref` in** (layer 2) rather than returning a props-bag —
  the component (layer 3) is where spreading happens.

---

## 5. Where this doc sits

- `VISION.md` — the north star and principles. **§2 principle 4 is revised by §0.4 here.**
- `LIFECYCLE.md` — how these contracts get built, shipped, and updated (config → build → deploy → OTA →
  CLI). The hybrid split above is what its two build lineages compile.
- `COORDINATION.md` — the runtime lifecycle spine (app state, back, gestures, routes) that leaf primitives
  compose onto; consumes the §4 accessor pattern (`useAppState`).
- `RENDERING.md` — the isomorphism boundary (no `createServerFn`); Surface 3 respects it.
- `BEHAVIORS.md` — the per-fix catalogue that the contracts here implement.
- `RESEARCH.md` — prior art + upstream issues to study before building any of the above.
