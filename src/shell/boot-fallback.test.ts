import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  APP_ROOT_ID,
  BOOT_BUNDLE_ATTR,
  BOOT_CODE_ATTR,
  BOOT_CODES,
  BOOT_FAILED_ATTR,
  BOOT_FALLBACK_ID,
  BOOT_GRACE_MS,
  BOOT_RETRY_ATTR,
  EMBEDDED_BUNDLE,
  getBootFallbackCss,
  getBootFallbackMarkup,
  getBootFallbackScript,
} from "#adaptv/shell/boot-fallback"

/*
 * The watchdog is the only code in adaptv that runs in a world where the app's
 * own bundle did not. It is tested by EVALUATING it, not by reading it: it ships
 * as a string, so a unit test of some other implementation of the same idea would
 * prove nothing about what actually lands in the document.
 */

/** What a component that ignores `code` produces — adaptv's default, and most apps'. */
const SAME = Object.fromEntries(
  Object.values(BOOT_CODES).map((code) => [
    code,
    `<p>generic</p><button ${BOOT_RETRY_ATTR}="">Retry</button>`,
  ]),
)

/** What a component that branches on `code` produces. */
const BRANCHING = Object.fromEntries(
  Object.values(BOOT_CODES).map((code) => [
    code,
    `<p>screen for ${code}</p><button ${BOOT_RETRY_ATTR}="">Retry</button>`,
  ]),
)

function arm(
  byCode: Record<string, string> = SAME,
  { rootContent = "" }: { rootContent?: string } = {},
) {
  document.head.innerHTML = `<style>${getBootFallbackCss()}</style>`
  document.body.innerHTML =
    `<div id="${APP_ROOT_ID}">${rootContent}</div>` +
    getBootFallbackMarkup(byCode)
  //evaluated on purpose — see the note above
  new Function(getBootFallbackScript())()
}

const box = () => document.getElementById(BOOT_FALLBACK_ID)
const showing = () => box()?.hasAttribute("hidden") === false
/**
 * Only what a user would actually be looking at.
 *
 * `textContent` is no good on its own: it walks hidden children too, and every
 * variant but one is hidden. Without this the per-code assertions would pass
 * against a screen showing all four stacked on top of each other.
 */
const onScreen = () => {
  const b = box()
  if (!b || b.hasAttribute("hidden")) return ""
  const variants = [...b.querySelectorAll(`[${BOOT_CODE_ATTR}]`)]
  if (variants.length === 0) return b.textContent ?? ""
  return variants
    .filter((node) => !node.hasAttribute("hidden"))
    .map((node) => node.textContent ?? "")
    .join("")
}
const stampedCode = () =>
  document.documentElement.getAttribute(BOOT_FAILED_ATTR)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.head.innerHTML = ""
  document.body.innerHTML = ""
  document.documentElement.removeAttribute(BOOT_FAILED_ATTR)
  document.documentElement.removeAttribute(BOOT_BUNDLE_ATTR)
})

describe("the boot fallback markup", () => {
  it("ships hidden, so a healthy boot never sees it", () => {
    expect(getBootFallbackMarkup(SAME)).toContain("hidden")
  })

  it("collapses to ONE copy when the component ignores the code", () => {
    //four byte-identical copies of the same screen in every document would be
    //pure waste. Only a component that actually branches pays for the variants.
    const markup = getBootFallbackMarkup(SAME)
    expect(markup.match(/generic/g)).toHaveLength(1)
    expect(markup).not.toContain(BOOT_CODE_ATTR)
  })

  it("emits one labelled variant per code when the renders differ", () => {
    const markup = getBootFallbackMarkup(BRANCHING)
    for (const code of Object.values(BOOT_CODES)) {
      expect(markup).toContain(`${BOOT_CODE_ATTR}="${code}"`)
      expect(markup).toContain(`screen for ${code}`)
    }
  })

  it("hides with the ATTRIBUTE, which works with no stylesheet at all", () => {
    //the whole path exists for a broken build; depending on a class would mean
    //depending on the stylesheet having loaded, which is not a given here
    expect(getBootFallbackCss()).toContain(
      `#${BOOT_FALLBACK_ID}[hidden]{display:none!important}`,
    )
  })

  it("covers the viewport and keeps text off the edges without Tailwind", () => {
    const css = getBootFallbackCss()
    expect(css).toContain("position:fixed")
    expect(css).toContain("padding:1.5rem")
  })
})

