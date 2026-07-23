# adaptv vs Ionic — where we win, and the one gap left

Both adaptv and Ionic put a native WebView in front of a Vite dev server so web-code edits
hot-reload on a device. Capacitor is the shared substrate. The interesting differences are
in what happens **around** the happy path — recovery, ergonomics — and in one capability
Ionic has that we don't yet: physical devices.

This doc exists to (a) keep a running list of what we do better, so it doesn't get lost,
and (b) record the design for closing the physical-device gap, including *why the obvious
attempt fails*.

---

## Where adaptv wins

### 1. Auto-heal when the dev server dies (the headline)
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

### 2. An offline screen, not a black rectangle
When the server is down the dev sees "Development build — `$ adaptv dev ios`" with a live
spinner, not a blank page they have to guess at.

### 3. Config can't get wedged
Ionic's own documented gotcha: an unclean run can leave `server: { url: … }` behind in
`capacitor.config`, and then even a "normal" build keeps loading the dead dev server —
you have to hand-check the file. adaptv regenerates `capacitor.config.json` from scratch
before every command and `patchServerUrl` strips a stale live-reload block on the next run,
so a SIGKILL'd `dev` can never poison a later `build`/`preview`.

### 4. `r` reload vs `b` rebuild
A web-code edit that wedges the JS doesn't need a 15s native reinstall. `r` relaunches the
app (fresh document from the dev server, ~0.5s); `b` reinstalls the binary for a real native
change. Ionic gives you one heavy path.

### 5. Single-instance lock
A second `dev` fails fast with a clear message (naming the pid + url) instead of a cryptic
port collision, and `preview`/`build` refuse while a `dev` run owns the config.

### 6. Run cache
An unchanged native project relaunches from cache in ~1s instead of rebuilding every time.

### 7. The consumer never touches Capacitor
`capacitor.config.json`, the native projects, `server.url`, the ATS exception, `adb
reverse` — all generated and reverted by the CLI. Ionic leaves more of this to the user.

---

## The gap: physical devices (the LAN-IP path)

Today adaptv works on the **iOS Simulator** (shares the host loopback → `localhost`) and the
**Android emulator** (`adb reverse tcp:7171` → `localhost`). It does **not** yet work on a
physical device. Ionic does, via `ionic capacitor run ios -l --external`.

### What `--external` actually does
- **Android**: forwards the dev-server port (the same idea as our `adb reverse`), so
  `localhost` inside the WebView reaches the host. `adb reverse` works for physical Android
  devices over USB (and adb-over-WiFi) too — so Android physical is *nearly free* for us.
- **iOS / true external**: binds the dev server to the machine's **LAN IP** (`0.0.0.0` →
  `192.168.x.x`) and bakes `http://<LAN_IP>:<port>` into `server.url`. The device, on the
  same Wi-Fi, loads over the network.

So the real driver for the LAN-IP path is the **physical iOS device** — it has no loopback
sharing and no adb equivalent, so `localhost` can never work there.

### Why our earlier LAN-IP attempt failed
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

### The design to close it
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

### Testing note
This path **cannot be validated on the Simulator or emulator** — by construction they can't
use the LAN IP (loopback/NAT), and the iOS sim doesn't enforce Local Network permission. It
needs a real device on the same Wi-Fi. Treat sim "success" as meaningless for this feature;
the only valid test is a physical phone.

---

*Sources for the Ionic behaviour: [Capacitor Live Reload guide](https://capacitorjs.com/docs/guides/live-reload),
[Ionic Live Reload docs](https://ionicframework.com/docs/cli/livereload),
[Vite server options](https://vite.dev/config/server-options),
plus community reports on the iOS Local Network prompt.*
