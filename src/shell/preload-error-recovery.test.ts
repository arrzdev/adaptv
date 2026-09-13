import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearPreloadErrorGuard,
  PRELOAD_ERROR_GUARD_KEY,
  shouldReloadAfterPreloadError,
} from "#adaptv/shell/preload-error-recovery"

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe("shouldReloadAfterPreloadError — B4", () => {
  //After a deploy, an open tab's next lazy `import()` requests a chunk hash the
  //new precache no longer lists: 404 at both cache and origin, white screen, no
  //recovery. A reload fixes it — the tab picks up the new manifest.
  it("permits a reload the first time a chunk fails to load", () => {
    expect(shouldReloadAfterPreloadError()).toBe(true)
  })

  it("refuses a second reload — a missing asset must not become a loop", () => {
    //this is the whole reason for the guard. If the chunk is genuinely gone (a
    //bad deploy, not a stale tab), reloading cannot fix it, and an unguarded
    //handler spins the browser forever.
    expect(shouldReloadAfterPreloadError()).toBe(true)
    expect(shouldReloadAfterPreloadError()).toBe(false)
  })

  it("records the attempt where a reload can observe it", () => {
    //must be sessionStorage, not memory: the reload wipes memory, which would
    //make the guard useless
    shouldReloadAfterPreloadError()
    expect(sessionStorage.getItem(PRELOAD_ERROR_GUARD_KEY)).not.toBeNull()
  })

  it("re-arms once the app loads successfully", () => {
    //otherwise a single recovered error would leave the tab unable to recover
    //from the NEXT deploy for the rest of the session
    shouldReloadAfterPreloadError()
    clearPreloadErrorGuard()
    expect(shouldReloadAfterPreloadError()).toBe(true)
  })

  it("refuses to reload when it cannot guard, rather than risking a loop", () => {
    //Safari in private mode and partitioned third-party contexts both throw here.
    //Failing closed costs one manual refresh; failing open spins forever.
    vi.stubGlobal("sessionStorage", {
      getItem() {
        throw new Error("SecurityError")
      },
      setItem() {
        throw new Error("SecurityError")
      },
      removeItem() {},
    })
    expect(shouldReloadAfterPreloadError()).toBe(false)
  })

  it("never throws from the clear path either", () => {
    vi.stubGlobal("sessionStorage", {
      removeItem() {
        throw new Error("SecurityError")
      },
    })
    expect(() => clearPreloadErrorGuard()).not.toThrow()
  })
})

describe("installPreloadErrorRecovery — one answer per document", () => {
  //the in-flight flag is module state that dies with the document, so each test
  //imports a fresh module: a fresh document
  async function freshNet() {
    vi.resetModules()
    return import("#adaptv/shell/preload-error-recovery")
  }

  function staleChunk() {
    window.dispatchEvent(
      new Event("vite:preloadError", { cancelable: true }),
    )
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("a second installation cannot turn the first one's reload into a failure", async () => {
    //an app calling the exported net next to the shell's must not reproduce the
    //shell's old double arming: reload, then "unrecoverable" for the same error
    const reload = vi
      .spyOn(window.location, "reload")
      .mockImplementation(() => {})
    const { installPreloadErrorRecovery } = await freshNet()
    const unrecoverable = vi.fn()
    const teardowns = [
      installPreloadErrorRecovery(unrecoverable),
      installPreloadErrorRecovery(unrecoverable),
    ]

    staleChunk()
    staleChunk()
    for (const teardown of teardowns) teardown()

    expect({
      reloads: reload.mock.calls.length,
      unrecoverable: unrecoverable.mock.calls.length,
    }).toEqual({ reloads: 1, unrecoverable: 0 })
  })

  it("reports unrecoverable, without reloading, in the document a reload produced", async () => {
    const reload = vi
      .spyOn(window.location, "reload")
      .mockImplementation(() => {})
    sessionStorage.setItem(PRELOAD_ERROR_GUARD_KEY, "1")
    const { installPreloadErrorRecovery } = await freshNet()
    const unrecoverable = vi.fn()
    const teardown = installPreloadErrorRecovery(unrecoverable)

    staleChunk()
    teardown()

    expect({
      reloads: reload.mock.calls.length,
      unrecoverable: unrecoverable.mock.calls.length,
    }).toEqual({ reloads: 0, unrecoverable: 1 })
  })
})
