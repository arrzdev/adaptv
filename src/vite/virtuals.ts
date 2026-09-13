import type { Plugin } from "vite"
import type { ServiceWorkerUpdatePolicy } from "#adaptv/config/app-config.ts"
import { publicPath } from "#adaptv/utils/public-path.ts"

const REGISTER_ID = "virtual:adaptv/pwa-register"
const RESOLVED_REGISTER_ID = `\0${REGISTER_ID}`

/**
 * Provides `virtual:adaptv/pwa-register` — the `registerSW` the shell imports.
 * Replaces vite-plugin-pwa's `virtual:pwa-register` so adaptv owns the whole SW
 * story and drops that dependency.
 *
 * A waiting worker is applied at **cold launch and nowhere else** — see the
 * reasoning inline. → `docs/design/rendering.md §3.4`
 *
 * `swEnabled` is false on exactly one build, the Capacitor one, where
 * `resolveWebConfig` turns the worker off and nothing can turn it back on. The
 * shell already refuses to register there at runtime (`isNativePlatform()` in
 * `service-worker-shell.ts`), but a runtime guard still **ships** the code it
 * guards: the whole registration path was landing in the `.ipa`/`.apk` to be
 * skipped on the first line. Emitting a stub instead lets the bundler drop it.
 * The runtime guard stays — it covers the web bundle served into a WebView by
 * `adaptv dev ios`, which is built with `target: "web"` and reaches this with
 * `swEnabled: true`.
 */
export function adaptvPwaRegisterPlugin(
  swEnabled: boolean,
  devSwEnabled = false,
  updatePolicy: ServiceWorkerUpdatePolicy = "auto",
): Plugin {
  let base = "/"
  return {
    name: "adaptv:pwa-register",
    configResolved(resolved) {
      //Vite's resolved base, joined by `publicPath` like every other URL adaptv
      //writes. Never `import.meta.env.BASE_URL` concatenated in the browser: under
      //`--base /app` that is `"/app"`, and `+ "sw.js"` registered `/appsw.js`, a
      //404, while the worker is served at `/app/sw.js`.
      base = resolved.base
    },
    resolveId(id) {
      if (id === REGISTER_ID) return RESOLVED_REGISTER_ID
      return null
    },
    load(id) {
      if (id !== RESOLVED_REGISTER_ID) return null
      //A build-time constant, not an `import.meta.env` read: the shell has to
      //decide whether dev DESTROYS workers or registers one, and that answer is
      //known here. → sw-dev.ts
      const flag = `export const DEV_SW_ENABLED = ${devSwEnabled}\n`
      if (!swEnabled) return flag + NO_REGISTER_SW_SOURCE
      return (
        flag +
        REGISTER_SW_SOURCE.replace(
          "__ADAPTV_SW_PROMPT__",
          String(updatePolicy === "prompt"),
        ).replace("__ADAPTV_SW_URL__", () =>
          JSON.stringify(publicPath(base, "sw.js")),
        )
      )
    },
  }
}

//The shell imports `registerSW` unconditionally, so the export has to exist even
//when there is no worker to register. Same signature, no body.
const NO_REGISTER_SW_SOURCE = `
/* adaptv: this build never registers a service worker (native target). */
export function registerSW() {}
`

//client module source — runs in the browser, not in the plugin.
//
//`__ADAPTV_SW_PROMPT__` is substituted per build from `serviceWorkerUpdate`. A
//baked constant, not a runtime argument: the policy is a property of the app, and
//the shell that calls this has never read the app config. `__ADAPTV_SW_URL__` is
//the worker's URL under the deploy base, baked the same way.
const REGISTER_SW_SOURCE = `
export function registerSW(onWaiting) {
  if (typeof navigator === "undefined") return
  const PROMPT = __ADAPTV_SW_PROMPT__

  //A service worker requires a SECURE CONTEXT. Every https:// origin qualifies and
  //localhost is explicitly exempt — but a self-hosted deploy over plain http://
  //is not, and there \`navigator.serviceWorker\` is simply ABSENT. No registration
  //failure to catch, no exception: the app silently loses offline support and
  //instant navigation, and nothing anywhere says why. This warning is deliberately
  //NOT dev-gated, because production is the only place the failure happens.
  if (!("serviceWorker" in navigator)) {
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      console.warn(
        "[adaptv] no service worker: this origin is not a secure context. " +
          "Serve the app over HTTPS (localhost is exempt) — until then, " +
          "offline support and instant navigation are off.",
      )
    }
    return
  }

  //Set only when WE applied a waiting worker. The FIRST install also fires
  //controllerchange (clientsClaim takes over an uncontrolled page) and reloading
  //there would restart every first visit for no reason.
  let applied = false
  let reloading = false

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!applied || reloading) return
    reloading = true
    window.location.reload()
  })

  async function register() {
    try {
      //Under the deploy base, never a hardcoded "/sw.js" — a subpath deploy (GitHub
      //Pages, or any non-root base) registers the wrong URL and silently gets no SW
      //at all. Baked by the plugin from Vite's resolved base.
      //docs/decisions/register.md B1 / B26.
      //
      //updateViaCache:"none" is required, not tuning: browsers otherwise serve the
      //SW SCRIPT ITSELF from HTTP cache (capped at 24h), so a deploy can go
      //unnoticed for a day. docs/design/rendering.md §3.3.
      const swUrl = __ADAPTV_SW_URL__
      const registration = await navigator.serviceWorker.register(swUrl, {
        updateViaCache: "none",
      })

      //Apply the waiting worker: SKIP_WAITING, then the controllerchange handler
      //above reloads. Shared by both policies — what differs is WHO calls it.
      const apply = (worker) => {
        if (!worker) return
        applied = true
        worker.postMessage({ type: "SKIP_WAITING" })
      }

      //\`prompt\`: never apply on our own. Hand the app the moment instead, and
      //keep handing it — a worker can finish installing at any point in the
      //session, and an app that only learned about updates at launch would show
      //its banner one launch late.
      if (PROMPT) {
        const offer = () => {
          if (registration.waiting && navigator.serviceWorker.controller) {
            onWaiting?.(() => apply(registration.waiting))
          }
        }
        offer()
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing
          if (!installing) return
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed") offer()
          })
        })
        return
      }

      //\`auto\` — COLD LAUNCH IS THE ONLY MOMENT AN UPDATE IS APPLIED.
      //
      //A worker sitting in \`waiting\` finished installing in an EARLIER session,
      //so its precache is already complete on disk — applying it costs one reload
      //and zero downloads. And this document was created moments ago: there is no
      //typed-in form, no open modal, no in-flight upload to destroy.
      //
      //The controller check keeps the first-ever visit out of this branch: with no
      //controller there is no old worker to replace.
      if (registration.waiting && navigator.serviceWorker.controller) {
        apply(registration.waiting)
      }

      //A worker that finishes installing DURING this session is deliberately left
      //alone. Activating it prunes the previous build's precache out from under a
      //live module graph, so the page's next lazy route import 404s at both cache
      //and origin — and the reload that follows takes unsaved state with it. It
      //waits, and the branch above applies it at the next launch. Running a build
      //one launch behind is survivable; losing what someone typed is not.
    } catch (error) {
      //A failed registration must never take the app down with it — the page
      //works without a worker, just without offline and instant navigation.
      if (import.meta.env.DEV) console.error("[adaptv] sw registration failed", error)
    }
  }

  //Immediately, not on \`load\`: the sooner a pending update is applied, the more
  //of the reload hides behind the splash screen.
  register()
}
`
