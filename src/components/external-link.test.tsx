import { Browser } from "@capacitor/browser"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ExternalLink } from "#adaptv/components/external-link"

vi.mock("@capacitor/browser", () => ({
  Browser: { open: vi.fn(() => Promise.resolve()) },
}))

function forceNative(native: boolean): void {
  vi.stubGlobal(
    "Capacitor",
    native ? { isNativePlatform: () => true } : undefined,
  )
}

/** Click the link and report whether the component took the click from the anchor. */
function click(
  link: HTMLElement,
  init: MouseEventInit = { button: 0 },
): boolean {
  return !fireEvent.click(link, init)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe("ExternalLink", () => {
  it("renders a real anchor with safe target/rel", () => {
    const { getByRole } = render(
      <ExternalLink href="https://x.com">go</ExternalLink>,
    )
    const a = getByRole("link") as HTMLAnchorElement
    expect(a.getAttribute("href")).toBe("https://x.com")
    expect(a.getAttribute("target")).toBe("_blank")
    expect(a.getAttribute("rel")).toBe("noopener noreferrer")
  })

  it("leaves a plain left-click to the anchor on web, so its rel keeps the Referer off", () => {
    forceNative(false)
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    const { getByRole } = render(
      <ExternalLink href="https://x.com">go</ExternalLink>,
    )
    expect(click(getByRole("link"))).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it("routes a plain left-click to the in-app browser on native", () => {
    forceNative(true)
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    const { getByRole } = render(
      <ExternalLink href="https://x.com">go</ExternalLink>,
    )
    expect(click(getByRole("link"))).toBe(true)
    expect(Browser.open).toHaveBeenCalledWith({ url: "https://x.com/" })
    expect(open).not.toHaveBeenCalled()
  })

  it("lets a ⌘/ctrl click fall through to native new-tab", () => {
    forceNative(true)
    const { getByRole } = render(
      <ExternalLink href="https://x.com">go</ExternalLink>,
    )
    expect(click(getByRole("link"), { metaKey: true })).toBe(false)
    expect(Browser.open).not.toHaveBeenCalled()
  })

  it("forwards a consumer onClick", () => {
    const onClick = vi.fn()
    const { getByRole } = render(
      <ExternalLink href="https://x.com" onClick={onClick}>
        go
      </ExternalLink>,
    )
    click(getByRole("link"))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe("ExternalLink — style tiers", () => {
  it("adds no class of its own, names its part, and locks the touch pass-through inline", () => {
    const a = render(
      <ExternalLink
        href="https://x.com"
        className="touch-none text-blue-600"
        style={{ touchAction: "none", color: "rgb(255, 0, 0)" }}
      >
        go
      </ExternalLink>,
    ).getByRole("link")
    expect(a.getAttribute("data-adaptv")).toBe("external-link")
    expect(a.getAttribute("data-part")).toBe("root")
    //the consumer's className, untouched — and nothing of adaptv's beside it
    expect(a.className).toBe("touch-none text-blue-600")
    expect(a.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    expect(a.style.color).toBe("rgb(255, 0, 0)")
  })

  it("writes no class attribute when the consumer passes none", () => {
    const a = render(
      <ExternalLink href="https://x.com">go</ExternalLink>,
    ).getByRole("link")
    expect(a.hasAttribute("class")).toBe(false)
  })
})