describe("the boot watchdog", () => {
  it("stays hidden while nothing has gone wrong", () => {
    arm()
    expect(showing()).toBe(false)
  })

  it("reveals the screen when a script fails to load", () => {
    //the flagship case: the entry chunk 404s or will not parse, so React never
    //runs and the WebView would otherwise paint blank
    arm()
    const script = document.createElement("script")
    document.body.appendChild(script)
    script.dispatchEvent(new Event("error"))

    expect(showing()).toBe(true)
  })

  it("reveals the screen when the bundle throws before mounting", () => {
    arm()
    window.dispatchEvent(new Event("error"))
    expect(showing()).toBe(true)
  })

  it("reveals the screen after the grace period when nothing mounted", () => {
    //a bundle that loaded and failed silently dispatches no event at all
    arm()
    vi.advanceTimersByTime(BOOT_GRACE_MS + 1)
    expect(showing()).toBe(true)
  })

  it("NEVER replaces content that is already on the page", () => {
    //the server-rendered page whose JS is merely slow. Revealing here would swap
    //good content for an error screen — strictly worse than doing nothing. The
    //mount point being non-empty is the whole test, and it is why the watchdog
    //needs no boot flag from the app.
    arm(SAME, { rootContent: "<main>real content</main>" })

    window.dispatchEvent(new Event("error"))
    vi.advanceTimersByTime(BOOT_GRACE_MS + 1)

    expect(showing()).toBe(false)
  })

  it("stands down if the app mounts after the screen was revealed", () => {
    arm()
    vi.advanceTimersByTime(BOOT_GRACE_MS + 1)
    expect(showing()).toBe(true)

    document
      .getElementById(APP_ROOT_ID)
      ?.appendChild(document.createElement("main"))
    //the observer fires on a microtask, not synchronously
    return Promise.resolve().then(() => {
      expect(showing()).toBe(false)
      expect(stampedCode()).toBeNull()
    })
  })

  it("reloads on a plain button, with nothing asked of the component", () => {
    //THE DX contract. A custom error screen is written the obvious way — a
    //`<button onClick={reset}>` — and in the fallback that handler does not
    //exist, because a build-time render serializes no event handlers. Requiring
    //an opt-in attribute would make a forgotten spread produce a DEAD button at
    //the exact moment a reload is the only way out. In a document with no app JS
    //a button has nothing else it could do, so any of them reloads.
    const reload = vi.fn()
    vi.stubGlobal("location", { reload })
    arm(
      Object.fromEntries(
        Object.values(BOOT_CODES).map((code) => [
          code,
          "<p>broken</p><button>Try again</button>",
        ]),
      ),
    )
    vi.advanceTimersByTime(BOOT_GRACE_MS + 1)
    ;(box()?.querySelector("button") as HTMLElement).click()

    expect(reload).toHaveBeenCalledOnce()
  })

  it("leaves anchors alone — they navigate natively without any JS", () => {
    const reload = vi.fn()
    vi.stubGlobal("location", { reload })
    arm(
      Object.fromEntries(
        Object.values(BOOT_CODES).map((code) => [
          code,
          '<a href="mailto:help@example.com">Contact support</a>',
        ]),
      ),
    )
    vi.advanceTimersByTime(BOOT_GRACE_MS + 1)
    ;(box()?.querySelector("a") as HTMLElement).click()

    expect(reload).not.toHaveBeenCalled()
  })

  it("narrows to the marked control when a screen has two buttons", () => {
    //the precision tool, for the one case the blanket rule gets wrong
    const reload = vi.fn()
    vi.stubGlobal("location", { reload })
    arm(
      Object.fromEntries(
        Object.values(BOOT_CODES).map((code) => [
          code,
          `<button id="other">Support</button><button id="retry" ${BOOT_RETRY_ATTR}="">Retry</button>`,
        ]),
      ),
    )
    vi.advanceTimersByTime(BOOT_GRACE_MS + 1)
    ;(box()?.querySelector("#other") as HTMLElement).click()
    expect(reload).not.toHaveBeenCalled()
    ;(box()?.querySelector("#retry") as HTMLElement).click()
    expect(reload).toHaveBeenCalledOnce()
  })

  it("wires the retry control, which has no JavaScript of its own", () => {
    //the prerendered button is inert markup — adaptv's Button commits through a
    //gesture engine that is not running here. Delegation off the attribute is
    //what makes the only action on the screen work.
    const reload = vi.fn()
    vi.stubGlobal("location", { reload })
    arm()
    vi.advanceTimersByTime(BOOT_GRACE_MS + 1)

    const retry = document.querySelector(`[${BOOT_RETRY_ATTR}]`)
    ;(retry as HTMLElement).click()

    expect(reload).toHaveBeenCalledOnce()
  })
})

