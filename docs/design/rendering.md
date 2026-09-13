# adaptv — rendering, delivery & the isomorphism boundary

> The contract that lets **one codebase** run correctly as SSR web, standalone PWA, and a native
> Capacitor app. Captures *why* the boundaries are where they are, and the **hard limitation** that
> falls out of it: adaptv code must be **isomorphic** — no server-only logic (`createServerFn`, server
> routes, request/cookie reads) if you want it to run on all targets.
>
> Locked understanding as of 2026-07-14. Pairs with `VISION.md` §"Build, distribution & updates" and
> §"Data, offline & storage". This is doctrine, not a changelog.

---

## 1. The two facts

1. **Capacitor → must be a static SPA.** The WebView loads a static `index.html` from the on-device
   bundle. There is **no server in the app**, so nothing can server-render and no server function can
   be called. This is why adaptv forces `render:"spa"` and no service worker for the capacitor target.
2. **Web + standalone → SSR is fine (and the default).** A standalone PWA is just the installed web
   app; it loads over the network (or the SW cache) from the same SSR server. **Only Capacitor needs
   the SPA build.** Web can be SSR *or* SPA — a per-app config choice, SSR by default.

**Nuance that matters:** SSR only buys you the **first paint** (FCP / SEO / instant initial HTML).
After hydration, TanStack Router navigates **client-side on every target** — so repeat navigations are
already SPA-fast regardless of SSR vs SPA. SSR-default is a quality-of-life choice; for an *installed*
app it does little beyond the very first load.

### Per-target build matrix

| Target | Build | Server render | Service worker | Delivery / update |
|---|---|---|---|---|
| Desktop web | SSR (default) or SPA | yes (SSR) | adaptv-owned | SW revalidate |
| Standalone PWA | same as web | yes (SSR) | adaptv-owned | SW revalidate |
| Native iOS/Android | **SPA (forced)** | **no** | **off** | live-update bundle swap |

---

## 2. The isomorphism boundary (the hard limitation)

The single misconception to kill: **`loader` and `beforeLoad` are TanStack _Router_ features, not SSR
features.** They run isomorphically.

| | SSR web (initial request) | client nav / SPA / Capacitor |
|---|---|---|
| `loader` | runs on the server | runs in the browser |
| `beforeLoad` | runs on the server | runs in the browser |

In a pure SPA/Capacitor build they run **entirely client-side** and work perfectly — `beforeLoad` for
auth guards/redirects, `loader` for "have this data before the route paints." **Use them freely.**

What actually breaks cross-platform is **server-only logic**, not loaders:

### ✅ Allowed everywhere (isomorphic)
- `loader` / `beforeLoad` that only do isomorphic work: `fetch()` an **absolute** backend URL, read
  IndexedDB / localStorage, compute, redirect.
- Client-side auth guards in `beforeLoad`.
- TanStack Query (fetch in components), with an optional IndexedDB persister for offline.
- Anything that runs the same in a browser tab and in a WebView.

### ❌ Forbidden if the code must reach Capacitor
- **`createServerFn()`** — compiles to an RPC to the app's *own* server. No server in a static bundle
  → dead. **This is the headline limitation.**
- **Server routes / API routes** (`createServerFileRoute`, Start server handlers).
- **Server-only request context** — reading request headers/cookies server-side, `setResponseHeaders`,
  server env, etc.
- Any `loader` / `beforeLoad` that *calls* one of the above.

**The rule:** keep loaders **isomorphic** (absolute-URL fetch or local read) and the same code runs on
the SSR server, the browser, and the Capacitor WebView. Ban *server-only calls*, not loaders.

### Why this app leans client-side anyway
Auth here is a **client-held bearer token** (cookies don't work in a native WebView). A server-side
loader can't see that token, so server-side data fetching is limited regardless of SSR. Hence the clean
pattern for a client-auth, offline-first app:
- **Data → TanStack Query in components** (+ IndexedDB persister for offline).
- **`beforeLoad` → client-side guards only.**
- Mental model: **"a page is the shell + logic; data comes from a source the consumer wires"** (remote
  via absolute URL, and/or offline-first local store). The consumer owns the data layer entirely.

---

## 3. Delivery — adaptv owns the service worker

> **Resolved 2026-07-20.** This section previously said "precache assets + a navigation-fallback to
> the app shell" while `src/sw/` implemented NetworkFirst-on-documents + install-time route warming.
> Those are different architectures. The decision below supersedes both.

**"Cache every page" is the wrong framing.** You don't cache page *HTML*; you precache the **JS/CSS
route chunks** (Workbox precache manifest — adaptv builds this). Combined with client-side routing +
`defaultPreload:"viewport"`, every route is instantly available offline **without** caching documents.

> ### 🔒 The worker is core, not configuration (2026-08-08)
>
> **There is no `sw` key, no `web.sw` block, and no way to turn the worker off.**
>
> The reason is not tidiness. Precaching every route chunk is *what makes a web build navigate like the
> native one* — it is the product, not a feature of it. An app that could switch it off, or narrow it, or
> point it at a hand-written worker, would silently stop being the thing adaptv ships. So adaptv
> registers exactly one worker, always, on web and standalone; the single exception is the Capacitor
> target (§3.5), and that comes from the **target**, never from a key.
>
> This also retires the "app-authored worker" escape hatch, deliberately. It is how chopchop's copy was
> still calling `registerInstallRouteWarmer` long after that became the B25 privacy bug: a worker that
> restates the delivery contract in a lower-level vocabulary drifts, and cannot be fixed by upgrading the
> framework. `src/interface/sw.index.ts` no longer exports `setupPrecache`, `registerNavigationRoute`,
> `registerStaticAssetsRoute` or `registerServiceWorkerLifecycle`, so "adaptv owns delivery" is now a
> property of the package rather than a rule in this document.
>
> **What an app contributes instead** — behaviour the framework has no opinion about:
>
> ```ts
> // adaptv.config.ts
> serviceWorkers: ["./src/sw/push.ts"]
> ```
>
> Each file is bundled into adaptv's worker and evaluated **after** its setup. Workbox returns the first
> matching route and adaptv registers first, so an app module can add handlers (push, background sync, a
> runtime cache for its own API via `cacheRoute`) but cannot take delivery away from the framework. The
> worker side talks to React with `sendToApp` / `onAppMessage`; the app side reads it with
> `useServiceWorkerMessage()`. No app ever writes registration code.
>
> Same principle as the splash screen, the offline component and the root route: **the consumer declares
> intent, adaptv writes the machinery.** The difference here is that there is no lower gear to drop into.

> ### ✅ BUILT — adaptv generates the app shell (2026-07-20)
>
> The app shell is now emitted into `dist/client` by `adaptvShellEmitPlugin` from `renderAppShell`.
> **Verified in project-zero**, and it unblocked both features that were waiting on it: a `render: "spa"`
> build now writes `index.html`/`404.html`/`.nojekyll`/`_redirects`, and the SSR precache fallback finally
> has a real file to bind to.
>
> **Amended 2026-08-09:** the filename depends on the render mode — `index.html` for SPA,
> `adaptv-shell.html` for SSR — because `index.html` is a directory index and asset-first hosts served it
> instead of running the server. See §3.3.
>
> **Measured, and it corrects an assumption:** TanStack Start emits **no HTML at all** in this
> configuration — not `_shell.html`, not `index.html`, even with `spa: { enabled: true }`. So "copy
> Start's shell" was never a foundation. `docs/design/rendering.md §3.1.2`'s requirement that adaptv *generate* one
> is load-bearing.
>
> **Generated, never captured.** The shortcut — render a page at build time and save the HTML — is wrong
> in a way that only surfaces in production: a captured document is whatever the server rendered *for
> whoever ran the build* (their session, locale, flags), and it then gets precached and served to
> everyone. Generating makes user-agnosticism structural rather than a rule someone has to remember.
>
> The shell carries the pre-paint platform + theme stamps, inlined critical CSS, the hashed stylesheet
> and entry, and an empty `#root`. Asset names come from Vite's manifest (the plugin turns
> `build.manifest` on), so they track content hashes.
>
> **One structural fix this forced:** `getUiThemeInitScript` lived in `hooks/use-theme.ts`, which imports
> React and transitively the Capacitor native-theme accessor. A Node-side Vite plugin cannot import
> that. The pure generator now lives in `shell/theme-init-script.ts` with no React, re-exported from
> `use-theme` so runtime call sites are unchanged — config-time and runtime share one implementation
> without sharing a dependency graph.

