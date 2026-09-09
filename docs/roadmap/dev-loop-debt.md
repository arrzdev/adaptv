# adaptv — dev-loop debt

> 📐 **Four named items of debt against machinery that already works.** Was
> `DEV-LOOP-REVIEW.md`; renamed and moved here 2026-08-30 because every remaining item is work not yet
> done.
>
> **Five of the original nine are discharged and have been removed:**
>
> | Was | Discharged by |
> |---|---|
> | **§C** — "the `adb reverse` keeper treats a symptom; add the instance lock instead" | `bin/lib/lock.mjs` **is** that instance lock. A second `dev` now fails fast naming the pid and url, and `preview`/`build` refuse while a `dev` run owns the config. |
> | **§D** — "`relaunchAndroidApp` still touches every connected device" | `bin/lib/native.mjs` `relaunchAndroidApp` resolves the run's serial through `androidSerialForTarget` and force-stops / relaunches on that ONE serial; the all-devices sweep is reached only when the target cannot be resolved. Pinned by `bin/lib/native-relaunch.test.mjs` — "force-stops and relaunches on the ONE serial the AVD name resolves to" and "falls back to every connected device only when the target is unresolvable". |
> | **§F** — "`OFFLINE_PAGE` is duplicated with a *keep in sync* comment" | Still duplicated, but the duplication is now **mechanised** by `src/shell/offline-page-name.test.ts`, so drift fails the suite. The concern, not the duplication, was the item. |
> | **§H** — "the offline page navigates on *any* HTTP answer" | `bin/lib/offline-page.mjs` `reconnectDecision`: 2xx/3xx navigate at once, a 4xx/5xx waits and navigates only once it has persisted for `NOT_READY_LIMIT` (5) consecutive probes, and status 0 (nothing answered) never navigates. The page embeds that function's source, so the test runs the page's own logic. Pinned by `bin/lib/offline-page.test.mjs` "the reconnect decision" — five cases, including "never goes on 0, however many times" and "is the same function the page runs, and it stands alone there". |
> | **§I** — "`r` means a full native rebuild" | `bin/lib/render.mjs` `onKeys`: `r` → `onReload` (the JS, no reinstall), `b` → `onRebuild` (the native app), `q` / ctrl-c → `onQuit`, and `R` is deliberately nothing so a shift typo cannot swap a 0.4s reload for a 15s reinstall. `bin/adaptv.mjs` wires `reload` / `rebuild` to both the raw-mode `onKeys` and the Ink `inkWatcher` (`bin/ui/watch.mjs` maps the same three keys). Pinned by `bin/lib/render-keys.test.mjs` — "'r' reloads the JS and nothing else", "'b' rebuilds the native app and nothing else", "'R' does nothing — a shift typo never swaps a reload for a reinstall", "'q' and ctrl-c both quit", and "the disposer removes the listener and leaves raw mode off". |

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

**Pinned 2026-09-02.** The reasoning is now `bin/lib/live-reload.test.mjs` rather than a
comment: the dev session points the app at the dev-server origin and the local origin at one
document; teardown takes the cleartext scheme away again; a built config never carries it; and
the offline page reads none of storage, cookies, credentials, service workers, notifications,
geolocation or `crypto.subtle`, reaching the dev server by a plain `fetch` and nothing else.
The last one bites: adding a single `localStorage` read to the page fails it.

Measured on the Pixel emulator during a real `dev android` run (app id `dev.arrz.projectzero.dev`,
dev server on 41840). With the server up, the app runs from the dev-server origin, which is what
makes the local origin's scheme a question about one page and not about the app:

    {"origin":"http://localhost:41840","href":"http://localhost:41840/","secure":true}

With the server stopped, the WebView falls to the local origin, and it is the offline page:

    {"origin":"http://localhost","href":"http://localhost/adaptv-offline.html","secure":true}

`isSecureContext` is **true on both**. `http://localhost` is potentially trustworthy by
specification, so the dev scheme costs the local origin no capability at all — the thing it changes
is the transport, and the only document that travels over it is a static page adaptv generates.

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
2. **B** (unify fingerprints) — measured (§B, 2026-09-02): ~8 ms either way, so the pick is on
   honesty, not speed; the `.output` hole the measurement turned up is already fixed. ⚠️ **This is the same bug
   `docs/DEVELOPMENT.md` calls out**: a framework-only change reports `✓ web build · cached`, which
   that doc names "a real bug". Two fingerprints with two hashing strategies is the cause.
3. **E** — only if already in the file. **G** is discharged: its claim is a test now.
4. The **Known-unfixed** list — none of it is from this work, and none of it has an owner yet;
   the hydration mismatch is the one with a cost paid on every launch.

**A** is now the one item that changes how much code exists (**C**, its partner, has shipped as
`bin/lib/lock.mjs`, and **D**, **H** and **I** were already in the code — what they lacked was a
test, and each now has one). The rest is tidying.
