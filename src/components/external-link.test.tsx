import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ExternalLink } from "#nativ/components/external-link"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("ExternalLink", () => {
  it("renders a real anchor with safe target/rel", () => {
    const { getByRole } = render(
      <ExternalLink href="https://x.com">go</ExternalLink>,
    )
    const a = getByRole("link") as HTMLAnchorElement
    expect(a.getAttribute("href")).toBe("https://x.com")
    expect(a.getAttribute("target")).toBe("_blank")
    expect(a.getAttribute("rel")).toContain("noopener")
  })

  it("opens externally on a plain left-click", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    const { getByRole } = render(
      <ExternalLink href="https://x.com">go</ExternalLink>,
    )
    fireEvent.click(getByRole("link"), { button: 0 })
    expect(open).toHaveBeenCalledWith(
      "https://x.com",
      "_blank",
      "noopener,noreferrer",
    )
  })

  it("lets a ⌘/ctrl click fall through to native new-tab", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    const { getByRole } = render(
      <ExternalLink href="https://x.com">go</ExternalLink>,
    )
    fireEvent.click(getByRole("link"), { metaKey: true })
    expect(open).not.toHaveBeenCalled()
  })

  it("forwards a consumer onClick", () => {
    vi.spyOn(window, "open").mockReturnValue(null)
    const onClick = vi.fn()
    const { getByRole } = render(
      <ExternalLink href="https://x.com" onClick={onClick}>
        go
      </ExternalLink>,
    )
    fireEvent.click(getByRole("link"), { button: 0 })
    expect(onClick).toHaveBeenCalledOnce()
  })
})