### 3.0 🔒 The doctrine — mechanisms live at the JS layer, not in the platform config

The SW is a **delivery mechanism, not a place where product behaviour lives.** Anything a user can
*see* belongs in React, where it is styleable, testable, themeable, i18n-able, and identical on all six
targets. The SW's only job is to get the app booted; from that point the app decides everything.

This is the same move adaptv already made for the splash screen, and it should be read as one pattern:

| Concern | Dumb platform layer | Real behaviour |
|---|---|---|
| Splash | native launch screen = a flat colour mask | `splashScreen` React component, self-unmounting |
| **Offline** | **SW serves a bootable shell** | **an offline UI component rendered by the failing route** |
| Insets | plugin reports raw numbers | `View safe=…` |

**Consequence: there is no `offline.html`.** A separate static HTML file would have its own markup, its
own styling, no access to the design system, no theme awareness, no safe-area handling, and would drift
from the app forever. And it could only ever exist on web — the native target has no SW to serve it, so
the same product behaviour would need a second implementation. That is exactly backwards.

**And there is no `/offline` *route* either — the offline UI renders _in place_.** Navigating away is
the wrong move, for the same reason error boundaries render where the failure happened instead of
redirecting:

| | Redirect to `/offline` | Render offline UI in place |
|---|---|---|
| URL | destroyed — `/product/xxx` → `/offline` | preserved |
| Route params | lost, so retry can't reconstruct the request | intact |
| Recovery | user must navigate back manually | route re-runs its own loader/query and swaps to real content |
| Back button | extra history entry, or a trap on refresh | untouched |
| Scroll / layout chrome | discarded | preserved |
| Granularity | one global offline screen | per-route — a product page can show cached data with a banner, checkout can hard-block |

### 3.1 🔒 The navigation strategy is a pure function of `render`

| `render` | Navigation handling | Why |
|---|---|---|
| `"ssr"` | `serveNavigation` — preload-or-network, 3s deadline, then the precached shell | Preserve the per-request server render on **every** online navigation. The fallback is a build-time, **user-agnostic** shell whose only job is to boot the client router at `location.pathname`. **The deadline is not optional:** without one the navigation falls back on network *error* only, so a live-but-terrible connection hangs the cold load indefinitely while a good shell sits in the precache. It costs nothing in privacy terms — there is no cache-write path at all, so the fallback is always the generated shell, never a page someone else's session produced. Written out rather than configured because it has to read `event.preloadResponse`, which no Workbox strategy does — §3.3. |
| `"spa"` | `NavigationRoute(createHandlerBoundToURL(appShell))` | There is no per-request render to preserve — the classic app shell is correct. |
| `capacitor` | **no SW at all** + a defensive unregister | §3.5 |
| *(dev, any mode)* | **no SW at all** + an active destroy | below |

#### Dev is SW-free, and `ADAPTV_DEV_SW=1` is the one way past it

Vite dev URLs are not cache-stable, so a worker registered in dev serves a stale bundle back into
the next session and breaks hot reload. The shell therefore *destroys* workers and caches in dev
rather than merely skipping registration.

That left a real gap: an app's own `serviceWorkers: []` module could only be exercised by running a
full production build plus `vite preview`. `ADAPTV_DEV_SW=1` closes it — the dev server then serves
**the app's modules and nothing else** at `/sw.js`.

**adaptv's own worker is deliberately still absent, and cannot be turned on here.** It *is* precache
+ navigation + static-asset delivery, and none of the three can exist against a dev server: the
precache manifest is globbed from the client output directory, which dev does not produce; the build
tag that namespaces every runtime cache and drives the activate sweep is computed from that same
output; and a `CacheFirst` route pointed at dev URLs caches the modules HMR is about to replace. A
dev lookalike would mean testing something that does not exist in production — worse than testing
nothing. → `src/vite/sw-dev.ts`

The dev worker also `skipWaiting()`s and claims immediately, instead of waiting for the next launch
like the shipped one. The production policy exists to protect unsaved work in a live session; there
is none of that here, and an edit that took two reloads to appear would just read as broken.

**The refinement that makes SSR work: the shell must be the _catch handler_, not a blanket
`NavigationRoute` handler.** A blanket `NavigationRoute` hijacks *online* navigations too — which
silently converts an SSR app into a stale SPA for every returning visitor. Network-only + a precache
fallback gives SSR-on-every-navigation **and** a fully functional offline app.

**The fallback is the _app shell_, not an offline page.** It contains no offline-specific markup — it
is the same document that boots React on a normal cold start. Offline then becomes a *render* outcome,
not a *serving* outcome and not a *navigation* outcome:

```
offline cold load → SW serves app shell → React boots → router resolves /product/xxx
                  → the route's own query has no data and cannot fetch
                  → that route renders its offline UI, in place, at /product/xxx
                  → connectivity returns → the query resumes → real content swaps in. No navigation.
```

**The native target gets this for free** — no SW, no shell, no fallback. All routes are already warm
because the bundle is on-device, so the *only* thing that can fail is data, and the route handles it
exactly the same way. One mechanism, six targets.

