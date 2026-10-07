import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { cleanup, fireEvent, render } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Link } from "#adaptv/components/link"

// Stub TanStack Router: a minimal useRouter + an internal-link marker so we can tell
// the internal (RouterLink) path from the external (ExternalLink) hand-off.
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    subscribe: () => () => {},
    state: { location: { pathname: "/", state: { __TSR_index: 0 } } },
    history: { canGoBack: () => false, back: () => {} },
  }),
  Link: ({
    children,
    to,
    className,
    params: _params,
    search: _search,
    ...rest
  }: {
    children?: ReactNode
    to: string
    className?: string
    params?: unknown
    search?: unknown
    [attribute: string]: unknown
  }) => (
    <a data-internal href={to} className={className} {...rest}>
      {children}
    </a>
  ),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("Link", () => {
  it("forwards the anchor's own attributes, so a wrapper rendering as a link keeps its parts", () => {
    //FieldGroup.Row render={<Link to="…" />} clones data-part / aria-disabled
    //onto the element; a Link that dropped them would break the rows contract
    const { getByRole } = render(
      <Link to="/settings" data-part="row" aria-disabled="true" id="row-1">
        Settings
      </Link>,
    )
    const a = getByRole("link")
    expect(a.getAttribute("data-part")).toBe("row")
    expect(a.getAttribute("aria-disabled")).toBe("true")
    expect(a.id).toBe("row-1")
    //and nothing the anchor forwards can take the link's own identity
    expect(a.getAttribute("data-adaptv")).toBe("link")
  })

  it("renders without children, which is what a row becomes before its content is cloned in", () => {
    const { getByRole } = render(<Link to="/settings" />)
    expect(getByRole("link").getAttribute("href")).toBe("/settings")
  })

  it("routes an internal path through the router link", () => {
    const { getByRole } = render(<Link to="/settings">Settings</Link>)
    const a = getByRole("link")
    expect(a.getAttribute("data-internal")).not.toBeNull()
    expect(a.getAttribute("target")).toBeNull()
  })

  it("hands an external URL to ExternalLink's own new-tab anchor", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    const { getByRole } = render(<Link to="https://x.com">Docs</Link>)
    const a = getByRole("link")
    expect(a.getAttribute("data-internal")).toBeNull() // not the router path
    expect(a.getAttribute("target")).toBe("_blank")
    expect(a.getAttribute("rel")).toBe("noopener noreferrer")

    //on web the anchor opens the tab itself — nothing intercepts the click
    expect(fireEvent.click(a, { button: 0 })).toBe(true)
    expect(open).not.toHaveBeenCalled()
  })
})

describe("Link — style tiers", () => {
  it("adds no class of its own and names its part, keeping a wrapper's", () => {
    const own = render(<Link to="/a">A</Link>).getByRole("link")
    expect(own.hasAttribute("class")).toBe(false)
    expect(own.getAttribute("data-part")).toBe("root")
    expect(own.getAttribute("data-adaptv")).toBe("link")
    //the press engine's attribute is what link.css keys the in-app look on
    expect(own.hasAttribute("data-press-engine")).toBe(true)
    cleanup()
    const row = render(
      <Link to="/a" data-part="row">
        A
      </Link>,
    ).getByRole("link")
    expect(row.getAttribute("data-part")).toBe("row")
  })

  it("passes the consumer's className through untouched", () => {
    const a = render(
      <Link to="/a" className="text-blue-600 underline">
        A
      </Link>,
    ).getByRole("link")
    expect(a.className).toBe("text-blue-600 underline")
  })

  //the press-core reason: the `touch-action` longhand keeps `pointercancel` alive on
  //iOS (WebKit 240917), which is how the engine learns a scroll took over
  it("locks the touch pass-through inline, against a consumer class and style", () => {
    const a = render(
      <Link
        to="/a"
        className="touch-none"
        style={{ touchAction: "none", color: "rgb(255, 0, 0)" }}
      >
        A
      </Link>,
    ).getByRole("link")
    expect(a.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    expect(a.style.color).toBe("rgb(255, 0, 0)")
    expect(a.style.userSelect).toBe("")
  })

  it("disabled: the same pass-through, and its label is not selectable", () => {
    const a = render(
      <Link to="/a" disabled style={{ userSelect: "text" }}>
        A
      </Link>,
    ).getByRole("link")
    expect(a.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    expect(a.style.userSelect).toBe("none")
    expect(a.getAttribute("aria-disabled")).toBe("true")
  })

  it("an external `to` keeps ExternalLink's look and lock, under the link scope", () => {
    const a = render(
      <Link to="https://x.com" className="p-2">
        Docs
      </Link>,
    ).getByRole("link")
    expect(a.getAttribute("data-adaptv")).toBe("link")
    expect(a.getAttribute("data-part")).toBe("root")
    expect(a.hasAttribute("data-press-engine")).toBe(false)
    expect(a.className).toBe("p-2")
    expect(a.style.touchAction).toBe("pan-x pan-y pinch-zoom")
  })

  it("link.css is layered, zero-specificity and never !important", () => {
    const css = readFileSync(
      resolve(__dirname, "../styles/link.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "")
    expect(css).toContain("@layer adaptv.components")
    expect(css).toContain(
      ':where([data-adaptv="link"], [data-adaptv="external-link"])',
    )
    expect(css).not.toContain("!important")
    //the lock is inline only — a layer rule would lose to an unlayered consumer class
    expect(css).not.toContain("touch-action")
  })
})
