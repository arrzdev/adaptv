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

  it("hands an external URL to the system browser", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    const { getByRole } = render(<Link to="https://x.com">Docs</Link>)
    const a = getByRole("link")
    expect(a.getAttribute("data-internal")).toBeNull() // not the router path
    expect(a.getAttribute("target")).toBe("_blank")

    fireEvent.click(a, { button: 0 })
    expect(open).toHaveBeenCalledWith(
      "https://x.com",
      "_blank",
      "noopener,noreferrer",
    )
  })
})
