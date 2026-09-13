import { publicPath } from "#adaptv/utils/public-path"

//adaptv emits exactly one worker, `sw.js`, in dev and prod alike. There used to be
//a `dev-sw.js?dev-sw` special case here — vite-plugin-pwa's dev filename — which
//adaptv has never produced. It made every dev-registered worker look FOREIGN, so
//the cleanup pass would unregister the app's own worker. → docs/decisions/register.md B6
const SW_PATH = "sw.js"

function getExpectedServiceWorkerScriptUrl(): string {
  const base = import.meta.env.BASE_URL
  return new URL(`${base}${SW_PATH}`, window.location.origin).href
}

/**
 * The part of the origin this app owns: its deploy base. Under `base: "/app/"`
 * on `<user>.github.io`, `/other/` is somebody else's project site, and its
 * worker is none of this app's business. At the root every scope on the origin
 * is inside the app's, which is what the cleanup has always assumed there.
 */
function getAppScope(): string {
  //with its slash, so `/app/` never claims `/application/`
  return new URL(
    publicPath(import.meta.env.BASE_URL, ""),
    window.location.origin,
  ).href
}

function scriptUrlsMatch(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href
  } catch {
    return a === b
  }
}

/**
 * True when this registration belongs to the current app SW — including
 * active/waiting/installing workers that share the same script URL (version
 * updates). False for dead registrations or separate SW scripts the browser
 * treats as unrelated (e.g. leftovers from a renamed entry).
 */
function registrationBelongsToCurrentApp(
  registration: ServiceWorkerRegistration,
  expectedScriptUrl: string,
): boolean {
  const workers = [
    registration.active,
    registration.waiting,
    registration.installing,
  ].filter((worker): worker is ServiceWorker => worker !== null)

  if (workers.length === 0) return false

  return workers.some((worker) =>
    scriptUrlsMatch(worker.scriptURL, expectedScriptUrl),
  )
}

/**
 * Unregisters leftover service worker registrations that are not part of the
 * current app's SW lineage — different script URL, or inactive with no workers —
 * and only inside the app's own scope. `getRegistrations()` lists every
 * registration on the origin, so a worker registered outside the deploy base
 * (another project site on the same `github.io` origin) is left alone.
 *
 * Best-effort, and it never rejects. The shell registers the app's own worker
 * only once this settles, so a rejection here — one stranger's `unregister()`, or
 * a `getRegistrations()` the browser refuses — would cost the app its worker for
 * the whole launch, with nothing logged. Removing someone else's worker is
 * cleanup; registering ours is the product.
 */
export async function unregisterForeignServiceWorkers(): Promise<void> {
  if (!("serviceWorker" in navigator)) return

  try {
    const expectedScriptUrl = getExpectedServiceWorkerScriptUrl()
    const appScope = getAppScope()
    const registrations = await navigator.serviceWorker.getRegistrations()

    await Promise.allSettled(
      registrations
        .filter(
          (registration) =>
            registration.scope.startsWith(appScope) &&
            !registrationBelongsToCurrentApp(
              registration,
              expectedScriptUrl,
            ),
        )
        .map(async (registration) => registration.unregister()),
    )
  } catch {
    //nothing to clean up that we can reach — registration still proceeds
  }
}
