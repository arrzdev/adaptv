# adaptv — dev-loop debt

> 📐 **Seven named items of debt against machinery that already works.** Was
> `DEV-LOOP-REVIEW.md`; renamed and moved here 2026-08-30 because every remaining item is work not yet
> done.
>
> **Two of the original nine are discharged and have been removed:**
>
> | Was | Discharged by |
> |---|---|
> | **§C** — "the `adb reverse` keeper treats a symptom; add the instance lock instead" | `bin/lib/lock.mjs` **is** that instance lock. A second `dev` now fails fast naming the pid and url, and `preview`/`build` refuse while a `dev` run owns the config. |
> | **§F** — "`OFFLINE_PAGE` is duplicated with a *keep in sync* comment" | Still duplicated, but the duplication is now **mechanised** by `src/shell/offline-page-name.test.ts`, so drift fails the suite. The concern, not the duplication, was the item. |

Written after landing #3–#7 (live-reload, offline screen, config-as-artifact, run
cache, `r`/native-change detection). Everything here works and is stress-tested on
an iOS Simulator + Android emulator. This document is about the *shape* of it.

Most of these pieces were built while the failure modes were still being
discovered, so several solve a symptom rather than a cause, and a couple of
hand-rolled mechanisms may now have a supported equivalent. That's the debt worth
paying down while it's all still fresh.

**Rule for every item below: nothing lands without the same stress test the
original did** — fresh render, hot reload, hot reload after relaunch, server killed
mid-session, reconnect, cache hit/miss, and config revert, on both platforms.
These are dev-loop mechanics; a regression here is invisible until it wastes an
afternoon.

---

## A. Replace the hand-rolled HMR socket with Vite's own events

**Today.** `src/shell/native-live-reload-client.ts` (227 lines) fetches
`/@vite/client`, pulls the per-session `wsToken` out of it *with a regex*, opens a
second `vite-hmr` WebSocket mirroring Vite's, and layers on a 4s liveness poll, a
`visibilitychange` hook, and a no-token fallback.

**Why it looks like that.** We needed to know when the channel died. Vite's client
gives up on a clean close (WKWebView closes cleanly on idle), and at the time the
only visible signal we found was the socket itself.

**What we know now.** Vite 8 emits `vite:ws:disconnect` and `vite:ws:connect` as
custom HMR events, and the `close` listener that emits them stays attached after
the socket opens — so a later close *should* fire it:

```ts
import.meta.hot.on("vite:ws:disconnect", () => recover())
```

If that holds, the token scrape, the mirror socket, and probably the liveness poll
all delete, leaving just the recovery policy (probe → reload, or → offline screen).
That regex against Vite's internals is the most fragile thing we own; it breaks
silently on any Vite refactor, and the symptom is "hot reload quietly stopped".

**Risk / how to prove it.** Emitting the event and *reconnecting* are different
things — Vite may fire it and still not retry, which is fine (we do the retrying).
The real question is whether it fires on the exact WKWebView clean-close path the
proxy was built for. Reproduce the deaf state on iOS (`lsof -nP -iTCP:7171 | grep -c
com.apple` = 0 while the server still serves) and confirm the event arrives. If it
doesn't fire there, keep the proxy and delete nothing.

---

## B. Two fingerprints, two different hashing strategies

**Today.** `fingerprint()` hashes the whole app tree by **path + size + mtime**.
`nativeFingerprint()` hashes a curated native input set by **content**.

**Why.** The native one *had* to be content-based: `generateAssets` re-stamps
byte-identical icons and theme files on every run, so an mtime hash never matched
and the cache never hit once (measured).

**What to do.** Pick one strategy. The web fingerprint has the same hazard in
principle — any step that rewrites an identical file invalidates it — and the two
being different is a trap for whoever reads this next. Content hashing is the
honest question ("what does it contain"), and at native scale it costs nothing.

**Measured (2026-09-02, M3 Max, warm cache, median of 5×30).** Over `fingerprint()`'s
exact walk of the playground app — 422 files / 11.0 MB — mtime costs **3.0 ms** and a
sha1 content hash costs **11.3 ms**: 3.8×, ~8 ms absolute, called twice per
`build ios` (both times with the same answer) in a build that takes 29 s. The native
set is 0.93 ms (ios, 28 files) / 1.81 ms (android, 73 files) by content — the
"22.9 ms" figure the code once cited does not reproduce. So the cost is not material
either way; pick on honesty, not speed.

