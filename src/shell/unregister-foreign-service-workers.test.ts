import { afterEach, describe, expect, it, vi } from "vitest"
import { unregisterForeignServiceWorkers } from "#adaptv/shell/unregister-foreign-service-workers"

type Slots = {
  /** The registration's scope. Defaults to the origin root. */
  scope?: string
  active?: string
  waiting?: string
  installing?: string
  unregister?: () => Promise<boolean>
}

/** A registration whose worker slots hold the given script URLs. */
function registration(slots: Slots) {
  const worker = (url: string | undefined) =>
    url === undefined ? null : ({ scriptURL: url } as ServiceWorker)
  return {
    scope: slots.scope ?? `${window.location.origin}/`,
    active: worker(slots.active),
    waiting: worker(slots.waiting),
    installing: worker(slots.installing),
    unregister: vi.fn(slots.unregister ?? (() => Promise.resolve(true))),
  }
}

function stubRegistrations(
  getRegistrations: () => Promise<ReturnType<typeof registration>[]>,
) {
  vi.stubGlobal("navigator", { serviceWorker: { getRegistrations } })
}

const origin = () => window.location.origin

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("unregisterForeignServiceWorkers", () => {
  it("keeps this app's worker in any lifecycle slot, and removes every other one", async () => {
    //An update in flight puts OUR script in `waiting` or `installing` while the
    //previous build still holds `active` — all three are the app's own lineage.
    //The leftover `dev-sw.js?dev-sw` name is foreign: adaptv never emits it, and
    //treating it as the app's own is how the old special case unregistered the
    //real worker. → docs/decisions/register.md B6
    const own = `${origin()}/sw.js`
    const ownActive = registration({ active: own })
    const ownWaiting = registration({ waiting: own })
    const ownInstalling = registration({ installing: own })
    const renamed = registration({
      active: `${origin()}/service-worker.js`,
    })
    const pluginDev = registration({
      active: `${origin()}/dev-sw.js?dev-sw`,
    })
    const dead = registration({})
    stubRegistrations(async () => [
      ownActive,
      ownWaiting,
      ownInstalling,
      renamed,
      pluginDev,
      dead,
    ])

    await unregisterForeignServiceWorkers()

    expect(ownActive.unregister).not.toHaveBeenCalled()
    expect(ownWaiting.unregister).not.toHaveBeenCalled()
    expect(ownInstalling.unregister).not.toHaveBeenCalled()
    expect(renamed.unregister).toHaveBeenCalledOnce()
    expect(pluginDev.unregister).toHaveBeenCalledOnce()
    //a registration with no worker at all serves nothing and blocks nothing
    expect(dead.unregister).toHaveBeenCalledOnce()
  })

  it("resolves the app's worker against BASE_URL, so a subpath deploy keeps it", async () => {
    //A hardcoded `/sw.js` would call the subpath worker foreign and unregister it
    //on every launch — the same subpath bug B1/B26 recorded for registration.
    vi.stubEnv("BASE_URL", "/app/")
    const subpath = registration({
      scope: `${origin()}/app/`,
      active: `${origin()}/app/sw.js`,
    })
    //inside the app's scope but running the root-absolute script, which is
    //what the hardcoded path would have registered
    const rootScript = registration({
      scope: `${origin()}/app/`,
      active: `${origin()}/sw.js`,
    })
    stubRegistrations(async () => [subpath, rootScript])

    await unregisterForeignServiceWorkers()

    expect(subpath.unregister).not.toHaveBeenCalled()
    expect(rootScript.unregister).toHaveBeenCalledOnce()
  })

  it("keeps the app's worker when BASE_URL was written without its slash", async () => {
    //`--base /app` reaches the bundle as BASE_URL `"/app"` (Vite adds the slash
    //to `config.base` only), and the worker is still served at `/app/sw.js`.
    //Concatenated, the expected script was `/appsw.js`, so the app's own worker
    //looked foreign and was unregistered on every launch.
    vi.stubEnv("BASE_URL", "/app")
    const own = registration({
      scope: `${origin()}/app/`,
      active: `${origin()}/app/sw.js`,
    })
    const lookalike = registration({
      scope: `${origin()}/application/`,
      active: `${origin()}/application/sw.js`,
    })
    stubRegistrations(async () => [own, lookalike])

    await unregisterForeignServiceWorkers()

    expect(own.unregister).not.toHaveBeenCalled()
    //and the scope still ends at the slash, so `/app` never claims `/application/`
    expect(lookalike.unregister).not.toHaveBeenCalled()
  })

  it("leaves every registration outside the app's base alone", async () => {
    //Two project sites share one `<user>.github.io` origin, and
    //`getRegistrations()` lists both. The app at `/app/` owns `/app/`; the worker
    //at `/other/` is another site's, and the origin root is the user site's.
    vi.stubEnv("BASE_URL", "/app/")
    const otherSite = registration({
      scope: `${origin()}/other/`,
      active: `${origin()}/other/sw.js`,
    })
    const userSite = registration({
      scope: `${origin()}/`,
      active: `${origin()}/sw.js`,
    })
    const lookalike = registration({
      scope: `${origin()}/application/`,
      active: `${origin()}/application/sw.js`,
    })
    const insideForeign = registration({
      scope: `${origin()}/app/legacy/`,
      active: `${origin()}/app/legacy/sw.js`,
    })
    stubRegistrations(async () => [
      otherSite,
      userSite,
      lookalike,
      insideForeign,
    ])

    await unregisterForeignServiceWorkers()

    expect(otherSite.unregister).not.toHaveBeenCalled()
    expect(userSite.unregister).not.toHaveBeenCalled()
    //`/application/` starts with `/app` but not with `/app/`
    expect(lookalike.unregister).not.toHaveBeenCalled()
    //a stray worker INSIDE the app's own scope is still the app's to clean up
    expect(insideForeign.unregister).toHaveBeenCalledOnce()
  })

  it("never rejects when one foreign unregister fails, and still removes the rest", async () => {
    //Removing a stranger's worker is best-effort. A rejection here used to
    //propagate to the shell, which then skipped registering the app's own worker
    //for the whole launch.
    const failing = registration({
      active: `${origin()}/old.js`,
      unregister: () => Promise.reject(new Error("InvalidStateError")),
    })
    const other = registration({ active: `${origin()}/other.js` })
    stubRegistrations(async () => [failing, other])

    await expect(
      unregisterForeignServiceWorkers(),
    ).resolves.toBeUndefined()
    expect(failing.unregister).toHaveBeenCalledOnce()
    expect(other.unregister).toHaveBeenCalledOnce()
  })

  it("never rejects when the registrations cannot be listed", async () => {
    stubRegistrations(() => Promise.reject(new Error("SecurityError")))

    await expect(
      unregisterForeignServiceWorkers(),
    ).resolves.toBeUndefined()
  })
})
