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
   be called. This is why adaptv forces `render:"spa"` + `sw:false` for the capacitor target.
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

> ### ✅ BUILT — the consumer authors no service worker (2026-07-20)
>
> `src/sw.ts` no longer exists in a normal app. adaptv generates the worker into `.adaptv/sw.gen.ts` from
> the `web.sw` block and bundles that. **Verified: chopchop builds with no service-worker file at all**,
> shipping a real `sw.js` with 51 precache entries.
>
> **Why generation rather than a template to copy:** every decision a normal worker makes is *already*
> stated in `adaptv.config.ts` — the render mode picks the navigation strategy, `sw.register` picks the
> update policy, `precacheDocuments` picks the allowlist. An app-authored worker restates all of it in a
> lower-level vocabulary and then drifts. This is not hypothetical: chopchop's hand-written worker was
> still calling `registerInstallRouteWarmer` long after that function became the B25 privacy bug. A
> generated worker cannot fall behind, and cannot resurrect a removed API by copy-paste.
>
> Same principle as the splash screen, the offline component and the root route: **the consumer declares
> intent, adaptv writes the machinery.**
>
> **The escape hatch is unchanged and still wins** — write `src/sw.ts` (or point `web.sw.entry` at one)
> and adaptv bundles yours instead. That is for genuinely app-specific behaviour like push handling, not
> for restating config.

> ### ✅ BUILT — adaptv generates the app shell (2026-07-20)
>
> `dist/client/index.html` is now emitted by `adaptvShellEmitPlugin` from `renderAppShell`. **Verified in
> project-zero**, and it unblocked both features that were waiting on it: `host: "static"` now writes
> `index.html`/`404.html`/`.nojekyll`/`_redirects`, and the SSR precache fallback finally has a real
> file to bind to.
>
> **Measured, and it corrects an assumption:** TanStack Start emits **no HTML at all** in this
> configuration — not `_shell.html`, not `index.html`, even with `spa: { enabled: true }`. So "copy
> Start's shell" was never a foundation. `RENDERING.md §3.1.2`'s requirement that adaptv *generate* one
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
| `"ssr"` | `NetworkOnly` + `PrecacheFallbackPlugin({ fallbackURL: appShell })` | Preserve the per-request server render on **every** online navigation. The fallback is a build-time, **user-agnostic** shell whose only job is to boot the client router at `location.pathname`. |
| `"spa"` | `NavigationRoute(createHandlerBoundToURL(appShell))` | There is no per-request render to preserve — the classic app shell is correct. |
| `capacitor` | **no SW at all** + a defensive unregister | §3.5 |

**The refinement that makes SSR work: the shell must be the _catch handler_, not a blanket
`NavigationRoute` handler.** A blanket `NavigationRoute` hijacks *online* navigations too — which
silently converts an SSR app into a stale SPA for every returning visitor. `NetworkOnly` + a precache
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

This belongs in the **[cookbook](COOKBOOK.md)** — `§1` there has the full worked example, alongside the
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
import (`LIFECYCLE.md §1`). That behaviour is load-bearing here, not incidental — it must be preserved
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
which is a silent failure (`DECISIONS.md` L7).

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

**Documents are a different act that happens to use the same API — and the split is public vs
personalized, not SSR vs SPA:**

| Document | Precacheable? | Why |
|---|---|---|
| Public / user-agnostic (`/`, `/pricing`, a blog post) | **Yes — and useful** | Identical bytes for every visitor. Precaching gives an instant, offline-capable landing page. |
| Personalized (`/dashboard`, `/account`) | **No** | Cache Storage is per-origin, **not per-user**. |

The failure mode for the second row is concrete: fetching documents with `credentials:"same-origin"`
into a shared bucket means user A logs out, user B logs in on the same profile, and B is served A's
server-rendered HTML. Forcing `ignoreVary:true` discards `Vary: Cookie`, the one HTTP mechanism that
would partly protect against it. Secondary: SSR'd HTML embeds server-rendered data that re-hydrates and
re-fetches anyway, so caching it buys availability, not freshness.

**Only the app knows which routes are which — so it's an explicit allowlist, empty by default:**

```ts
sw: {
  // Public, user-agnostic routes only. Precached as documents, so they cold-load
  // instantly and work offline. Never list a route that renders per-user content.
  precacheDocuments: ["/", "/pricing", "/about"],
}
```

Safe by construction: naming a route is a deliberate act, and the default precaches nothing. Staleness
is handled by the existing build-tag namespacing — a new deploy mints a new precache, so these refresh
on update like every other asset.

