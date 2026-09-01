//adaptv emits exactly one worker, `sw.js`, in dev and prod alike. There used to be
//a `dev-sw.js?dev-sw` special case here — vite-plugin-pwa's dev filename — which
//adaptv has never produced. It made every dev-registered worker look FOREIGN, so
//the cleanup pass would unregister the app's own worker. → docs/decisions/register.md B6
const SW_PATH = "sw.js"

function getExpectedServiceWorkerScriptUrl(): string {
  const base = import.meta.env.BASE_URL
  return new URL(`${base}${SW_PATH}`, window.location.origin).href
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
 * current app's SW lineage — different script URL, or inactive with no workers.
 */
export async function unregisterForeignServiceWorkers(): Promise<void> {
  if (!("serviceWorker" in navigator)) return

  const expectedScriptUrl = getExpectedServiceWorkerScriptUrl()
  const registrations = await navigator.serviceWorker.getRegistrations()

  await Promise.all(
    registrations.map(async (registration) => {
      if (
        registrationBelongsToCurrentApp(registration, expectedScriptUrl)
      ) {
        return
      }

      await registration.unregister()
    }),
  )
}
