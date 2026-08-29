# adaptv — cookbook

> Worked examples for **consumer apps**. Everything here is a *pattern*, not framework surface — adaptv
> does not depend on any of it, and a consumer can ignore all of it.
>
> The distinction matters: `RENDERING.md` and `ARCHITECTURE.md` describe what adaptv **guarantees**.
> This file describes what a sensible app **does with those guarantees**. If a recipe here starts
> looking mandatory, that's a signal it belongs in the framework instead.
>
> Started **2026-07-20**.

---

## Index

| Recipe | Status | Framework surface it builds on |
|---|---|---|
| [1. Offline UI, rendered in place](#1-offline-ui-rendered-in-place) | ✅ written | `offlineComponent`, `useIsOffline()` |
| [2. One screen, its own browser chrome](#2-one-screen-its-own-browser-chrome) | ✅ written | `chromeTint` route option (`DECISIONS.md` B33) |
| 3. Auth guards in `beforeLoad` | ⚠︎ stub | isomorphic router hooks (`RENDERING.md §2`) |
| 4. Offline-first data with an IDB persister | ⚠︎ stub | `storage.store` (`ARCHITECTURE.md §2.2`) |
| 5. Refetch-on-resume | ⚠︎ stub | `useAppState` (`COORDINATION.md`) |
| 6. Bearer-token auth + secure storage | ⚠︎ stub | `storage.secure` (`ARCHITECTURE.md §2.3`) |
| 7. Deep-link → route mapping | ⚠︎ stub | `appUrlOpen` normalisation (`DECISIONS.md §5.0.3`) |

---

## 1. Offline UI, rendered in place

### The framework contract (what adaptv guarantees)

Exactly two things — see `RENDERING.md §3.1.1`:

1. **`useIsOffline()`** — one accurate connectivity signal. `@capacitor/network` on native,
   `navigator.onLine` + `online`/`offline` events on web. adaptv owns this because
   **`navigator.onLine` alone lies** — it reports whether a network interface exists, not whether
   anything is reachable.
2. **`offlineComponent`** — your component, registered in `adaptv.config.ts`, with optional props.

adaptv decides **nothing** about when your data is missing. That's yours.

### The component

One component, two call sites. All props optional, which is what lets it serve both.

```tsx
// src/components/offline.tsx
import { View, Button } from "@arrzdev/adaptv/components"

export type OfflineProps = {
  /** adaptv passes `location.reload`; you pass `refetch` / a router invalidate. */
  onRetry?: () => void
  /** Present when adaptv rendered this after a chunk-load or route-resolution failure. */
  error?: Error
}

export function Offline({ onRetry, error }: OfflineProps) {
  return (
    <View fill center safe className="gap-4 px-6">
      <h1 className="text-lg font-medium">You're offline</h1>
      <p className="text-center opacity-70">
        {error ? "Something didn't load." : "Check your connection and try again."}
      </p>
      {onRetry && <Button onPress={onRetry}>Retry</Button>}
    </View>
  )
}
```

```ts
// adaptv.config.ts
export default defineApp({
  offlineComponent: () => import("@/components/offline"),
})
```

> **⚠︎ The thunk looks lazy but isn't, and that's load-bearing.** The Vite plugin reads the specifier
> and emits a **static import** in the generated root. If it were a real dynamic import, the offline
> chunk would be unavailable in exactly the situation it exists for. → `RENDERING.md §3.1.2`.

### Rendering it yourself — the predicate

**`isOffline` alone is the wrong test in both directions.** Offline *with* a warm cache should render
normally; online-but-the-request-failed usually wants the same UI as offline. The real question is
*"do I have anything to show?"*

#### With TanStack Query (what this author uses)

`fetchStatus === "paused"` is the precise signal — it means `onlineManager` reported offline so Query
**parked** the fetch rather than failing it:

```tsx
export const Route = createFileRoute("/product/$id")({
  component: Product,
})

function Product() {
  const { id } = Route.useParams()
  const { data, fetchStatus, refetch } = useQuery({
    queryKey: ["product", id],
    queryFn: () => fetchProduct(id),
  })

  // Nothing cached AND can't fetch → offline UI, in place, still at /product/$id
  if (!data && fetchStatus === "paused") return <Offline onRetry={refetch} />

  // Persisted cache hit → render normally, offline or not
  return <ProductView data={data} />
}
```

Better than a boolean check because **recovery is automatic**: Query resumes the parked fetch on
reconnect and the route swaps to real content — no retry logic, no navigation.

For `paused` to be trustworthy, feed adaptv's signal into Query's `onlineManager`. Opt-in, only if you
use Query:

```ts
import { onlineManager } from "@tanstack/react-query"
import { subscribeNetwork } from "@arrzdev/adaptv/capabilities"

onlineManager.setEventListener((setOnline) =>
  subscribeNetwork(({ connected }) => setOnline(connected)),
)
```

#### Without a data library

Same shape, your own predicate:

```tsx
const [data, setData] = useState<Product | null>(null)
const [failed, setFailed] = useState(false)
const isOffline = useIsOffline()

if (!data && (failed || isOffline)) return <Offline onRetry={load} />
```

### Why in place, and not a redirect to `/offline`

Same reasoning as error boundaries — render where the failure happened.

| | Redirect to `/offline` | Render in place |
|---|---|---|
| URL | destroyed — `/product/xxx` → `/offline` | preserved |
| Route params | lost, so retry can't rebuild the request | intact |
| Recovery | user must navigate back manually | route re-runs its own query, swaps to content |
| Back button | extra history entry, or a trap on refresh | untouched |
| Granularity | one global screen | per-route — product shows cached + banner, checkout hard-blocks |

### What you get for free on native

**Nothing to configure.** There's no SW and no shell — the bundle is on-device from install, so React
always boots. The only thing that can fail is *data*, and the recipe above handles it identically.
One mechanism, six targets.

### The one case nothing can fix

**First-ever load, while offline, on web.** No document cached → no JS runs → no component can render;
the user gets the browser's error page. Inherent to service workers (a SW must install online at least
once). **Cannot occur on native**, and is near-absent on standalone PWA since installing implies a
successful visit. Browser-first-visit only.

---

## 2. One screen, its own browser chrome

A route can say what colour the browser's chrome should be while it is on screen — the toolbar above
a mobile web page, and the bands above and below an installed app.

```tsx
export const Route = createFileRoute("/settings")({
  chromeTint: "#1e0033",
  component: Settings,
})
```

That is the whole recipe. There is no hook to call, no effect to write, and no cleanup: a route that
declares nothing gets the `themeColor` from `adaptv.config.ts`, so leaving is as automatic as
arriving.

**Three rules, and each is load-bearing.**

**It must be a literal** — written inline, or held by a top-level `const` in the same file. adaptv
reads the colour out of your source at build time and puts it in the pre-paint script, so a cold
launch straight onto `/settings` shows the colour on its *first* frame instead of flashing the theme
first. A computed value cannot be there in time, so the build refuses it and names the file rather
than shipping the flash.

**One colour, in both themes.** A route that pins the chrome pins it. If a screen should follow the
app's light/dark theme, declare nothing.

**No inheritance.** A layout's tint does not reach its children; the fallback is always the app's
global colours. A tinted section means one line per route in it.

**What you will see where.** Android Chrome tints its toolbar. iOS ≤ 18 tints the status bar. iOS 26+
ignores the meta tag entirely and takes the colour from the rendered page edge instead — adaptv writes
both, so you do not choose. An installed PWA and a native build have no toolbar, but the safe-area
bands are the same paint. Firefox does nothing, and desktop browsers mostly do nothing. Nothing here
needs a platform check at your call site. → `DECISIONS.md` B17, B33; `/lab/route-tint` in the
playground.

To animate the chrome instead of pinning it — a sheet dimming the toolbar as it slides — that is
`useChromeTint()`, a different tool for a different job. → `DECISIONS.md` B32.

---

## 3–7. Stubs

Each of these has a decision recorded elsewhere and wants a worked example before 1.0:

- **Auth guards in `beforeLoad`** — client-side only; `beforeLoad` is a *Router* feature and runs
  isomorphically, so it works in a Capacitor bundle. The trap is calling anything server-only from it.
  → `RENDERING.md §2`, `FACADE.md`.
- **Offline-first data with an IDB persister** — `storage.store` is an async blob KV, deliberately
  **not** a query engine; the persister and query layer are consumer-wired.
  → `ARCHITECTURE.md §2.2`. Note the `gcTime` ≥ `maxAge` trap in `DECISIONS.md §5.0.3`.
- **Refetch-on-resume** — `useAppState` is the signal; it also drives the OTA check.
  → `COORDINATION.md`.
- **Bearer-token auth + secure storage** — cookies do not work cross-origin in a WebView, and this is
  architectural rather than a misconfiguration. `@capacitor/preferences` is **plaintext** and must not
  hold tokens. → `DECISIONS.md` B23.
- **Deep-link → route mapping** — `appUrlOpen` payloads and `getLaunchUrl()` semantics differ per
  platform and need normalising; memory history must be seeded from the deep link at boot.
  → `DECISIONS.md §5.0.3`.
