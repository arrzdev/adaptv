import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

//"When this document asked for a reload" is module state that dies with the
//document, so every document in these tests is a fresh import of the module,
//sharing one sessionStorage the way the documents of one tab do.
async function freshDocument() {
  vi.resetModules()
  return import("#adaptv/shell/preload-error-recovery")
}

const GUARD_KEY = "adaptv:preload-error-reload"
const T0 = Date.UTC(2026, 8, 13, 12, 0, 0)

let reloads = 0

beforeEach(() => {
  reloads = 0
  sessionStorage.clear()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(T0)
  vi.spyOn(window.location, "reload").mockImplementation(() => {
    reloads += 1
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

//Vite's own shape: cancelable, and it rethrows unless a listener prevents it
function staleChunk() {
  const event = new Event("vite:preloadError", { cancelable: true })
  window.dispatchEvent(event)
  return event
}

async function armDocument() {
  const { installPreloadErrorRecovery } = await freshDocument()
  const unrecoverable = vi.fn()
  const teardown = installPreloadErrorRecovery(unrecoverable)
  return {
    unrecoverable,
    teardown,
    outcome: () => ({
      reloads,
      unrecoverable: unrecoverable.mock.calls.length,
    }),
  }
}

describe("installPreloadErrorRecovery — B4, one reload per recovery", () => {
  //After a deploy, an open tab's next lazy `import()` requests a chunk hash the
  //host no longer serves: white screen, no recovery. A reload fixes it — the tab
  //picks up the new manifest.
  it("reloads on a tab's first stale chunk, and leaves the error to the engine", async () => {
    const net = await armDocument()

    const event = staleChunk()
    net.teardown()

    expect(net.outcome()).toEqual({ reloads: 1, unrecoverable: 0 })
    //prevented, the import would resolve to `undefined` and the app's error
    //boundary would be drawn over the reload
    expect(event.defaultPrevented).toBe(false)
    //stamped where the document the reload produces can read it
    expect(sessionStorage.getItem(GUARD_KEY)).toBe(String(T0))
  })

  it("shows unrecoverable, without reloading, when a recovery reload just happened", async () => {
    //the previous document stamped its reload seconds ago; this one booted and
    //hit the same missing chunk, so it is genuinely gone and reloading would loop
    sessionStorage.setItem(GUARD_KEY, String(T0 - 5_000))
    const net = await armDocument()

    const event = staleChunk()
    net.teardown()

    expect(net.outcome()).toEqual({ reloads: 0, unrecoverable: 1 })
    //the shell owns this failure now, so Vite must not also rethrow it
    expect(event.defaultPrevented).toBe(true)
  })

  it("reloads a tab that recovered long ago — a later deploy is not a failed reload", async () => {
    //A session-long guard read this as "the reload already failed" and showed
    //the offline screen with no reload at all, in a tab where a reload was
    //exactly what would have fixed it.
    sessionStorage.setItem(GUARD_KEY, String(T0 - 10 * 60_000))
    const net = await armDocument()

    const event = staleChunk()
    net.teardown()

    expect(net.outcome()).toEqual({ reloads: 1, unrecoverable: 0 })
    expect(event.defaultPrevented).toBe(false)
    expect(sessionStorage.getItem(GUARD_KEY)).toBe(String(T0))
  })

  it("counts a stamp as recent for exactly the recovery window", async () => {
    const { RECOVERY_WINDOW_MS } = await freshDocument()

    sessionStorage.setItem(GUARD_KEY, String(T0 - RECOVERY_WINDOW_MS + 1))
    const inside = await armDocument()
    staleChunk()
    inside.teardown()
    expect(inside.outcome()).toEqual({ reloads: 0, unrecoverable: 1 })

    sessionStorage.setItem(GUARD_KEY, String(T0 - RECOVERY_WINDOW_MS))
    const outside = await armDocument()
    staleChunk()
    outside.teardown()
    expect(outside.outcome()).toEqual({ reloads: 1, unrecoverable: 0 })
  })

  it("never loops on a chunk that stays missing: one reload, then unrecoverable", async () => {
    //the bad deploy: every document the tab loads is missing the chunk
    const first = await armDocument()
    staleChunk()
    first.teardown()
    //the router's own net, which runs after the event, keys its guard here
    sessionStorage.setItem(
      "tanstack_router_reload:Importing a module script failed.",
      "1",
    )

    //the reload's document, as late as a slow device boots into the failure
    vi.setSystemTime(T0 + 25_000)
    const second = await armDocument()
    staleChunk()
    staleChunk()
    staleChunk()
    second.teardown()

    expect({
      reloads,
      unrecoverable: second.unrecoverable.mock.calls.length,
    }).toEqual({ reloads: 1, unrecoverable: 3 })
    //left in place, so the router cannot reload this document either
    expect(
      sessionStorage.getItem(
        "tanstack_router_reload:Importing a module script failed.",
      ),
    ).toBe("1")
  })

  it("refuses to reload when it cannot guard, rather than risking a loop", async () => {
    //Safari in private mode and partitioned third-party contexts both throw here.
    //Failing closed costs one tap on retry; failing open spins forever.
    vi.stubGlobal("sessionStorage", {
      getItem() {
        throw new Error("SecurityError")
      },
      setItem() {
        throw new Error("SecurityError")
      },
    })
    const net = await armDocument()

    staleChunk()
    net.teardown()

    expect(net.outcome()).toEqual({ reloads: 0, unrecoverable: 1 })
  })
})

describe("installPreloadErrorRecovery — the router's reload net", () => {
  //The router has its own net: a missing-module import reloads once, guarded by
  //a sessionStorage key named after the error's message that it never clears.
  //WebKit's message has no URL, so there it is one key for the whole session,
  //and the router's net sat out every recovery after the first — drawing its
  //error screen over adaptv's reload instead of holding the page still.
  const WEBKIT_KEY =
    "tanstack_router_reload:Importing a module script failed."
  const CHROMIUM_KEY =
    "tanstack_router_reload:Failed to fetch dynamically imported module: https://app.example/assets/share.page-a1.js"

  it("clears the router's reload keys when adaptv reloads, and nothing else", async () => {
    sessionStorage.setItem(GUARD_KEY, String(T0 - 10 * 60_000))
    sessionStorage.setItem(WEBKIT_KEY, "1")
    sessionStorage.setItem(CHROMIUM_KEY, "1")
    sessionStorage.setItem("app:draft", "kept")
    const net = await armDocument()

    staleChunk()
    net.teardown()

    expect(net.outcome()).toEqual({ reloads: 1, unrecoverable: 0 })
    expect({
      webkit: sessionStorage.getItem(WEBKIT_KEY),
      chromium: sessionStorage.getItem(CHROMIUM_KEY),
      app: sessionStorage.getItem("app:draft"),
    }).toEqual({ webkit: null, chromium: null, app: "kept" })
  })

  it("leaves the router's keys alone when it does not reload", async () => {
    sessionStorage.setItem(GUARD_KEY, String(T0 - 1_000))
    sessionStorage.setItem(WEBKIT_KEY, "1")
    const net = await armDocument()

    staleChunk()
    net.teardown()

    expect(net.outcome()).toEqual({ reloads: 0, unrecoverable: 1 })
    expect(sessionStorage.getItem(WEBKIT_KEY)).toBe("1")
  })
})

describe("installPreloadErrorRecovery — one answer per document", () => {
  it("a second installation cannot turn the first one's reload into a failure", async () => {
    //an app calling the exported net next to the shell's must not reproduce the
    //shell's old double arming: reload, then "unrecoverable" for the same error
    const { installPreloadErrorRecovery } = await freshDocument()
    const unrecoverable = vi.fn()
    const teardowns = [
      installPreloadErrorRecovery(unrecoverable),
      installPreloadErrorRecovery(unrecoverable),
    ]

    staleChunk()
    const later = staleChunk()
    for (const teardown of teardowns) teardown()

    expect({
      reloads,
      unrecoverable: unrecoverable.mock.calls.length,
    }).toEqual({ reloads: 1, unrecoverable: 0 })
    expect(later.defaultPrevented).toBe(false)
  })

  it("a document whose reload never replaced it reloads again once the window has passed", async () => {
    //A `beforeunload` handler that cancels the reload, or a restore from the
    //back/forward cache, leaves the document that asked for it running. It stays
    //quiet while the reload could still be on its way — and not for good.
    const net = await armDocument()
    staleChunk()

    vi.setSystemTime(T0 + 5_000)
    staleChunk()
    const quiet = net.outcome()

    vi.setSystemTime(T0 + 31_000)
    staleChunk()
    net.teardown()

    expect({ quiet, after: net.outcome() }).toEqual({
      quiet: { reloads: 1, unrecoverable: 0 },
      after: { reloads: 2, unrecoverable: 0 },
    })
  })
})
