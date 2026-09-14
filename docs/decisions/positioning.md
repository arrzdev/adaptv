# adaptv — positioning: why not just use Ionic

> Two halves of one argument. **§1 is the market picture** — who else is in this space and how
> healthy they are (lifted from the decision register 2026-08-30, out of what was then `DECISIONS.md §6.1` — now [`register.md`](register.md)).
> **§2 is the concrete dev-loop comparison** against Ionic, the closest existing thing
> (was `VS-IONIC.md`, deleted 2026-08-30 — see git history).
>
> Neither is a decision on its own; together they are the standing answer to "why does this
> exist," and they should inform every decision in this folder.

---

## 1. The honest market picture (2026-07-20)

Not a decision, but it should inform every decision above. Numbers are npm downloads/month and GitHub
stars, pulled live.

**The number that validates the thesis:**

| Package | Downloads/month |
|---|---|
| `react-native` | 41.1M |
| `expo` | 27.5M |
| **`@capacitor/core`** | **12.3M** |
| `@ionic/angular` + `@ionic/react` + `@ionic/vue` | **~1.5M combined** |
| `konsta` (styling-only UI kit) | 56K |
| `capstart` (the closest competitor) | **289** |

**~8:1 Capacitor-to-Ionic-UI.** Millions of developers already chose Capacitor *and rejected Ionic's UI
layer* — so they are hand-rolling navigation, transitions, gestures, and safe areas, or shipping
something that feels like a website. **Nothing has absorbed that demand.** Capacitor is also ~30% of
React Native's volume; this is not a fringe runtime.

**The incumbent is genuinely stuck.** Ionic Framework human commits are **down 82% from peak**; 80% of
the last year's human commits come from **3 people**. OutSystems discontinued all Ionic commercial
products in Feb 2025, and the OSS survives explicitly because *"they form a significant portion of the
OutSystems mobile stack"* — not from independent investment. `@ionic/react-router@8.8.14` (July 2026)
is **still pinned to React Router v5**; issue #24177 ("React Router v6 support") has **409 👍 and has
been open since Nov 2021** — the highest-voted issue in the repo. Ionic 9 (Q3 2026) is a pure catch-up
release; the modular rewrite is deferred to v10 with no date. They ship **two themes, ios + md**, where
`md` is **Material Design 2 — two generations behind Android** — and have publicly declined to build an
iOS 26 Liquid Glass theme.

**Capacitor itself is healthy** — 110 open issues, well-groomed, Cap 9 in alpha. That asymmetry is close
to ideal for adaptv: the native bridge is funded and thriving; the UI-layer competitor is not.

### Three things that should temper the thesis