describe("the boot code", () => {
  it("is stamped on the document, never printed by adaptv", () => {
    //one attribute read for telemetry or an e2e assertion, with no opinion about
    //what — if anything — the user should be shown
    arm()
    const script = document.createElement("script")
    document.body.appendChild(script)
    script.dispatchEvent(new Event("error"))

    expect(stampedCode()).toBe(BOOT_CODES.load)
    expect(onScreen()).not.toContain(BOOT_CODES.load)
  })

  it("tells a file that never arrived apart from one that is broken", () => {
    //LOAD is a deploy or CDN problem; THROW means the file arrived and its code
    //is broken. Same blank screen, completely different thing to go fix.
    arm()
    window.dispatchEvent(new Event("error"))
    expect(stampedCode()).toBe(BOOT_CODES.throw)
  })

  it("codes an unhandled rejection", () => {
    arm()
    window.dispatchEvent(new Event("unhandledrejection"))
    expect(stampedCode()).toBe(BOOT_CODES.reject)
  })

  it("codes the silent case, where nothing was ever raised", () => {
    arm()
    vi.advanceTimersByTime(BOOT_GRACE_MS + 1)
    expect(stampedCode()).toBe(BOOT_CODES.stall)
  })

  it("reveals the variant the app rendered FOR that code", () => {
    //the payoff of prerendering per code: an app that branches in JSX gets its
    //own screen for "we are not serving the file", not a generic one
    arm(BRANCHING)
    window.dispatchEvent(new Event("unhandledrejection"))

    expect(onScreen()).toContain(`screen for ${BOOT_CODES.reject}`)
    expect(onScreen()).not.toContain(`screen for ${BOOT_CODES.load}`)
  })

  it("shows exactly one variant, never a stack of them", () => {
    arm(BRANCHING)
    vi.advanceTimersByTime(BOOT_GRACE_MS + 1)

    const visible = [
      ...(box()?.querySelectorAll(`[${BOOT_CODE_ATTR}]`) ?? []),
    ].filter((node) => !node.hasAttribute("hidden"))
    expect(visible).toHaveLength(1)
    expect(visible[0]?.getAttribute(BOOT_CODE_ATTR)).toBe(BOOT_CODES.stall)
  })
})

