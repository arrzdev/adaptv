import type { Plugin } from "vite"

const REGISTER_ID = "virtual:adaptv/pwa-register"
const RESOLVED_REGISTER_ID = `\0${REGISTER_ID}`

/**
 * Provides `virtual:adaptv/pwa-register` — the `registerSW` the shell imports.
 * Replaces vite-plugin-pwa's `virtual:pwa-register` so adaptv owns the whole SW
 * story and drops that dependency. autoUpdate-only: a waiting worker is
 * activated on demand and the page reloads once it takes control.
 */
export function adaptvPwaRegisterPlugin(): Plugin {
  return {
    name: "adaptv:pwa-register",
    resolveId(id) {
      if (id === REGISTER_ID) return RESOLVED_REGISTER_ID
      return null
    },
    load(id) {
      if (id === RESOLVED_REGISTER_ID) return REGISTER_SW_SOURCE
      return null
    },
  }
}

//client module source — runs in the browser, not in the plugin.
const REGISTER_SW_SOURCE = `
export function registerSW(options = {}) {
  const { immediate = false, onNeedRefresh, onOfflineReady, onRegistered, onRegisterError } = options
  let registration
  let updateRequested = false

  async function updateServiceWorker(reload = true) {
    const waiting = registration && registration.waiting
    if (reload && waiting) {
      updateRequested = true
      waiting.postMessage({ type: "SKIP_WAITING" })
    }
  }

  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return updateServiceWorker
  }

  //reload only when WE activated an update — never on the first install's claim.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updateRequested) window.location.reload()
  })

  async function register() {
    try {
      //BASE_URL, never a hardcoded "/sw.js" — a subpath deploy (GitHub Pages, or
      //any non-root base) registers the wrong URL and silently gets no SW at all.
      //DECISIONS.md B1 / B26.
      //
      //updateViaCache:"none" is required, not tuning: browsers otherwise serve the
      //SW SCRIPT ITSELF from HTTP cache (capped at 24h), so a deploy can go
      //unnoticed for a day. RENDERING.md §3.3.
      const swUrl = (import.meta.env.BASE_URL || "/") + "sw.js"
      registration = await navigator.serviceWorker.register(swUrl, {
        updateViaCache: "none",
      })
      if (onRegistered) onRegistered(registration)
      if (!navigator.serviceWorker.controller && onOfflineReady) onOfflineReady()

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing
        if (!installing) return
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            if (onNeedRefresh) onNeedRefresh()
          }
        })
      })
    } catch (error) {
      if (onRegisterError) onRegisterError(error)
    }
  }

  if (immediate) register()
  else window.addEventListener("load", register)

  return updateServiceWorker
}
`
