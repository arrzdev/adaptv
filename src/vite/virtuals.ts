import type { Plugin } from "vite"

const REGISTER_ID = "virtual:nativ/pwa-register"
const RESOLVED_REGISTER_ID = `\0${REGISTER_ID}`

/**
 * Provides `virtual:nativ/pwa-register` — the `registerSW` the shell imports.
 * Replaces vite-plugin-pwa's `virtual:pwa-register` so nativ owns the whole SW
 * story and drops that dependency. autoUpdate-only: a waiting worker is
 * activated on demand and the page reloads once it takes control.
 */
export function nativPwaRegisterPlugin(): Plugin {
  return {
    name: "nativ:pwa-register",
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
      registration = await navigator.serviceWorker.register("/sw.js")
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
