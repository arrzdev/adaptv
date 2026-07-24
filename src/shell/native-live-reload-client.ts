import { getOS, isNativePlatform } from "#adaptv/utils/platform"

/**
 * Keep a native WebView's live-reload connection alive across the OS tearing it down.
 *
 * ## The problem this fixes
 *
 * `adaptv dev ios|android` serves the SPA into a native WebView and relies on Vite's
 * HMR WebSocket for hot reload. That socket is fragile inside a WebView:
 *
 * - **iOS WKWebView** closes the HMR socket with a **CLEAN** close code when it
 *   suspends a backgrounded — or merely idle, even while foreground — WebView. Vite's
 *   own client treats a clean close as intentional (`if (wasClean) return`) and never
 *   reconnects, so the app silently goes deaf: it renders fine but ignores every edit,
 *   with `0` live connections to the dev server. (Chromium/Android reconnect on their
 *   own; iOS does not.)
 * - While suspended, JS timers are frozen, so Vite's own reconnect/ping loop can't run.
 *
 * ## The approach
 *
 * Vite's client won't tell us when its socket dies, so we run a **health-proxy socket**
 * that mirrors it exactly. Vite 5+/8 guards the HMR WebSocket with a per-session token
 * (`ws://host/?token=…`, subprotocol `vite-hmr`); we read that token straight out of
 * the served `@vite/client` and open a second socket with the identical URL. It lives
 * and dies under the same conditions as Vite's real one — so when it closes after
 * having been open, the live-reload channel is gone. Once the dev server is reachable
 * again and we're foreground, we hard-reload, which re-establishes HMR from a clean
 * slate. A reload always fixes a deaf WebView and costs a splash; a deaf WebView costs
 * the entire dev loop.
 *
 * If the token can't be read (Vite internals changed), we fall back to a coarser
 * signal: a background longer than a threshold almost always means the OS dropped the
 * socket, so we recover on the next foreground.
 *
 * Native + dev only: gated on `import.meta.hot` (dev) and `isNativePlatform()` (a real
 * Capacitor WebView), so a browser tab keeps Vite's normal reconnect behavior.
 */

//A background longer than this almost certainly means the OS suspended us and dropped
//the socket with a silent clean close. Used only as the no-token fallback.
const SUSPEND_DROP_MS = 3000

/**
 * The generated offline screen, served from the LOCAL origin.
 * ⚠︎ Must match `OFFLINE_PAGE` in `bin/lib/offline-page.mjs`, which generates the file
 * and points Capacitor's `server.errorPath` at it. Enforced by
 * `offline-page-name.test.ts` so the two can't drift.
 */
const OFFLINE_PAGE = "adaptv-offline.html"

/**
 * Consecutive failed reachability polls before we hand off to the offline screen.
 *
 * This has to be FAST, not merely eventual. The socket drops within ~100ms of the server
 * dying, but the user is often already reaching for the next tap — and once they navigate
 * into a dead server the WebView commits a browser error page, which destroys this script
 * and makes recovery impossible. Measured: socket dropped at T+0.1s, navigation at T+1.0s.
 * So we confirm with a second probe (cheap insurance against a one-off blip) and go, all
 * inside ~0.6s — comfortably ahead of a human. A server that's merely restarting costs a
 * brief offline screen that reconnects itself, which is the right trade against a dead end.
 */
const OFFLINE_AFTER_FAILURES = 2
/** Poll fast while deciding the server is gone, then back off to a reconnect cadence. */
const DECIDING_POLL_MS = 300
const RECONNECT_POLL_MS = 1500

