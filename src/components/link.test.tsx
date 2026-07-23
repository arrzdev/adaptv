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
  }: {
    children: ReactNode
    to: string
    className?: string
  }) => (
    <a data-internal href={to} className={className}>
      {children}
    </a>
  ),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("Link", () => {
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