**The larger finding the measurement turned up.** 242 of those 422 files (57%) and
8.1 of the 11.0 MB (74%) were `.output/` — the SSR lineage's build output, which
`SKIP_DIRS` did not list (it had `dist`, not `.output`). Reproduced twice:
`build ios` 34.5 s → `build web` 4.1 s (rewrites `.output/`) → `build ios` **33.9 s**
full rebuild with nothing under `src/` changed → `build ios` 4.2 s. Fixed in the
same PR as this note by adding `.output` to the skip list, with a test — L14 says
the two lineages never cross, and the fingerprint was the one place they did.

---

## D. `relaunchAndroidApp` still touches every connected device

`launchInstalledApp` correctly resolves the target's serial via
`androidSerialForTarget` (an AVD name like `Pixel_10` is not a serial like
`emulator-5554`). `relaunchAndroidApp` — used on the cache-miss path — still
force-stops and launches on **every** connected emulator.

Latent bug: running nativ against one emulator disturbs the others. Same fix,
already written, just not applied there.

---

## E. `warmDevServer`'s heuristic could become a real signal

Waiting for "two reads >500 bytes, then 1s of quiet" is a proxy for "Vite finished
re-optimizing deps". We already parse Vite's stdout for HMR lines, and Vite
announces re-optimization there. Watching for the actual event would be precise
instead of magic-number-shaped.

Low priority — the current one works and is well-commented. Worth doing only if we
touch that file anyway.

---

## G. `androidScheme: "http"` — keep, but pin down the blast radius

Set for the dev session so the offline page can `fetch`-probe the dev server
(Android never gets the Capacitor bridge on an errorPath page, so `CapacitorHttp`
isn't available). It earns its keep: it's what makes Android's offline → live
seamless.

But it changes the local origin in dev, and the reasoning that it's harmless
("live-reload means the app runs from the dev-server origin, so the local origin
only ever serves the offline page") deserves an explicit test rather than a
comment — specifically that nothing app-side reads storage or a secure-context API
from the local origin during a dev run.

---

## H. The offline page navigates on *any* HTTP answer

The reconnect probe treats `status > 0` as "server is back", including a `500`
thrown while Vite/workerd is still booting. That can bounce the app onto an error
page for a beat before it settles.

Tighten to 2xx/3xx, or accept 5xx only after N consecutive attempts (so a genuinely
500-ing app still reconnects rather than sitting on the offline screen forever).

---

## I. `r` means something different here than in Expo

| | Expo | nativ |
|---|---|---|
| `r` | reload the JS bundle — instant | full native rebuild + reinstall — ~15s |

The cheap action is the one you want most often; ours costs 15s and drops app
state. Split them: `r` reloads the WebView, `shift-R` (or `b`) rebuilds natively.
This also softens the tradeoff from #7 — a wedged-JS app gets an instant fix
instead of needing a full reinstall.

---

## Known-unfixed (pre-existing, not from this work)

- **Hydration mismatch on every boot.** The prerendered shell contains the splash
  div; the client renders a Suspense fallback. React recovers, but it discards and
  re-renders the tree on *every* launch. Real cost, never investigated.
- **`pipeline("run", …)` is dead code** — a complete static build→install→launch
  path that nothing dispatches to. It's most of the `preview` command already.
- **`nativ.mjs` biome warning** (`noUnusedVariables`) predates all of this.
- **The `dev` / `preview` / `build` split** with `.dev` app identifiers is still
  unbuilt. Note it interacts with the run cache: a different appId is a different
  installed app, so the cache key needs it, and alternating modes rebuilds unless
  outputs are cached per-mode.

---

## Suggested order

1. **A** (Vite's ws events) — deletes the most fragile code we own, *if* it proves out.
   Still live: `src/shell/native-live-reload-client.ts` is **228 lines** (this doc said 227).
2. **D** (target the right device) — small, latent bug
3. **H** — small correctness/robustness
4. **I** (`r` semantics) — UX, cheap
5. **B** (unify fingerprints) — measured (§B, 2026-09-02): ~8 ms either way, so the pick is on
   honesty, not speed; the `.output` hole the measurement turned up is already fixed. ⚠️ **This is the same bug
   `docs/DEVELOPMENT.md` calls out**: a framework-only change reports `✓ web build · cached`, which
   that doc names "a real bug". Two fingerprints with two hashing strategies is the cause.
6. **E**, **G** — only if already in the file

**A** is now the one item that changes how much code exists (**C**, its partner, has shipped as
`bin/lib/lock.mjs`). The rest is tidying.
