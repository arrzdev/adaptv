import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  APP_ROOT_ID,
  BOOT_CODE_ATTR,
  BOOT_CODES,
  BOOT_FAILED_ATTR,
  BOOT_FALLBACK_ID,
  BOOT_GRACE_MS,
  BOOT_RETRY_ATTR,
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