> ### ✅ BUILT — one client entry, and the boot mode is a **runtime** decision (2026-08-09)
>
> The flow above says "SW serves app shell → React boots". **In `render: "ssr"` it did not boot.** The
> cause was a build-time assumption: adaptv installed its own `client.entry` only when `render === "spa"`
> and left SSR on Start's default, which renders `<StartClient />` and hard-requires a `window.$_TSR`
> bootstrap that only a server or a prerender injects. The precached shell is *generated*, so it carries
> none, and `hydrate()` throws `Invariant failed` before React mounts anything. **MEASURED:** the offline
> SSR cold load rendered nothing but the shell's critical CSS — a flat `#0a0a0c` screen.
>
> `render` cannot decide this, because **one build serves both kinds of document**: online from the
> server (bootstrap present), offline from the precache (bootstrap absent). So `client-entry.tsx` is the
> entry for **both** modes and branches on what the document actually contains:
>
> ```
> window.$_TSR present → <StartClient />               hydrate the server render
> window.$_TSR absent  → <RouterProvider router={…}/>  plain client boot against the shell
> ```
>
> Safe against Start's own cleanup: `$_TSR.c()` only runs `delete self.$_TSR` once **both** `hydrated`
> and `streamEnded` are true, and `hydrated` is set by `hydrateStart` *after* it resolves — long after
> the entry module evaluates.
>
> **VERIFIED in project-zero, `render: "ssr"`:** worker `activated` and controlling, 111 precache
> entries; server killed → cold load boots from the precache; `/settings` deep-links offline fully
> rendered. Online, `/settings` is genuinely server-rendered (76 741 bytes, `$_TSR` present) and hydrates
> with **0 console errors**.
>
> **Amended 2026-09-13 — the shell path no longer hydrates.** It used to, and logged one **React
> #418** on every boot of it: every native launch, every service-worker-served spa document, every
> offline ssr boot. A static shell has no app markup, so the first client render can never match it
> (the router's `<Suspense>` meets the body's first text node). This note used to file that as
> inherent, on the grounds that removing it meant the root route could no longer render `<html>`.
> That premise was wrong: React 19 takes a `Document` as a `createRoot` container and adopts
> `<html>`/`<head>`/`<body>` as singletons, and the recovery after a failed hydration is literally a
> client root's first commit — the same sparing clear of the document. So the no-bootstrap branch
> of `client-entry.tsx` mounts `createRoot(document)`, still inside `startTransition`; only a
> document carrying `$_TSR` is hydrated. **MEASURED on the built playground**, chromium and WebKit:
> the capacitor bundle (with and without a native `Capacitor` stub), a spa build from a static host
> and from its worker, and an offline ssr boot all went from one #418 per boot to zero, the
> finished `<html>`/`<body>` attributes, head and body children are identical before and after, and
> the React development build logs nothing either. The error mattered beyond the console: it
> reaches `window` as an `error` event, which is exactly what the boot watchdog and any app
> telemetry listen to. → `src/routes/client-entry.test.tsx`
>
> **MEASURED (2026-09-02, built playground, ten boots per row, observers installed before the
> document):** the recovery itself was cheap. On the Android WebView (Pixel 10 emulator, API 37, the
> app's own local server) the whole boot is one long task of **57 ms median, 64 ms p90**, and chromium on
> the desktop records no long task at all, desktop or mobile emulation. What the shell path was paying
> for was the network: the server document lists every chunk the page needs as a `modulepreload`, the
> shell named only its entry, so each level of static imports waited for the previous one to download.
> Against the preview server on chromium that put the first client render at **1283 ms** and the splash
> hand-off at 2290 ms, where the server document reached them at 204 ms and 1618 ms on the same machine.
> The shell now declares the entry's static import graph (`shell-emit.ts`): the same boot reaches
> **1139 ms** and 2147 ms, and the Android first render moves from 277 ms to **215 ms**. WebKit never
> showed the gap: 112 ms to the first client render before, 109 ms after. What is left is the route chunk,
> a dynamic import the shell cannot name because it serves every route.

### 3.1.1 🔒 The framework contract (library-neutral)

adaptv must not assume a data library. The data layer is consumer-wired (§2), and a consumer may use
TanStack Query, SWR, plain `fetch`, or nothing at all. So the contract is exactly two things:

- **adaptv owns connectivity truth.** One accurate signal — `@capacitor/network` on native,
  `navigator.onLine` + `online`/`offline` events on web, because **`navigator.onLine` alone lies**
  (it reports an interface, not reachability). Surfaced as `useIsOffline()`. That's it.
- **adaptv ships a default `Offline` component** — themed, safe-area-aware, with the same override shape
  as `notFound` and `splashScreen`. It never decides *when* to render it.

**The consumer decides what to render, and the predicate is theirs.** Worth flagging in the docs though:
`isOffline` alone is a poor test in both directions — offline *with* a warm cache should render normally,
and online-but-the-request-failed usually wants the same UI as offline. The better question is *"do I
have anything to show?"*, however the app's data layer expresses that.

> **Recipe (docs, not framework):** consumers using TanStack Query get a precise signal for free.
> `fetchStatus === "paused"` means `onlineManager` reported offline so Query **parked** the fetch
> instead of failing it:
>
> ```tsx
> const { data, fetchStatus, refetch } = useQuery({ queryKey: ["product", id], queryFn: … })
> if (!data && fetchStatus === "paused") return <Offline onRetry={refetch} />
> return <Product data={data} />        // persisted cache hit → normal render, offline or not
> ```
>
> Better than a boolean check because recovery is automatic — Query resumes the parked fetch on
> reconnect and the route swaps to real content with no retry logic and no navigation. For this to be
> trustworthy, adaptv should offer an **opt-in** helper that feeds its connectivity signal into Query's
> `onlineManager` — available if you use Query, invisible if you don't.

This belongs in the **[cookbook](../guides/cookbook.md)** — `§1` there has the full worked example, alongside the
other cases that want one (auth guards in `beforeLoad`, IDB persistence, resume-driven refetch, deep-link
mapping). Not framework surface.

### 3.1.2 🔒 One `Offline` component, registered in config, used from both sides

Same thunk shape as `splashScreen`, so there is one component and one registration:

```ts
// adaptv.config.ts
export default defineApp({
  splashScreen:     () => import("@/components/splash-screen"),
  offlineComponent: () => import("@/components/offline"),
})
```

```tsx
// the consumer's own component — props all optional
export function Offline({ onRetry, error }: OfflineProps) { … }
```

**Two call sites, and the split is clean:**

| Renders it | When | `onRetry` |
|---|---|---|
| **adaptv** | the app can't boot far enough for a route to exist — route chunk fails to load (`vite:preloadError`), or the route tree itself can't resolve | `location.reload()` |
| **the consumer** | the route mounted fine but its *data* is unavailable (§3.1.1) | whatever refetches — `refetch`, a mutation, a router invalidate |

Optional props are what let one component serve both: adaptv supplies a sensible default `onRetry`, the
consumer supplies a real one. Nothing is duplicated and there is no framework-flavoured offline screen
that looks different from the app's own.

#### Does it work everywhere? Almost — one hard floor, one constraint

**✅ Works:** offline cold load with the shell precached · SSR with the origin down (better than a 502)
· hard refresh while offline on a personalized route · route chunk missing after a deploy · **native,
always** (no SW, bundle is on-device, so React always boots).

**⛔ The one case nothing can fix: the first-ever load, while offline, on web.** No document is cached,
so no JS runs, so no React component can render — the user gets the browser's own error page. This is
inherent to service workers, not a adaptv gap: a SW must install online at least once before it can
serve anything. Note it **cannot occur on native** (the bundle ships with the app) and is near-absent on
standalone PWA (installing implies a successful visit). It is a browser-first-visit-only edge.

**⚠︎ The constraint that will bite: the offline component must be in the eager bundle, never lazily
imported.** If `offlineComponent` resolved to its own lazy chunk, then in exactly the situation you need
it — chunks unavailable — that chunk is unavailable too, and you get a blank screen instead of the
offline UI. adaptv's existing thunk handling already does the right thing: the Vite plugin reads the
thunk's specifier and **emits a static import in the generated root** rather than executing the dynamic
import (`docs/design/lifecycle.md §1`). That behaviour is load-bearing here, not incidental — it must be preserved
for `offlineComponent`, and is worth an explicit test.

There is one hard mechanical constraint: **a TanStack Start SSR build emits no shell artifact.**
`_shell.html` is produced **only in SPA mode**, so in `render:"ssr"` there is nothing in `dist/client`
to bind the fallback to. adaptv must emit a dedicated static shell at build time for the SSR case — and
it must be **generated, never a captured response**, so it is user-agnostic by construction rather than
by luck (§3.2).

### 3.1.3 🔒 `bootErrorScreen` — the app's screen for a bundle that never ran

**Where the line sits.** A route that throws, a failed fetch, a bad render — handling *those* well is
the app's job, because only the app knows what to show instead, and adaptv installs no boundary for them
precisely so it does not take that away. adaptv owns the one failure the app never got to have an
opinion about: a syntax error in the entry chunk, a 404 on it, a corrupt OTA bundle. React never mounts,
nothing written in React renders, and the WebView paints blank.

**A sandbox does not solve this, and the reason is the whole design.** The instinct is to isolate the
error screen in an iframe. That isolates the *execution scope* — fresh globals, clean context — but you
still have to load a script into it, and a script from a broken build is broken there too. What has to
be isolated is the **build graph**, not the runtime.

So the component is rendered to static HTML at **build time** with `react-dom/server`, and embedded
hidden in the document. The dev still writes a normal React component with normal Tailwind — it simply
runs in Node instead of in the browser. What ships is markup that is already inside the document the
WebView loaded, depending on no bundle whatsoever.

| | the app's own boundary | `bootErrorScreen` |
|---|---|---|
| Owned by | the consumer, wherever they mount it | adaptv |
| Catches | a route, a render, a fetch — the app running badly | the app never running at all |
| Runs | in the browser, live React | at build time, `react-dom/server` |
| Has | the error object, `reset`, hooks, state | markup and a `code` |
| Retry | `reset()` in place | `location.reload()`, delegated by the watchdog |

**Tailwind comes free.** `styles/index.css` declares `@source "../**\/*.{ts,tsx}"`, so the component's
classes are already generated into the app stylesheet — a *different file* from the JS that broke. The
only CSS inlined for this path is a structural floor (full-viewport, centred, padded) for the rarer case
where the stylesheet is missing too.

**The failure comes through as a `code` prop — and adaptv never renders it.** Four signals are
distinguishable from outside the bundle, and they point at different culprits:

| Code | Signal | What it means |
|---|---|---|
| `BOOT-LOAD` | the entry `<script>` fired `error` | the file is **not being served** — deploy, CDN, offline |
| `BOOT-THROW` | uncaught error before mount | the file arrived; **the code in it is broken** |
| `BOOT-REJECT` | unhandled rejection before mount | same, by way of a promise |
| `BOOT-STALL` | grace period elapsed, nothing mounted | it arrived, it ran, it raised nothing, and still never mounted |

**adaptv's own screen displays none of them**, deliberately — whether a code helps a user or merely
alarms them is a product decision, and it belongs to the app. The code is on the props so an overriding
`bootErrorScreen` can *branch* on it: different copy for "we are not serving the file" than for "the file
we served is broken", a support reference, a telemetry ping. It is also stamped on
`<html data-adaptv-boot-failed="BOOT-LOAD">`, so telemetry and e2e read one attribute instead of
scraping the screen.

On native, a second attribute lands beside it: `data-adaptv-boot-bundle`, carrying the build tag of the
bundle that was actually running (or `embedded` for the one inside the binary). The code says what broke;
this says *which deploy* to roll back, which is the only actionable half under OTA. It arrives from the
native bridge a moment after the reveal, never before it, and is cleared if a late mount wins the race.
→ `docs/design/ota.md §5.4c`

**A prop is why the component is prerendered four times, not once.** Static markup cannot be handed a
prop when it is revealed, so the component is rendered once per code at build time and the watchdog
reveals the matching copy. A component that ignores `code` — adaptv's default, and probably most apps'
— produces four identical strings, which collapse back to a single copy in the document. Nobody pays
for variants they did not ask for.

> **This only works because the value space is closed.** Four codes, four renders — exhaustive
> enumeration, not injection. `code` is the *only* prop the fallback path can pass, and that is a
> property of the prop, not a limitation of the plumbing: `error`, `errorInfo` and `reset` cannot be
> enumerated at build time (an infinity of messages and stacks, and a live function), so they are
> `undefined` there. A custom component that dereferences `error` unconditionally throws **during the
> build**, which is where you want to find out.

**A custom `bootErrorScreen` is written the obvious way, and its button works.**

```tsx
import type { BootErrorProps } from "@arrzdev/adaptv/components"

export default function BootScreen({ code }: BootErrorProps) {
  const copy = code === "BOOT-LOAD"
    ? "We couldn't reach the server."
    : "Something went wrong while starting up."
  return (
    <View>
      <p>{copy}</p>
      <button onClick={() => location.reload()}>Try again</button>
    </View>
  )
}
```

`onClick` genuinely does not exist in the fallback — a build-time render serializes no event handlers —
so something has to wire the only action on the screen. Writing it anyway is still right: it is what runs
if the app ever renders this component itself. An opt-in attribute was the obvious answer and the wrong
one: a forgotten spread would produce a **dead button** at the exact moment a reload is the only way out,
which is a silent failure (`docs/decisions/register.md` L7).

So the watchdog reloads on **any `<button>`** inside the fallback. That is not a guess about intent — in
a document where no app JavaScript is running, a button has nothing else it could possibly do. Anchors
still navigate natively and are left alone.

`bootErrorRetryProps` remains as the precision tool for the one case the blanket rule gets wrong — a
screen with a second button that should *not* reload. Mark one control and only that one does.

**The reveal policy is one rule: show only while the mount point is empty.** No boot flag, nothing for
the app to call. That single rule gets three cases right at once — a server-rendered page that is merely
slow to hydrate already has content, so the timeout can never replace good content with an error screen;
an error thrown *after* mount belongs to the boundary and is ignored without tracking boot state; and a
late mount that wins the race un-reveals the fallback through a `MutationObserver`.

**What it asks of the component: that it renders standalone, with no props and no browser.** Not a new
constraint — adaptv defaults to `render: "ssr"`, so every consumer component already has to render in
Node. A failed prerender is a **loud warning, never a failed build**: an app must still ship without its
boot fallback, but a silently absent safety net is indistinguishable from a working one until the day it
matters.

**⛔ The floor this cannot lift: the document itself never loading.** On native that is Capacitor's
`server.errorPath` (`bin/lib/offline-page.mjs`), which already exists. On web it is a first-ever visit
while offline — inherent to service workers, not an adaptv gap (§3.1.2).

### 3.2 🔒 Prefetch **every route's assets**; never prefetch **documents**

The line is not "how much to cache" — it's **what kind of thing**. These two look similar and are
opposites:

| | Route **assets** (JS/CSS chunks) | **Documents** (HTML) |
|---|---|---|
| Content | static, content-hashed, identical for every user | per-request, per-user under SSR |
| Credentials | irrelevant — public artifacts | `credentials:"same-origin"` sends the session cookie |
| Cache key | filename *is* the version | URL only — **no user dimension** |
| Verdict | **precache all of them, aggressively** | **never** |

**Precaching every route chunk is the goal, not a risk.** It is what makes an installed PWA navigate
like the native build — where the whole bundle is already on-device by construction. The SW's purpose
on web/standalone is precisely to replicate that property.

**SSR does not restrict this.** Render mode only affects the **first** document; after hydration
TanStack Router navigates client-side from the same chunks in both modes. So precaching every route
chunk delivers identical instant navigation under `render:"ssr"` and `render:"spa"` — there is nothing
to trade away, and no reason to choose SPA to get warm routes.

**Documents are a different act that happens to use the same API.** Exactly one document is precached
— the generated **app shell** — and no route document ever is.

| Document | Precached? | Why |
|---|---|---|
| The generated app shell (`index.html` in SPA, `adaptv-shell.html` in SSR — §3.3) | **Always, unconditionally** | It is generated from config, identical for every visitor, and the navigation route **binds to it**. Infrastructure, not a choice. |
| Any route document (`/`, `/pricing`, `/dashboard`) | **Never** | Cache Storage is keyed by URL and scoped per-ORIGIN, not per-user. Under SSR these carry a session. |

The failure mode for the second row is concrete: fetching documents with `credentials:"same-origin"`
into a shared bucket means user A logs out, user B logs in on the same profile, and B is served A's
server-rendered HTML. Forcing `ignoreVary:true` discards `Vary: Cookie`, the one HTTP mechanism that
would partly protect against it. Secondary: SSR'd HTML embeds server-rendered data that re-hydrates and
re-fetches anyway, so caching it buys availability, not freshness.

**There is no allowlist for "public" documents**, and that costs a real case: a landing page cannot be
made instant on cold load. It is worth it. An allowlist that ships with a safety warning attached is a
footgun with documentation — it works until a listed route turns personalized six months later, and the
failure is a cross-user leak no test catches. Without one, "a document a session produced can never
enter a shared cache" is a property of the build rather than a rule someone has to remember.

The shell is not an exception to that rule — it is what makes the rule affordable. It is **generated,
never captured**, so it carries nobody's session, and it is precached by name rather than by a glob
(`APP_SHELL_FILE`), because a `**/*.html` pattern is precisely how route documents would sneak back in.

> **The "landing page + app in one codebase" case still works for SEO** — crawlers receive real SSR
> HTML and do not run service workers, so ranking is unaffected. What is lost is the *instant human
> cold-load* of that specific page; every navigation after boot is unaffected, because those come from
> precached chunks either way.

**Consequences:** the legacy `sw.warm-routes.ts` is dropped — **not because prefetching is wrong, but
because it prefetched the wrong layer** (credentialed HTML instead of chunks). `ignoreVary` stops being
a global default; it's safe and useful on hashed assets, dangerous on documents, so it becomes per-rule.
Freshness belongs to the **data layer** (consumer-wired: TanStack Query + an IDB persister).

**Two edges worth knowing before precaching a large route tree:**

- **Workbox precache is all-or-nothing at install.** One 404 in the manifest fails the entire install
  and you get no SW at all. Low risk when the manifest is generated from real build output, but it makes
  deploy races (assets pruned while an install is in flight) a total failure rather than a partial one —
  which is another reason for the no-`--delete` deploy rule in §3.4.
- **Install downloads the whole app.** For a standalone PWA that is correct — it is the analogue of
  installing a native app, and it is the whole reason navigation then feels native. It is **not**
  configurable, because an app that precaches only some routes is an app whose navigation is fast
  sometimes.
- **Storage is evictable unless you ask.** Cache Storage is "best-effort" by default, so a browser may
  drop the precache under disk pressure — the app silently stops working offline with nothing to
  observe. adaptv calls `navigator.storage.persist()` at boot (`requestPersistentStorage`), which WebKit
  grants to installed web apps and Chromium decides from engagement. It is one line, it fails closed,
  and no app would think to write it.
- **iOS deletes everything after 7 days of no interaction** — SW registration, Cache Storage, IndexedDB
  — for a site that is *not* installed to the home screen. Nothing can fix this from inside the page; it
  is the honest limit of "works offline on the web" and one more reason the installed PWA is the target.

### 3.3 🔒 Everything else the adaptv SW does

- **Precache every route chunk** (§3.2) — this *is* the offline story, and the reason navigation in a
  standalone PWA feels native. Once booted, the app navigates entirely offline with zero document
  caching. TanStack Router's `defaultPreload:"viewport"` remains a complementary warm-up for the
  *online* first visit, not a substitute.
- **Navigation Preload — on under `ssr`, off under `spa`.** A registered SW sits in the path of every
  navigation, so you pay SW boot latency (~50–250ms cold on mobile) even when the SW only passes
  through. `navigationPreload.enable()` starts the document request in parallel with that startup, so
  the two costs overlap instead of stacking.

  It is **not** "two lines", and an earlier draft of this document saying so is why it went years
  unimplemented. It is a matched pair, and half of it is worse than none:

  1. `self.registration.navigationPreload.enable()`, inside `activate` and inside `waitUntil` —
     otherwise activation can finish before preload is on, and the very first navigation, the cold one
     this exists for, does not get it. → `sw.lifecycle.ts` `registerNavigationPreload`
  2. The navigation handler must **read `event.preloadResponse`**. Workbox's `NetworkOnly` does not,
     which is why adaptv's SSR navigation is a handler (`serveNavigation`) rather than a configured
     strategy. An enabled-but-unread preload is *strictly worse than off*: the browser issues the
     request anyway and the worker then issues a second one, so every navigation costs the server two
     renders and logs *"the service worker navigation preload request was cancelled before
     'preloadResponse' settled"*. → `sw.navigation.ts`

  Two consequences that are easy to get wrong. `preloadResponse` resolving `undefined` means *the
  browser did not preload this one* — not *the network failed* — so it falls through to a normal fetch
  rather than to the shell; the first navigation after an install lands there, as does any browser
  without preload. (A POST navigation never reaches the handler at all — `registerRoute` matches `GET`
  only, so form submits fall straight through to the browser.)
  And because the enabled flag lives on the **registration**, not on the worker, it survives every
  update: `spa` builds must call `disable()`, or an app that switches `render` keeps preloading
  documents its worker will never read.

  The preload is the same request with the same credentials the browser would have sent anyway, and
  like every other document it is never cached (§3.2).
- **One runtime asset route, `CacheFirst`** — same-origin GET requests whose destination is a script,
  style, font or image, plus anything under `/assets/*`. Not `StaleWhileRevalidate`: content-hashed
  filenames are immutable, so revalidating them is pure waste. → `sw.static-assets.ts`

  **Unhashed files (icons, `manifest.json`, fonts) are on that same route, and that is not an
  oversight.** CacheFirst normally means "never updated", which would be wrong for a URL that is not
  versioned — except the bucket itself is: `static-<buildTag>` rotates on every deploy and the previous
  one is swept at activate, so the entry is refetched exactly when the build changes. A per-asset
  revalidation would buy nothing the tag rotation does not already give. (They are precached by the
  glob too; this route is the net for anything the manifest missed.) `createStaleWhileRevalidateStrategy`
  exists in `sw.strategies.ts` for apps wiring their own route through `sw.cache-route.ts` — adaptv's
  own worker never uses it.

  **Not built: Service Worker static routing (`InstallEvent.addRoutes`) for these assets. MEASURED
  2026-09-14**, and it missed the bar fixed before the numbers were read (≥ 50 ms off the cold-worker
  load at p50, or ≥ 20% off the hashed assets' summed fetch time, in both an unthrottled and a 4x run).
  Method: two builds identical except `sw.js` — as shipped, and the same worker plus an install-time
  `{urlPattern: "/assets/*"} → {cacheName: <precache>}` rule — served side by side by Nitro's preview
  on Chromium 149, `/lab/drawer` (27 hashed assets), 20 alternating A/B navigations per cell with the
  worker stopped over CDP (cold) or running (warm), the whole comparison run twice, then again with
  the page at 4x CPU. `workerFinalSourceType` read `cache` on all 27 assets in every B sample. Cold
  load p50 went 23.3 → 19.0 ms and 23.3 → 18.8 ms unthrottled, 91.9 → 72.1 ms and 92.2 → 71.4 ms at
  4x; the summed fetch time fell 33% and 31% unthrottled, but 18% and 32% at 4x, so the second
  criterion failed one of its four runs. FCP did not move in any run, and warm matched cold because the
  navigation starts the worker before any asset is requested, so the rule only ever saves the
  per-request dispatch (0.2–0.7 ms per asset at p50). Two things any future build must handle. Workbox keys
  every precache entry as `url?__WB_REVISION__=…`, so the same rule against the shipped manifest
  matched and missed on all 27 assets and sent them to the network past the worker (one probe: up to 187 ms per asset)
  until `dontCacheBustURLsMatching` keyed them by their plain URL. A miss also skips the fetch handler,
  so `/assets/` files outside the precache glob lose this runtime route: `lab-photo-*.jpg` failed to
  load offline under the rule and loaded under the shipped worker. Rules would have to come from the
  manifest, not from a path pattern. Two limits of the method: CDP refuses CPU throttling on a worker
  target ("Operation is only supported for pages, not workers"), so the 4x runs slow the page and not
  the worker; and Playwright's WebKit 625.1.21 (the Safari 27 line) has `addRoutes` on
  `InstallEvent.prototype` and applies the rule (no fetch event for 27 routed GETs, one for a
  `HEAD` control), but was not timed. Reopen when a phone shows the per-asset dispatch costing a
  navigation ≥ 50 ms, when a route loads several hundred hashed assets at once, or when Workbox gains
  an API for router rules.
- **API responses are never cached by the SW.** That's the data layer's job, on purpose.
- **Navigation denylist**: prefixes `/api/`, `/assets/`, `/_serverFn/`, plus Angular ngsw's heuristic —
  *a last path segment containing a dot is a file, not a navigation* (`/\/[^/?]+\.[^/]+$/`). Workbox's
  `NavigationRoute` has no such default, and `mode:navigate` is exactly what a browser sends for a plain
  **link** to a file, so without it the SW answers `/whitepaper.pdf` with the app shell's HTML —
  *online*, in `spa` mode, where the shell handler answers unconditionally and nothing in the precache
  glob covers a PDF. **Measured**, `render:"spa"`, Chromium, before/after:
  `/sitemap.xml → text/html (fromServiceWorker)` becomes `→ text/xml (fromServiceWorker: false)`.

  The rule is *"the app shell may not answer a file request"*, and the two modes apply it differently
  because that is what makes it correct in each:

  | | `spa` | `ssr` |
  |---|---|---|
  | file navigation | **not claimed** — the shell is all this mode serves, so declining is the rule | **claimed**, and passed through to the network |
  | shell fallback for it | n/a | **removed** — no shell, so offline it is a network error, not HTML where a PDF was asked for |

  `ssr` claims them on purpose: the browser has already started a preload, and declining leaves that
  response unread — measured at **two document hits at the origin for one `/whitepaper.pdf`
  navigation**, which is the same waste §3.3 exists to avoid. `spa` has preload off, so it costs nothing
  there. The heuristic's known cost, accepted with ngsw: a route whose last segment contains a dot
  (`/blog/hello.world`) is read as a file. Earlier segments are unaffected — `/v1.2/docs` is a
  navigation, verified.
- **Activate-time cache sweep.** Runtime buckets are named `<bucket>-<buildTag>`; on `activate`, every
  cache whose name starts with a bucket adaptv **owns** and whose tag is not the current one is
  deleted. `cleanupOutdatedCaches()` does **not** do this — it only removes precaches written by *older
  Workbox versions* — so without the sweep every deploy mints buckets that are never freed, ending in a
  quota error on a frequently-deployed app. → `docs/decisions/register.md` B2

  The owned list is exactly `static`, `pages`, `documents`, and it is an **allowlist on purpose**: a
  prefix rule like "delete anything that isn't the current tag" would take caches adaptv did not
  create — another app on the same origin, a third-party worker, Workbox's own bookkeeping.
  `pages` and `documents` are there to clean up after builds that predate §3.2 and nothing writes
  them now. `static` is written only for assets the **precache manifest does not cover**, because
  Workbox's precache route is registered first and answers everything in the manifest before the
  runtime route sees it — MEASURED in the lab (iOS Safari and Chromium alike): `caches.keys()` is
  exactly one entry, `workbox-precache-v2-<origin>`, and no `static-<tag>` bucket exists at all.
  It appears once something is served that the glob missed (a file over the 5 MB cap, an asset built
  at runtime). Asserted end-to-end in both engines by `e2e-sw/update.spec.ts`, which plants one cache
  of each kind and checks that exactly the owned, stale one disappears.

> ### ⚠️ Two failures that come from the **host**, not from adaptv (2026-08-09)
>
> Nothing in the SW path sniffs the environment. Registration is gated on `import.meta.env.DEV`, a Vite
> constant substituted at **build** time — there is no hostname check, no `NODE_ENV` read at runtime, no
> domain allowlist. Vercel, Cloudflare Pages, Netlify, a VPS, a static bucket: all serve `vite build`
> output, so all register identically. The only host-dependent value is `BASE_URL`, already handled for
> subpath deploys. Two things still vary, and both fail *quietly*:
>
> **1. A non-secure origin gets no worker at all.** Service workers require a secure context. `localhost`
> is exempt and every `https://` origin qualifies — a self-hosted deploy over plain `http://` does not,
> and there `navigator.serviceWorker` is simply **absent**. No registration failure to catch, no
> exception: the app just loses offline support and instant navigation with nothing to explain why.
> `registerSW` now says so with a `console.warn`, deliberately **not** dev-gated, since production is the
> only place it happens. **VERIFIED** by loading the same build over a LAN IP: `isSecureContext === false`,
> `'serviceWorker' in navigator === false`, app still renders.
>
> **2. ✅ FIXED — an asset-first host was shadowing the SSR route.** The shell has to live in
> `dist/client` — the precache fallback binds to it (§3.1) and a static deploy needs it. It was named
> `index.html`, which is the **directory index** on every static layer there is, and those layers run
> *before* the server. **MEASURED on Cloudflare Workers Assets:** `/` returned the 3 079-byte shell while
> `/settings` returned 76 741 bytes of real server render — the home route silently lost SSR and its SEO,
> with correct-looking output and no error anywhere.
>
> The fix is the name, not the host config. **`index.html` for a SPA build, `adaptv-shell.html` for an SSR
> one** (`sw-helpers.ts` owns both, and the worker's fallback URL is an esbuild `define` so the two can
> never drift). No asset matches `/`, so the request falls through to the server, and the shell stays a
> plain file the worker precaches and serves offline.
>
> Rejected: `run_worker_first`, which routes *every* request — assets included — through the worker,
> trading a correctness bug for a latency and invocation-cost one, and only on one host.
>
> **VERIFIED, Cloudflare:** `/` → 70 855 bytes server-rendered with `$_TSR`; precache 111 entries
> including `adaptv-shell.html`; server killed → `/` cold-boots from the precache and `/settings`
> deep-links offline. Note that Workers Assets' default `html_handling` **307-redirects**
> `/adaptv-shell.html` → `/adaptv-shell`; Workbox follows it and caches under the manifest key, so the
> precache is unaffected — this was true of `/index.html` before, too.
>
> **VERIFIED, static-first node host** (A/B on the same running server): with `index.html` present `/`
> returned 200 and 3 079 bytes and the SSR handler was **never invoked**; with only `adaptv-shell.html`
> the request fell through to the handler. So the mechanism — and the fix — is not Cloudflare-specific.
>
> **A `render: "spa"` build is unaffected and stays `index.html`**: a bucket of files runs no server, so
> there is nothing to render per request and nothing to shadow. VERIFIED: emits `index.html` +
> `404.html` + `.nojekyll` + `_redirects`, worker binds `/index.html`, 111 precache entries.
>
> **Scope note, amended 2026-08-10.** This section used to end by observing that `web.host` had exactly
> **one** behavioural consumer — `static-host.ts`, acting only on `"static"` — while `node`, `vercel` and
> `cloudflare` were inert at build time. That observation is why the key no longer exists: `"static"` was
> `render: "spa"` said twice, and the other three named a deploy target adaptv had no behaviour behind.
> The static-host files now ride on `render: "spa"` directly, and the target is named by the Vite plugin
> the consumer adds. → `docs/decisions/rendering-and-delivery.md §2`
>
> So "per host" still reduces to the two mechanisms measured above — static-first shadowing, and a
> server-less bucket — and neither is host-specific.
>
> **Re-measured on Nitro (same day), because adaptv now injects the server build itself.** Nitro emits to
> `.output/public`, so the three emitters no longer hardcode `dist/client` — they read the resolved client
> output dir from Vite. Under `NITRO_PRESET=cloudflare_module` the generated `wrangler.json` points
> `assets.directory` at `.output/public`, which holds `adaptv-shell.html` and **no `index.html`** — so the
> fix above carries over untouched, on a completely different deploy mechanism. `/` → 70 855 bytes with
> `$_TSR`, `/settings` → 76 741, 111 precache entries, offline deep link verified by screenshot with the
> server killed. Identical numbers to the Workers Assets measurements above.

### 3.4 🔒 The update flow — automatic, silent, and only at a cold launch

**The default ships no update prompt.** The worker is invisible infrastructure; asking a
user to approve a delivery-layer swap is asking them a question they have no basis to answer. What made
a prompt look necessary was *when* the old code applied the update, not *that* it applied one.

> #### `serviceWorkerUpdate: "auto" | "prompt"` — one setting, because there is one worker
>
> The modules an app lists in `serviceWorkers: []` are bundled into adaptv's own worker and share its
> single registration. There is no updating the app's half while the framework's half waits: the whole
> worker activates, or none of it does. So the policy is one config key, not two mechanisms.
>
> `"auto"` is the default and is everything described below — applied at cold launch, no UI, no API
> surface. `useServiceWorkerUpdate()` reports `false` forever under it, which is why an app can call it
> unconditionally and flip behaviour from the config alone.
>
> `"prompt"` suppresses the launch-apply entirely. The worker installs, waits, and the app owns the
> moment through `useServiceWorkerUpdate() → { updateAvailable, applyUpdate }`. adaptv renders nothing
> — the banner is the app's, in its design system. Choose it when a session holds state that outlives a
> reload: an editor, a long form, a call.
>
> **Measured** (playground, SSR build, real deploy between launches): under `"auto"` the waiting worker
> takes control on the second launch; under `"prompt"` it was still waiting after two launches and only
> took control when the apply path ran. Under both, a worker that finishes installing *mid-session* is
> left alone.
>
> All three of those are now asserted on every run, in Chromium and WebKit, against a real second
> build — `playground/e2e-sw/update.spec.ts`, §3.7. This path gets a rebuild inside a test because it is
> the only one whose failure is **unfixable remotely**: a worker that never updates keeps serving the
> old precache, and no subsequent deploy can reach the user.

`skipWaiting` + `clientsClaim` means a new SW takes control of pages **loaded by the old SW**. Those
pages hold module graphs referencing the old build's hashed chunks, and precache activation deletes
them — so the next lazy `import()` in that open tab 404s at both cache and origin. Auto-reloading on
top of that also drops unsaved form state. So the whole decision reduces to one question: **when is a
reload free?**

**Only at a cold launch.** A worker sitting in `waiting` finished installing in an *earlier* session,
so its precache is already complete on disk — applying it costs one reload and zero downloads. And the
document was created moments ago: no typed-in form, no open modal, no in-flight upload to destroy.

```
boot → registration.waiting && navigator.serviceWorker.controller
     → postMessage({ type: "SKIP_WAITING" }) → controllerchange → location.reload()
```

A worker that finishes installing **during** a session is deliberately left alone; the branch above
applies it at the next launch. Running one build behind for one session is survivable. Losing what
someone typed is not.

> **"Hidden" is not the same as "safe", and that distinction is the whole section.** An earlier design
> applied updates on `visibilitychange → hidden`, reasoning that a reload nobody watches is a reload
> nobody minds. It is worse: the user switches away for three seconds, comes back to a wiped form, and
> cannot connect the loss to anything they did. They do not conclude "the update did that" — they
> conclude the app loses their work.

**The one hole, accepted:** a desktop tab left open for weeks never cold-launches, so it stays on its
build until reloaded. It degrades gracefully — hashed chunks still resolve under the no-`--delete`
rule below, and the data layer keeps revalidating. Mobile PWAs, where this matters most, are killed and
cold-launched constantly.

Three supporting requirements, all unconditional:

1. **`vite:preloadError` handler**, with a `sessionStorage` loop guard — the net that makes even the
   bad case recoverable. Without the guard, a genuinely-missing asset becomes an infinite reload loop.
2. **`register(swUrl, { updateViaCache: "none" })`** and `Cache-Control: no-cache` on `sw.js`.
   The first ships in adaptv's registration; the second is the host's to set, because the static build
   emits no `_headers` file. Browsers cap the SW script's effective max-age at 24h regardless;
   `updateViaCache:"none"` is the fix.
3. **Deploy without `--delete`.** Content-hashed filenames mean build N-1 and N coexist harmlessly.
   `aws s3 sync --delete` and equivalents destroy the previous build's chunks and turn a survivable
   deploy into a broken session. **This is a hosting requirement, not an optimisation** — it is the
   highest-leverage stale-chunk mitigation and it costs nothing.

### 3.5 🔒 Capacitor gets no service worker — and an active unregister

- **iOS: impossible.** `capacitor://localhost` is a custom scheme handled by `WKURLSchemeHandler`;
  WKWebView does not support SW registration on custom-scheme origins.
- **Android: technically possible, which is worse.** `http://localhost` is a potentially-trustworthy
  origin so `register()` succeeds — but local assets are served via `WebViewAssetLoader`, while
  SW-originated fetches go through Android's *separate* `ServiceWorkerController` path that Capacitor
  doesn't wire up. The failure mode is silent inconsistency, not a clean error.
- **It's pointless** — the bundle is already on local disk; a SW cache is a redundant second copy.
- **It is actively hostile to OTA (§4).** A stale SW that precached the old bundle keeps serving it:
  the app "updates," `serverBasePath` moves, and the WebView shows old code. This alone settles it.

So `sw:false` under `target:"capacitor"` is **absolute and non-overridable** — and adaptv additionally
nukes any registration + caches when `ADAPTV_TARGET === "capacitor"`, because a SW registered during a
`server.url` live-reload dev session would otherwise silently poison the installed app.

### 3.6 🔒 Stay on Workbox

Serwist (the maintained `next-pwa` successor) is the obvious alternative and was evaluated. It's
TypeScript-first and ESM-native, but it **does not solve the SSR navigation problem any better** —
that's an architectural decision, not a library feature — and it reportedly broke against TanStack
Start's build for the same reason vite-plugin-pwa does. adaptv's `src/sw/*` factory functions are
already a clean abstraction seam that would contain a future swap. Re-evaluate **only** if Workbox is
confirmed unmaintained.

Likewise **stay off `vite-plugin-pwa`**: its build hook never fires when every Vite environment is
`build.ssr` (adaptv's code already documents this, and it's independently confirmed in
[TanStack/router#4770](https://github.com/TanStack/router/discussions/4770)), and adaptv needs a
post-client-build hook to compute `__ADAPTV_BUILD_TAG__` that the plugin doesn't offer. But
**reimplement three things it gave us**: correct `BASE_URL` handling in `registerSW` (P0 — see the
bug list), an opt-in dev-mode SW (`sw.dev`), and a `sw:"destroy"` self-destroying kill switch so a
broken SW has a remediation path.

### 3.7 🔒 The worker is tested against a **build**, in a browser, in both render modes

Everything above is behaviour no unit test can reach. The main e2e harness drives `vite` **dev**, where
adaptv deliberately destroys any service worker (§3.1) — so for as long as that was the only harness,
*none* of §3 was covered by anything, and the navigation denylist drifted from this very document
without a single test turning red.

`playground/e2e-sw/` closes that. It **builds** the lab app and serves the build:

```bash
pnpm --dir playground run test:e2e:sw:all
```

The update specs run a real `vite build` **inside the test** (`deploy()`), which is the only honest way
to produce new bytes at `/sw.js`. It also means interrupting the suite with `pkill` does not stop that
build: it keeps writing into the very output the next run serves, and the next run fails the update
flow in a way that will not reproduce. Kill `vite build` alongside the runner.

Three configs, not three projects, because each is a separate **build** of the same app directory —
`render` and `serviceWorkerUpdate` are both compiled in, so no test can switch between them at
runtime. `ADAPTV_RENDER` and `ADAPTV_SW_UPDATE` in `playground/apps/frontend/adaptv.config.ts` are
wired for exactly this:

| | `playwright.sw.config.ts` | `playwright.sw-spa.config.ts` | `playwright.sw-prompt.config.ts` |
|---|---|---|---|
| build | `ssr`, `auto` | `spa`, `auto` | `ssr`, **`prompt`** |
| covers | the network-first path, preload **on**, the offline fallback | the app-shell path, preload **off** | the update policy that applies **nothing** on its own |

**Running all three is not redundancy.** Under `ssr` a navigation reaches the network whatever the
worker decides, so a worker that wrongly claims `/whitepaper.pdf` still returns a PDF and the suite
stays green — the bug is only *online*-visible under `spa`, and only *offline*-visible under `ssr`.
Each mode is the only one that can catch one half. The prompt build is stranger still: its contract is
the **exact inverse** of the auto build's, so the two update specs would fail each other's build, and
that is why the third config matches one file rather than the directory.

What it asserts, and why each one earns its runtime:

- **registration** — the worker installs, activates, controls, precaches the whole app *including the
  shell* (the navigation route binds to it), and precaches **no route document** (§3.2 — the cross-user
  leak, asserted against the shipped manifest rather than trusted to the glob).
- **navigation claiming** — `/settings` is served by the worker; neither `/sitemap.xml` nor
  `/sw-probe.pdf` is ever answered with the app shell; `/v1.2/docs` is still a navigation, so the ngsw
  heuristic's known cost stays bounded. The two file fixtures are real files in `public/` deliberately
  **outside** the precache glob — a route that merely 404s would not be the same test.
- **preload** — enabled under `ssr`, actively disabled under `spa`, read from
  `navigationPreload.getState()` (§3.3).
- **offline** — a **never-visited** route boots with `transferSize: 0`, with a control proving the
  origin is genuinely unreachable, and a file link fails rather than falling back to the shell.
- **update** — a real second `vite build` mid-test, then: the new worker is noticed, is **held** for
  the session that found it, and is applied at the next launch, sweeping a planted `static-<old-tag>`
  cache while leaving a foreign cache alone (§3.4, `docs/decisions/register.md` B2). `ADAPTV_BUILD_TAG` is what makes
  a second build cheap enough to do inside a test.
- **update under `prompt`** — the same deploy, on a build of the other policy: it is **offered**
  through `useServiceWorkerUpdate()` (read off the lab page, so the assertion covers the signal
  reaching React and not merely `registration.waiting`), survives a launch **without being applied**,
  and takes only when the app's own `applyUpdate()` button is clicked. Run against an `auto` build the
  spec goes red at the first step — the config → baked constant → runtime branch → hook chain is what
  it measures.
- **redirects** — `/sw-probe-redirect` throws a router redirect in `beforeLoad`, which under `ssr` is a
  real `307` from the server. A fetch handler that answers a navigation with a *followed* response
  (`redirected === true`) makes the browser refuse the document outright — `Response served by service
  worker has redirections` — so an app whose auth sends users to `/login` would be entirely broken by
  its own worker. adaptv stays clear of it by fetching the **request** (which carries
  `redirect: "manual"`) rather than the URL.

> **A green two-engine run can still be walking one branch.** MEASURED while building the redirect
> spec: with preload enabled, `serveNavigation`'s fallback `io.fetch()` is **never reached** — the
> preload always resolves first. Breaking that fetch outright changed nothing in Chromium *or* WebKit.
> It is not dead code, though: **Firefox has no navigation preload at all**, and neither does Safari
> before 15.4, so for those users it is the path *every* navigation takes. Preload being on is exactly
> what hides it. The spec therefore calls `navigationPreload.disable()` for one navigation to walk the
> other branch — and with the bug present, that test alone goes red in both engines.

#### What it deliberately does not cover

Stated because a suite's silence reads as coverage:

- **WebKit offline.** `context.setOffline` + any navigation dies with "WebKit encountered an internal
  error" before the worker is consulted — measured, not assumed. Those tests skip on WebKit; the gap
  is closed by hand on the Simulator instead (below).
- **`response.fromServiceWorker()` on WebKit.** Always `false`, including for a route the worker
  demonstrably served. The specs use `transferSize` instead, which every engine reports honestly.
- **`registration.active.state` after an update on WebKit.** Playwright's WebKit reports `activating`
  indefinitely while every `activate` handler has finished — the sweep ran, the page is controlled, and
  a *second* deploy still installs and sweeps on top of it. **Real iOS Safari reports `activated`
  normally**, so this is a Playwright-WebKit artifact rather than an engine one. Either way the update
  spec asserts what the worker **did**, never its reported state.
- **One host.** Everything is Nitro `node-server` under `vite preview`. Cloudflare and Vercel resolve
  static assets before the server (which is why the SSR shell is not named `index.html` — §3.3), and
  that ordering is verified by reading their config, not by a test.
- **Firefox.** Playwright ships it and the no-preload branch above is written *because* of it, but the
  suite runs Chromium and WebKit only — the branch is reached by disabling preload rather than by the
  engine that actually lacks it.

#### ⚠️ OPEN: `update.spec.ts` is intermittent on Chromium — not root-caused

Roughly 1 run in 3–5 of the full SSR config, **Chromium only**, `update.spec.ts` fails with a waiting
worker that is never applied. It is recorded here rather than retried away, because a flaky test on the
one path with no remote fix is itself a production-readiness problem.

What is MEASURED at the moment of failure:

| | |
|---|---|
| `registration.waiting` | `installed` — a complete worker, sitting there |
| `registration.installing` | `null` — nothing is in flight, the poll did not simply time out early |
| `registration.active` / `controller` | `activated` — the old worker is still in charge |
| `waiting.postMessage({type:"SKIP_WAITING"})` **by hand** | no effect after 15s |
| `registration.update()` then post again | no effect after 15s |
| a further `page.reload()` | **hangs** (hit a 900s test timeout) |

The last row is the interesting one. adaptv has no code that can make a navigation hang — the SSR
handler falls back to the precached shell after 3s (§3.3) — so this reads as the origin's whole service
worker machinery wedging under a harness that rebuilds the served output underneath a live
registration, rather than as the launch-apply branch being wrong. **That is a reading, not a diagnosis;
it is not root-caused.** Against it being an adaptv defect: WebKit never shows it, and the Simulator
walk below applied a real deploy across two real cold launches.

Worth knowing when picking this up: `page.reload()` is **not** a cold launch. The client stays alive, so
the browser never auto-promotes the waiting worker and adaptv's `SKIP_WAITING` is solely responsible —
in a true relaunch the previous client is gone and the browser promotes it with no message at all. The
spec wraps its final assertion so any recurrence prints the worker's full state instead of four
booleans.

#### 📱 Walked on the iOS Simulator — VERIFIED 2026-08-14

The automated suite cannot reach the target the whole layer is for, so the same behaviour is walked by
hand on real WebKit. `playground` → **Settings → Testing → Service worker** is the instrument: it
prints the worker's condition as plain text, because on a device there is no DevTools pane to open.

Measured on iPhone 16 Pro / iOS 18.0, SSR build (Nitro `node-server`), served over `http://localhost`
— which is a secure context, so registration is allowed:

| | |
|---|---|
| Safari tab, online | controlled ✓ · `active: activated` · **`navigationPreload: true`** · 112 precached · `caches.keys()` = the precache only |
| server **killed**, in-tab reload | boots from the precached shell |
| server killed, unvisited route | `/lab/list` renders in full — its chunk came from the precache, not the HTTP cache |
| **installed PWA, cold launch, server killed** | launches and navigates offline; 112 precached, no route document |
| deploy → cold launch #1 | `waiting: true`, and nothing else changes — the running build is left intact |
| cold launch #2 | applied; `waiting: false` |

Two things this settles that no automated run could. **Navigation preload is genuinely on in Safari**
(15.4+), so the §3.3 pair is doing its job on the target where SW boot latency costs the most. And the
`auto` update policy behaves exactly as §3.4 describes *in a standalone home-screen app*, which is the
only place "cold launch" is a real, frequent event.

> One harness trap, recorded so it is not re-diagnosed as a bug: `xcrun simctl openurl` with the server
> down lands on Safari's "can't connect" page. An in-tab reload of the same URL, at the same moment,
> boots from the precache. The external cold navigation is the thing that fails, not the worker — the
> installed-PWA row above is the case that actually matters, and it passes.

---

## 4. Over-the-air updates

- **Web + standalone (free, built-in):** new deploy → adaptv SW revalidates shell/assets → next load is
  fresh. This is the SW's job; no extra mechanism.
- **Capacitor (NOT free):** Capacitor does **not** check an upstream dir and swap the dist on its
  own. You need a live-update mechanism: `@capacitor/live-updates` (Appflow), Capgo, or DIY (download a
  zip → unpack to a data dir → point the WebView `serverBasePath` there → apply on next launch). App
  Store rules **allow** JS/CSS/asset OTA (no native-code change), so the vision is valid — but it's a
  component **adaptv must provide/wrap**, not something Capacitor gives for free.

---

## 5. Clean mental model (the summary)

- **Shell** (routes, components, logic): SSR for web first-paint, SPA for Capacitor — *same code*.
  Loaders/beforeLoad OK **as long as they're isomorphic**.
- **Data** (consumer-wired): remote via absolute URL and/or offline-first via IndexedDB / TanStack
  Query persister. **Never `createServerFn`** if you want Capacitor.
- **Delivery/OTA:** web + standalone → adaptv-owned SW (precache + shell fallback + SWR). Capacitor →
  live-update bundle swap (a mechanism adaptv wraps).

> **The one boundary that keeps a single codebase on all six targets: don't ban loaders — ban
> server-only calls.**

### Consumer checklist
- [ ] No `createServerFn`, no server routes, no server-only request/cookie reads.
- [ ] Loaders/beforeLoad fetch absolute URLs or read local storage — never assume a server.
- [ ] Data + auth token live client-side; data layer (Query + persister) is consumer-owned.
- [ ] Let adaptv own the service worker and (eventually) the Capacitor live-update path.