export function installNativeLiveReloadRecovery(): void {
  if (!import.meta.hot) return
  if (!isNativePlatform()) return
  if (typeof window === "undefined") return

  let reloading = false
  let recovering = false

  const tryReload = async (): Promise<boolean> => {
    if (reloading) return true
    if (document.visibilityState !== "visible") return false
    // Confirm the dev server is actually back before reloading — a reload into a dead
    // server just white-screens. HEAD is enough and stays out of the cache.
    try {
      await fetch(location.href, { method: "HEAD", cache: "no-store" })
    } catch {
      return false // server not reachable yet
    }
    reloading = true
    location.reload()
    return true
  }

  /**
   * Hand off to the offline screen once the dev server is definitively gone.
   *
   * Capacitor's `server.errorPath` only fires for MAIN-FRAME load failures, so it cannot
   * cover the common case: the server dies, you navigate in-app, and a lazy route chunk
   * fails. That's a subresource — errorPath never runs, and Android drops you on
   * Chrome's raw `net::ERR_CONNECTION_REFUSED` page (iOS keeps the current document, so
   * it merely freezes). Since this watchdog is the thing that already knows the server
   * is gone, it takes the app there deliberately instead of waiting to be rescued.
   *
   * Finding the local origin is the fiddly part. `window.WEBVIEW_SERVER_URL` looks like
   * the answer and IS correct on iOS — but Android overwrites its `localUrl` with
   * `server.url` whenever live-reload is configured (`Bridge.java`), so there it reports
   * the DEV SERVER and navigating to it just fails again. Hence: use the injected value
   * only when it isn't the origin we're already on, and otherwise fall back to the
   * scheme+host adaptv itself configures — which is exactly how Capacitor's own
   * `getErrorUrl()` sidesteps the same trap.
   */
  const localOrigin = (): string | null => {
    const injected = (window as { WEBVIEW_SERVER_URL?: string })
      .WEBVIEW_SERVER_URL
    if (injected && !location.href.startsWith(injected)) return injected
    // Defaults Capacitor uses for the local server, with the `androidScheme: "http"`
    // that `patchServerUrl` sets for the dev session. Keep in sync with it.
    const os = getOS()
    if (os === "android") return "http://localhost"
    if (os === "ios") return "capacitor://localhost"
    return null
  }

  const goOffline = (): boolean => {
    const base = localOrigin()
    if (!base) return false
    const target = `${base.replace(/\/$/, "")}/${OFFLINE_PAGE}`
    if (location.href === target) return true
    reloading = true // stop every other timer from racing this navigation
    location.replace(target)
    return true
  }

  // Once we know the channel dropped, keep trying until we actually reload — the server
  // may still be restarting, or we may be backgrounded. Idempotent across triggers.
  const recover = (): void => {
    if (recovering || reloading) return
    recovering = true
    let failures = 0
    const tick = async (): Promise<void> => {
      if (await tryReload()) return
      // Only count polls we actually made: while backgrounded `tryReload` bails without
      // touching the network, and a hidden app must not be ejected to the offline screen.
      if (document.visibilityState === "visible") failures += 1
      if (failures >= OFFLINE_AFTER_FAILURES && goOffline()) return
      window.setTimeout(
        tick,
        failures < OFFLINE_AFTER_FAILURES
          ? DECIDING_POLL_MS
          : RECONNECT_POLL_MS,
      )
    }
    void tick()
  }

  const proto = location.protocol === "https:" ? "wss" : "ws"

  // Read the session's HMR ws token from the served client, then mirror Vite's socket.
  const startProxy = async (): Promise<boolean> => {
    let token: string | null = null
    try {
      const src = await (
        await fetch("/@vite/client", { cache: "no-store" })
      ).text()
      token = src.match(/wsToken\s*=\s*["'`]([^"'`]+)["'`]/)?.[1] ?? null
    } catch {
      return false
    }
    if (!token) return false

    const url = `${proto}://${location.host}/?token=${token}`
    let socket: WebSocket | null = null
    let everOpened = false

    const open = (): void => {
      try {
        socket = new WebSocket(url, "vite-hmr")
      } catch {
        window.setTimeout(open, 3000)
        return
      }
      socket.addEventListener("open", () => {
        everOpened = true
      })
      socket.addEventListener("close", () => {
        socket = null
        // A socket that WAS live signals a real drop; one that never opened is a
        // transient failure — retry quietly rather than reload-loop.
        if (everOpened) void recover()
        else window.setTimeout(open, 3000)
      })
    }
    open()

    const proxyIsDead = (): boolean => {
      // Once it has connected at least once, anything short of OPEN is a lost channel.
      if (!everOpened) return false
      return !socket || socket.readyState > WebSocket.OPEN
    }

    // Zombie guard: WKWebView can leave the socket dead without ever firing `close`
    // (and while foreground no visibility event fires either), which is what forced a
    // manual relaunch. Poll the channel and self-heal — foreground only, so a
    // backgrounded app doesn't burn a wakeup.
    window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      if (proxyIsDead()) void recover()
    }, 4000)

    // A suspended socket's close event is delivered on resume, but timing isn't
    // guaranteed — on foreground, if the proxy isn't OPEN, recover now.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return
      if (proxyIsDead()) void recover()
    })
    return true
  }

  void startProxy().then((ok) => {
    if (ok) return
    // Fallback (no token): treat a long background as a probable silent drop.
    let hiddenAt = 0
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now()
        return
      }
      if (hiddenAt !== 0 && Date.now() - hiddenAt > SUSPEND_DROP_MS)
        void recover()
    })
  })
}
