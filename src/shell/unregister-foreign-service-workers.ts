const DEV_SW_PATH = "dev-sw.js?dev-sw"
const PROD_SW_PATH = "sw.js"

function getExpectedServiceWorkerScriptUrl(): string {
  const base = import.meta.env.BASE_URL
  const path = import.meta.env.DEV ? DEV_SW_PATH : PROD_SW_PATH
  return new URL(`${base}${path}`, window.location.origin).href
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