1. **adaptv is not first.** [Capstart](https://github.com/AdrienADV/capstart) shipped 2026-02-14,
   explicitly supports TanStack Start, was pushed *yesterday* — and after five months has **26 stars and
   289 downloads/month**. That is the most direct read on *organic* demand available, and it's
   discouraging. Whatever adaptv ships must have an answer for why it wins where Capstart hasn't.
2. **The space has no cultural energy.** The top on-topic HN thread in 18 months
   ([Ask HN: Webview vs React Native](https://news.ycombinator.com/item?id=46371761), Dec 2025) got
   **1 point and 3 comments**. Industry momentum in 2025–26 went the *other* way — Snapchat open-sourced
   **Valdi** (TypeScript → native views, no webview, no bridge) in Aug 2025. The objection to beat is
   verbatim: *"I have yet to see a webview that doesn't feel like a webview."* **That has to be beaten in
   a demo, not a README.**
3. **The demand is latent, not expressed.** Those millions of Capacitor-without-Ionic developers aren't
   asking for a framework — they already routed around the problem with Tailwind and hand-rolled
   components. Switching costs are real.

### Dependency health — two traps in the obvious picks

**`vaul` is dead, and adaptv's `Drawer` cannot depend on it.** On 2025-10-03 Emil Kowalski replaced the
README with *"This repo is unmaintained. I might come back to it at some point, but not in the near
future."* Worse: npm `latest` is **1.1.2 from December 2024**, while fixes merged to `main` in July 2025
were **never published**. Permanently open: iOS buttons unclickable when tapping text (#652), nested
drawers inconsistent on Android 12+ (#646), back-gesture handling (#645), snap-point scroll (#635) —
i.e. *exactly* the iOS/nested/keyboard class adaptv cares about. Its 37M weekly downloads are shadcn
inertia, not health. **Read its source before it bit-rots; don't depend on it.**

**`@use-gesture/react` is dormant with no deprecation notice** — last publish 2024-03-21, ~2 years, crash
fixes sitting unmerged, and broken against its own sibling `react-spring` v10. 5.6M downloads/week makes
it look alive. It isn't. adaptv already peer-deps `motion`; keep it that way and build only the
pinch/wheel remainder `motion`'s `drag` doesn't cover.

**Safe picks, confirmed healthy:** `motion` 12.42.2, `@tanstack/react-virtual` (pushed today),
`embla-carousel` (pin 8.x — v9 has been in RC since January), `vite-plugin-pwa` — and note the last one
insulates adaptv from the Workbox maintenance question entirely, which matters given `docs/design/rendering.md §3.6`
picks Workbox. The vite-pwa org began a from-scratch ESM Workbox reimplementation in Oct 2025; if it
lands, adaptv inherits it free.

### App Store 4.2 — rejection is never "it's a WebView"

The canonical rejection string is *"the experience your app provides is not sufficiently different from
a web browsing experience, as it would be if displayed in Safari."* The instructive case: an app that
**already had push notifications, offline access and deep links was still rejected** — what fixed it
across three submissions was removing `InAppBrowser` link-outs, rebuilding the UI to feel native, and
fixing **white-flicker on launch** and iPhone X+ header glitches.

> **Native plugins are not sufficient. Perceived nativeness of the UI is what the reviewer scores** —
> and reviewers literally screenshot the chrome.

Most of the mitigations are things adaptv already owns, which is the point — **the framework should make
apps pass 4.2 by default**: local-first bundle (make a remote-URL shell loud to opt into — that's 4.2.2
on sight), no browser chrome ever, native splash with **no white launch flash** (already solved — §1.4),
correct safe areas, external links through `SFSafariViewController` by default with a lint rule on
`window.open`, offline state as a first-class surface rather than a browser error page, and a generated
privacy manifest (§5.0.1). Cheapest possible addition: **a reviewer-notes generator** enumerating every
native plugin the app actually uses.

The 2025-26 enforcement wave (Guideline 4.3(b), revised 2026-06-08, now claims removal authority over
shipped apps) targets **AI slop, dynamic code generation and payment circumvention — not hybrid
frameworks.** OTA stays explicitly legal per DPLA §3.3.1(B); the real hazard is dark-shipping unreviewed
features, which is 2.3.1 misrepresentation. **Google Play's sharper risk is different**: the top
suspension cause for WebView apps is **domain ownership**, not functionality — *"we don't allow apps…
[that] provide a webview of a website without permission from the website owner."*

### The defensible wedge, stated precisely

Two halves, and **the second is the stronger one**:

- **UI primitives** — platform-correct navigation, transitions, gestures, safe areas, without adopting
  Ionic's router and component system. This is where the *volume* is, and also where taste, the
  "feels like a webview" objection, and Ionic's 52K-star incumbency make it hardest to win.
- **The isomorphism boundary** — `createServerFn` genuinely breaks in a Capacitor bundle (it expects a
  co-located Start server at `/__server`, absent at `capacitor://localhost`). Today every developer
  solves this by hand from a blog post. It is **concrete, documented, reproducible, and framework-shaped**
  — exactly where a framework earns its existence. `docs/decisions/facade-and-opacity.md` §2 turns it from a doc rule into a build
  failure, which nobody else does. The owner's direction since 2026-09-14 sharpens the wedge: the
  artifact with no server refuses with a report of what it reaches, and a web-only app keeps server
  functions and the rest of the harness → `docs/roadmap/server-boundary.md`.

> **Consequence for sequencing:** `docs/decisions/facade-and-opacity.md`'s ban mechanism and `docs/design/rendering.md`'s delivery model are the
> *differentiated* work. The primitive layer is the volume play but the contested one. Ship the wedge
> first.

---

---

## 2. adaptv vs Ionic — the dev loop, measured


Both adaptv and Ionic put a native WebView in front of a Vite dev server so web-code edits
hot-reload on a device. Capacitor is the shared substrate. The interesting differences are
in what happens **around** the happy path — recovery, ergonomics — and in one capability
Ionic has that we don't yet: physical devices.

This doc exists to (a) keep a running list of what we do better, so it doesn't get lost,
and (b) record the design for closing the physical-device gap, including *why the obvious
attempt fails*.

---

### Where adaptv wins

#### 1. Auto-heal when the dev server dies (the headline)
Ionic **does not recover**. Kill the dev server and the WebView is stuck on a blank/black
`ERR_CONNECTION_REFUSED` page until you manually cold-relaunch or rebuild. Their own
reasoning is exact and worth keeping: the live-reload retry rides a websocket that only
exists *after* a page has loaded and the client script connected — so if the first load
already failed, no socket was ever opened, and there's nothing listening for "server's
back." The channel that would heal it never exists.

adaptv heals both directions with no user action:
- The dev server going down mid-session → the in-app watchdog
  (`src/shell/native-live-reload-client.ts`) notices and navigates to a branded offline
  screen instead of a black WebView.
- The server coming back → the offline screen polls it (native `CapacitorHttp` on iOS, a
  plain `fetch` on Android — see `bin/lib/offline-page.mjs`) and navigates back the instant
  it answers 2xx/3xx. No relaunch, no rebuild.
- Even the WKWebView "clean-close deaf socket" case (Vite's client gives up on a `wasClean`
  close) is caught by our own reconnect proxy — a failure mode Vite itself doesn't handle.

> Verified end-to-end: SIGKILL the run → offline screen → restart → app reconnects to live
> on its own. See `adaptv-offline-dev-screen` / `ios-wkwebview-hmr-warm-server` memories.

#### 2. An offline screen, not a black rectangle
When the server is down the dev sees "Development build — `$ adaptv dev ios`" with a live
spinner, not a blank page they have to guess at.

#### 3. Config can't get wedged
Ionic's own documented gotcha: an unclean run can leave `server: { url: … }` behind in
`capacitor.config`, and then even a "normal" build keeps loading the dead dev server —
you have to hand-check the file. adaptv regenerates `capacitor.config.json` from scratch
before every command and `patchServerUrl` strips a stale live-reload block on the next run,
so a SIGKILL'd `dev` can never poison a later `build`/`preview`.

#### 4. `r` reload vs `b` rebuild
A web-code edit that wedges the JS doesn't need a 15s native reinstall. `r` relaunches the
app (fresh document from the dev server, ~0.5s); `b` reinstalls the binary for a real native
change. Ionic gives you one heavy path.

#### 5. Single-instance lock
A second `dev` fails fast with a clear message (naming the pid + url) instead of a cryptic
port collision, and `preview`/`build` refuse while a `dev` run owns the config.

#### 6. Run cache
An unchanged native project relaunches from cache in ~1s instead of rebuilding every time.

#### 7. The consumer never touches Capacitor
`capacitor.config.json`, the native projects, `server.url`, the ATS exception, `adb
reverse` — all generated and reverted by the CLI. Ionic leaves more of this to the user.

---

### Physical devices (the LAN-IP path) — implemented

adaptv works on the **iOS Simulator** (shares the host loopback → `localhost`) and the
**Android emulator** (`adb reverse tcp:7171` → `localhost`), and now on **physical devices**
too — the equivalent of Ionic's `ionic capacitor run ios -l --external`, but auto-detected.

**How it works now:** adaptv branches on **device class**, not a flag. When the resolved
target is a physical device it switches the whole run to the LAN-IP path automatically;
`--host` forces it; the address is always detected from this machine's interfaces. Under the hood:
Vite is started with `--host` (binds `0.0.0.0`), `server.url` becomes `http://<LAN_IP>:<port>`,
and on iOS `NSLocalNetworkUsageDescription` is patched into `Info.plist` (reverted on
teardown, like the ATS exception) so iOS prompts for Local Network access instead of silently
blocking. The Android emulator is rejected up front with a clear message (its NAT can't reach
a LAN IP). Everything below is the reasoning that shaped it.

#### What `--external` actually does
- **Android**: forwards the dev-server port (the same idea as our `adb reverse`), so
  `localhost` inside the WebView reaches the host. `adb reverse` works for physical Android
  devices over USB (and adb-over-WiFi) too — so Android physical is *nearly free* for us.
- **iOS / true external**: binds the dev server to the machine's **LAN IP** (`0.0.0.0` →
  `192.168.x.x`) and bakes `http://<LAN_IP>:<port>` into `server.url`. The device, on the
  same Wi-Fi, loads over the network.

So the real driver for the LAN-IP path is the **physical iOS device** — it has no loopback
sharing and no adb equivalent, so `localhost` can never work there.

#### Why our earlier LAN-IP attempt failed
Three separate reasons, any one of which is fatal:

1. **Vite was never bound to the LAN.** `startDevServer` (`bin/lib/dev-server.mjs`) runs
   `vite` **without `--host`**, so it listens on `localhost` only. Setting `server.url` to
   the LAN IP then points the device at an interface the server never opened →
   connection refused. (We even parse Vite's `Network:` line into `networkUrl` and then
   never use it — because without `--host` Vite doesn't print one.) **This is almost
   certainly the whole story of "it didn't work."**
2. **It was likely tested on the emulator/sim, where the LAN IP *cannot* work.** The Android
   emulator's NAT can't route back to the host's own LAN address, and the iOS sim shares
   loopback — both *must* stay on `localhost` + `adb reverse`. The LAN IP is a
   physical-device-only path; trying it on a simulator will always fail and is a misleading
   test.
3. **iOS 14+ Local Network permission.** The moment a physical iOS app touches the LAN it
   trips the Local Network privacy prompt. Without `NSLocalNetworkUsageDescription` in
   `Info.plist` (we don't set it), iOS **silently blocks** the connection — and the
   Simulator does *not* enforce this, so it "works on the sim, fails on the device," the
   most confusing possible signal.

ATS is already handled: `patchIosAts` uses `NSAllowsArbitraryLoads` precisely because
`NSAllowsLocalNetworking` doesn't reliably cover a raw LAN IP.

#### The design to close it
Branch on **device class**, not just platform:

- **Simulator / emulator → unchanged.** `localhost` + `adb reverse` / shared loopback. Never
  use the LAN IP here.
- **Physical device → LAN-IP path:**
  1. Start Vite with `--host 0.0.0.0` so it binds every interface (we already capture the
     `Network:` URL it then prints — wire that through instead of dropping it).
  2. Detect the routable LAN IP (`os.networkInterfaces()`, `en0`-ish; skip `lo`, VPN,
     Docker, link-local `169.254`, internal).
  3. `server.url = http://<LAN_IP>:<port>`, and set the HMR websocket host to the same LAN
     IP (`server.hmr.host`/`clientPort`) so the reconnect socket dials back correctly.
  4. **iOS**: patch `NSLocalNetworkUsageDescription` into `Info.plist` (same in-place patch +
     teardown-revert pattern as the ATS exception), and expect the one-time Local Network
     prompt on first launch. Keep the `NSAllowsArbitraryLoads` ATS exception (covers the raw
     LAN IP).
  5. **Android physical**: prefer `adb reverse` (works over USB / adb-WiFi) so `localhost`
     keeps working with no LAN dependency; fall back to the LAN IP only when there's no adb
     route.
  6. Gotchas to surface in `doctor` or the run output: the macOS firewall blocking inbound
     on the dev port, and picking the wrong interface when a VPN/Docker bridge is up.

Everything we already built rides along for free: the offline screen, the reconnect
watchdog, and config self-heal all key off *whatever host the app loaded from*, LAN IP
included.

#### What's validated, and the one thing that isn't
The full external path *was* validated on the iOS **Simulator** by forcing it with `--host`:
the sim can reach the host's LAN IP, so `server.url` = the LAN IP, Vite bound to `0.0.0.0`
(reachable at `http://<LAN_IP>:<port>`), the app loads from the LAN URL, **and HMR works over
it** (edits propagate with no reinstall). The `Info.plist` key is patched and reverted on
teardown, local mode is unchanged, and the Android-emulator case errors clearly.

The **only** thing a simulator can't exercise is the iOS 14+ Local Network permission *prompt*
(the sim doesn't enforce it) — so the final confirmation is: run `adaptv dev ios --host` with a
real iPhone on the same Wi-Fi, approve the one-time prompt, and confirm live reload. Everything
up to that prompt is already proven.

---

*Sources for the Ionic behaviour: [Capacitor Live Reload guide](https://capacitorjs.com/docs/guides/live-reload),
[Ionic Live Reload docs](https://ionicframework.com/docs/cli/livereload),
[Vite server options](https://vite.dev/config/server-options),
plus community reports on the iOS Local Network prompt.*