> **This is what makes the "landing page + app in one codebase" case work.** SEO comes from the crawler
> receiving real SSR HTML (crawlers don't run service workers, so the SW is irrelevant to ranking); the
> allowlist then additionally makes that same page instant and offline-capable for humans.

**Consequences:** the legacy `sw.warm-routes.ts` is dropped — **not because prefetching is wrong, but
because it prefetched the wrong layer** (credentialed HTML instead of chunks). `ignoreVary` stops being
a global default; it's safe and useful on hashed assets, dangerous on documents, so it becomes per-rule.
Freshness belongs to the **data layer** (consumer-wired: TanStack Query + an IDB persister).

**Two edges worth knowing before precaching a large route tree:**

- **Workbox precache is all-or-nothing at install.** One 404 in the manifest fails the entire install
  and you get no SW at all. Low risk when the manifest is generated from real build output, but it makes
  deploy races (assets pruned while an install is in flight) a total failure rather than a partial one —
  which is another reason for the no-`--delete` deploy rule in §3.4.
- **Install downloads the whole app.** For a standalone PWA that is arguably correct — it is the
  analogue of installing a native app — but it should be a deliberate choice, so `sw.precacheRoutes`
  stays configurable rather than implicit.

### 3.3 🔒 Everything else the adaptv SW does

- **Precache every route chunk** (§3.2) — this *is* the offline story, and the reason navigation in a
  standalone PWA feels native. Once booted, the app navigates entirely offline with zero document
  caching. TanStack Router's `defaultPreload:"viewport"` remains a complementary warm-up for the
  *online* first visit, not a substitute.
- **Navigation Preload on.** A registered SW sits in the path of every navigation, so you pay SW boot
  latency (~50–250ms cold on mobile) even when the SW only passes through. `navigationPreload.enable()`
  starts the network request in parallel with SW startup. Two lines, strictly better — and it matters
  *more* in SSR mode (documents always hit the network) than in SPA mode.
- **Hashed `/assets/*` → `CacheFirst`**, not `StaleWhileRevalidate`. Content-hashed filenames are
  immutable; revalidating them is pure waste.
- **Unhashed same-origin static** (icons, manifest, fonts) → `StaleWhileRevalidate` + `ExpirationPlugin`.
- **API responses are never cached by the SW.** That's the data layer's job, on purpose.
- **Navigation denylist** borrows Angular ngsw's heuristic — *anything containing a dot is a file, not
  a navigation* (`/\/[^/?]+\.[^/]+$/`), plus `/api/` and `/_serverFn/`. Workbox's `NavigationRoute` has
  no such default, so without it you intercept file requests that happen to arrive with `mode:navigate`.
- **Activate-time cache sweep.** Buckets are namespaced `adaptv:<bucket>:<buildTag>`; on `activate`,
  every `adaptv:`-prefixed cache not ending in the current tag is deleted. `cleanupOutdatedCaches()`
  does **not** do this — it only removes precaches written by *older Workbox versions* — so without
  the sweep every deploy mints buckets that are never freed.

### 3.4 🔒 The update flow — `prompt` by default, never auto-reload mid-session

`skipWaiting` + `clientsClaim` means a new SW takes control of pages **loaded by the old SW**. Those
pages hold module graphs referencing the old build's hashed chunks, and precache activation deletes
them — so the next lazy `import()` in that open tab 404s at both cache and origin. Auto-reloading on
top of that also drops unsaved form state.

```ts
register?: "prompt" | "autoUpdate" | "manual"   // default "prompt"
```

- **`prompt` (default)** — the new SW installs and **waits**; old chunks stay reachable. adaptv exposes
  `useServiceWorkerUpdate() → { updateAvailable, applyUpdate() }`. Nothing happens without user intent.
- **`autoUpdate`** — applies automatically, but **only at a safe moment**: on `visibilitychange` back
  to visible, or the next top-level navigation. Never mid-interaction.
- **`manual`** — adaptv registers; the app owns everything.

Three supporting requirements, all unconditional:

1. **`vite:preloadError` handler**, with a `sessionStorage` loop guard — the net that makes even the
   bad case recoverable. Without the guard, a genuinely-missing asset becomes an infinite reload loop.
2. **`register(swUrl, { updateViaCache: "none" })`** and `Cache-Control: no-cache` on `sw.js`.
   Browsers cap the SW script's effective max-age at 24h regardless; `updateViaCache:"none"` is the fix.
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