describe("getting out from under the native splash", () => {
  /** A bridge with both plugins, like a real native launch. */
  const nativeBridge = (hide: () => void) =>
    vi.stubGlobal("Capacitor", {
      Plugins: {
        SplashScreen: { hide },
        LiveUpdate: {
          getCurrentBundle: () => Promise.resolve({ bundleId: null }),
        },
      },
    })

  it("hides it, because the screen is otherwise revealed underneath it", () => {
    //🔴 Measured on a simulator, and it made every other guarantee here moot: the
    //launch splash is a NATIVE view held open on purpose (`launchAutoHide: false`),
    //and the only thing that hides it is the shell — i.e. exactly the code that
    //just failed to run. The screen was up, correct, and invisible.
    const hide = vi.fn()
    nativeBridge(hide)
    arm()
    window.dispatchEvent(new Event("unhandledrejection"))
    expect(showing()).toBe(true)
    expect(hide).toHaveBeenCalledOnce()
  })

  it("does not touch it on a launch that boots", () => {
    //Hiding it early is the flash `launchAutoHide: false` exists to prevent.
    const hide = vi.fn()
    nativeBridge(hide)
    arm()
    document
      .getElementById(APP_ROOT_ID)
      ?.appendChild(document.createElement("main"))
    window.dispatchEvent(new Event("unhandledrejection"))
    expect(showing()).toBe(false)
    expect(hide).not.toHaveBeenCalled()
  })

  it("reveals the screen even when hiding it throws", () => {
    //A bridge that answers badly must not cost the diagnosis it was called to
    //make visible.
    nativeBridge(() => {
      throw new Error("no")
    })
    arm()
    window.dispatchEvent(new Event("unhandledrejection"))
    expect(showing()).toBe(true)
    expect(stampedCode()).toBe(BOOT_CODES.reject)
  })

  it("asks for nothing on web and PWA, where there is no splash", () => {
    arm()
    window.dispatchEvent(new Event("unhandledrejection"))
    expect(showing()).toBe(true)
  })
})

describe("naming the bundle that failed", () => {
  const stampedBundle = () =>
    document.documentElement.getAttribute(BOOT_BUNDLE_ATTR)

  /** A bridge that answers `getCurrentBundle`, like the real plugin. */
  const bridge = (bundleId: string | null) =>
    vi.stubGlobal("Capacitor", {
      Plugins: {
        LiveUpdate: {
          getCurrentBundle: () => Promise.resolve({ bundleId }),
        },
      },
    })

  it("stamps the tag of the bundle that was actually running", async () => {
    //The code alone is not actionable under OTA: `BOOT-LOAD` says a chunk was not
    //served, and the next question is always WHICH deploy to roll back.
    bridge("3f2a9c11b4d0e7a5")
    arm()
    window.dispatchEvent(new Event("unhandledrejection"))

    await vi.waitFor(() =>
      expect(stampedBundle()).toBe("3f2a9c11b4d0e7a5"),
    )
  })

  it("names the built-in bundle rather than staying silent", async () => {
    //A different fact entirely, and a much worse one: the binary shipped by the
    //store cannot start. Absence of the attribute would read as "unknown".
    bridge(null)
    arm()
    window.dispatchEvent(new Event("unhandledrejection"))

    await vi.waitFor(() => expect(stampedBundle()).toBe(EMBEDDED_BUNDLE))
  })

  it("reveals the screen without waiting for the bridge to answer", () => {
    //A user staring at a blank app while a plugin round-trip completes is a worse
    //outcome than telemetry reading the code a frame before the tag.
    let settle: (value: { bundleId: string }) => void = () => {}
    vi.stubGlobal("Capacitor", {
      Plugins: {
        LiveUpdate: {
          getCurrentBundle: () =>
            new Promise<{ bundleId: string }>((resolve) => {
              settle = resolve
            }),
        },
      },
    })

    arm()
    window.dispatchEvent(new Event("unhandledrejection"))

    expect(showing()).toBe(true)
    expect(stampedCode()).toBe(BOOT_CODES.reject)
    expect(stampedBundle()).toBeNull()
    settle({ bundleId: "late" })
  })

  it("stamps nothing on web and PWA, where there is no bundle to name", () => {
    arm()
    window.dispatchEvent(new Event("unhandledrejection"))
    expect(showing()).toBe(true)
    expect(stampedBundle()).toBeNull()
  })

  it("clears the tag when a late mount wins the race", async () => {
    //The stamp is a statement about the screen that is up. Leaving it behind on a
    //recovered document would make every later reader believe a failure it can no
    //longer see.
    bridge("3f2a9c11b4d0e7a5")
    arm()
    window.dispatchEvent(new Event("unhandledrejection"))
    await vi.waitFor(() => expect(stampedBundle()).not.toBeNull())

    document
      .getElementById(APP_ROOT_ID)
      ?.appendChild(document.createElement("main"))
    await vi.waitFor(() => expect(stampedBundle()).toBeNull())
    expect(stampedCode()).toBeNull()
  })

  it("survives a bridge that throws or answers with nothing usable", async () => {
    //Last code standing in a document whose bundle already failed: it must never
    //be the second thing that breaks.
    for (const getCurrentBundle of [
      () => {
        throw new Error("wedged")
      },
      () => undefined,
      () => Promise.reject(new Error("no")),
    ]) {
      vi.stubGlobal("Capacitor", {
        Plugins: { LiveUpdate: { getCurrentBundle } },
      })
      arm()
      expect(() =>
        window.dispatchEvent(new Event("unhandledrejection")),
      ).not.toThrow()
      expect(showing()).toBe(true)
      document.documentElement.removeAttribute(BOOT_FAILED_ATTR)
    }
  })
})

