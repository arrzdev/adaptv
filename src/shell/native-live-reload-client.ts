import { isNativePlatform } from "#nativ/utils/platform"

/**
 * Keep a native WebView's live-reload connection alive across the OS tearing it down.
 *
 * ## The problem this fixes
 *
 * `nativ run ios|android` serves the SPA into a native WebView and relies on Vite's
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

  // Once we know the channel dropped, keep trying until we actually reload — the server
  // may still be restarting, or we may be backgrounded. Idempotent across triggers.
  const recover = (): void => {
    if (recovering || reloading) return
    recovering = true
    const tick = async (): Promise<void> => {
      if (await tryReload()) return
      window.setTimeout(tick, 1500)
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
