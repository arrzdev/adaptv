# nativ — rendering, delivery & the isomorphism boundary

> The contract that lets **one codebase** run correctly as SSR web, standalone PWA, and a native
> Capacitor app. Captures *why* the boundaries are where they are, and the **hard limitation** that
> falls out of it: nativ code must be **isomorphic** — no server-only logic (`createServerFn`, server
> routes, request/cookie reads) if you want it to run on all targets.
>
> Locked understanding as of 2026-07-14. Pairs with `VISION.md` §"Build, distribution & updates" and
> §"Data, offline & storage". This is doctrine, not a changelog.

---

## 1. The two facts

1. **Capacitor → must be a static SPA.** The WebView loads a static `index.html` from the on-device
   bundle. There is **no server in the app**, so nothing can server-render and no server function can
   be called. This is why nativ forces `render:"spa"` + `sw:false` for the capacitor target.
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
| Desktop web | SSR (default) or SPA | yes (SSR) | nativ-owned | SW revalidate |
| Standalone PWA | same as web | yes (SSR) | nativ-owned | SW revalidate |
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

## 3. Delivery — nativ owns the service worker

**"Cache every page" is the wrong framing.** You don't cache page *HTML*; you precache the **JS/CSS
route chunks** (Workbox precache manifest — nativ builds this). Combined with client-side routing +
`defaultPreload:"viewport"`, every route is instantly available offline **without** caching documents.

- Caching SSR'd **HTML** with stale-while-revalidate is a trap: the HTML embeds stale SSR data that
  re-hydrates and re-fetches anyway → it buys offline-shell availability, not data freshness.
- The robust shape: **precache assets + a navigation-fallback to the app shell**, and let the **data
  layer** own freshness (consumer-wired).
- nativ owns this SW so the consumer never hand-writes it: precache + `NavigationRoute` shell fallback
  + SWR on shell/assets + `autoUpdate`.

---

## 4. Over-the-air updates

- **Web + standalone (free, built-in):** new deploy → nativ SW revalidates shell/assets → next load is
  fresh. This is the SW's job; no extra mechanism.
- **Capacitor (NOT free):** Capacitor does **not** check an upstream dir and swap the dist on its
  own. You need a live-update mechanism: `@capacitor/live-updates` (Appflow), Capgo, or DIY (download a
  zip → unpack to a data dir → point the WebView `serverBasePath` there → apply on next launch). App
  Store rules **allow** JS/CSS/asset OTA (no native-code change), so the vision is valid — but it's a
  component **nativ must provide/wrap**, not something Capacitor gives for free.

---

## 5. Clean mental model (the summary)

- **Shell** (routes, components, logic): SSR for web first-paint, SPA for Capacitor — *same code*.
  Loaders/beforeLoad OK **as long as they're isomorphic**.
- **Data** (consumer-wired): remote via absolute URL and/or offline-first via IndexedDB / TanStack
  Query persister. **Never `createServerFn`** if you want Capacitor.
- **Delivery/OTA:** web + standalone → nativ-owned SW (precache + shell fallback + SWR). Capacitor →
  live-update bundle swap (a mechanism nativ wraps).

> **The one boundary that keeps a single codebase on all six targets: don't ban loaders — ban
> server-only calls.**

### Consumer checklist
- [ ] No `createServerFn`, no server routes, no server-only request/cookie reads.
- [ ] Loaders/beforeLoad fetch absolute URLs or read local storage — never assume a server.
- [ ] Data + auth token live client-side; data layer (Query + persister) is consumer-owned.
- [ ] Let nativ own the service worker and (eventually) the Capacitor live-update path.