/*
 * Under OTA the running bundle is not the one in the binary — it is one the app
 * downloaded, chosen by a pointer the bridge reads at LAUNCH. `location.reload()`
 * does not revisit that pointer, so on a corrupt bundle the retry button is an
 * infinite loop dressed as a way out. These assert the escape hatch, and equally
 * that it stays out of the way everywhere it is not needed.
 */
describe("retry, when a stale bundle pointer is the thing standing in the way", () => {
  /** A bridge whose plugin resolves, like the real one. */
  function bridge(overrides: Record<string, unknown> = {}) {
    const reset = vi.fn(() => Promise.resolve())
    const reload = vi.fn(() => Promise.resolve())
    vi.stubGlobal("Capacitor", {
      Plugins: { LiveUpdate: { reset, reload, ...overrides } },
    })
    return { reset, reload }
  }

  it("drops to the built-in bundle instead of re-running the broken one", async () => {
    const reload = vi.fn()
    vi.stubGlobal("location", { reload })
    const live = bridge()

    arm()
    window.dispatchEvent(new Event("unhandledrejection"))
    ;(box()?.querySelector("button") as HTMLElement).click()

    expect(live.reset).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(live.reload).toHaveBeenCalledOnce())
    //the whole point: a document reload would have re-run the same bundle
    expect(reload).not.toHaveBeenCalled()
  })

  it("still just reloads where there is no bridge — web and PWA", () => {
    //Correct there rather than a degraded fallback: nothing is holding a stale
    //pointer, so the document reload IS the fix.
    const reload = vi.fn()
    vi.stubGlobal("location", { reload })

    arm()
    window.dispatchEvent(new Event("unhandledrejection"))
    ;(box()?.querySelector("button") as HTMLElement).click()

    expect(reload).toHaveBeenCalledOnce()
  })

  it("reloads when the bridge is there but the plugin is not", () => {
    //`offline-page.mjs` documents a real case where the bridge is absent from a
    //page by origin scoping. Detect, never assume.
    const reload = vi.fn()
    vi.stubGlobal("location", { reload })
    vi.stubGlobal("Capacitor", { Plugins: {} })

    arm()
    window.dispatchEvent(new Event("unhandledrejection"))
    ;(box()?.querySelector("button") as HTMLElement).click()

    expect(reload).toHaveBeenCalledOnce()
  })

  it("reloads when the escape hatch itself fails", () => {
    //A button that does nothing is the one outcome worse than a button that
    //reloads, and this screen exists precisely because things are already broken.
    const reload = vi.fn()
    vi.stubGlobal("location", { reload })
    bridge({
      reset: () => {
        throw new Error("bridge is wedged")
      },
    })

    arm()
    window.dispatchEvent(new Event("unhandledrejection"))
    ;(box()?.querySelector("button") as HTMLElement).click()

    expect(reload).toHaveBeenCalledOnce()
  })

  it("reloads when the plugin rejects asynchronously", async () => {
    const reload = vi.fn()
    vi.stubGlobal("location", { reload })
    bridge({ reset: () => Promise.reject(new Error("no")) })

    arm()
    window.dispatchEvent(new Event("unhandledrejection"))
    ;(box()?.querySelector("button") as HTMLElement).click()

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
  })
})
