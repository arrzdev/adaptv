import { render } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { UiNotFound } from "#adaptv/components/not-found"

//UiNotFound renders a real router Link. Same minimal stub the other suites use.
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    subscribe: () => () => {},
    state: { location: { pathname: "/", state: { __TSR_index: 0 } } },
    history: { canGoBack: () => false, back: () => {} },
  }),
  Link: ({
    children,
    className,
    ...rest
  }: {
    children?: ReactNode
    className?: string
    to?: string
  }) => (
    <a href="/" className={className} {...rest}>
      {children}
    </a>
  ),
}))

describe("UiNotFound", () => {
  it('stamps `data-adaptv="not-found"` on the root alone; each part has its own scope', () => {
    //a consumer's `[data-adaptv="not-found"]` (and every spec that locates the screen
    //by it) must match one element, not the screen and every piece of copy inside it
    const { container } = render(<UiNotFound />)
    const roots = container.querySelectorAll('[data-adaptv="not-found"]')
    expect(roots).toHaveLength(1)
    expect(roots[0].getAttribute("data-part")).toBe("root")
    for (const part of ["code", "title", "description"])
      expect(
        container.querySelectorAll(
          `[data-adaptv="not-found-${part}"][data-part="${part}"]`,
        ),
        part,
      ).toHaveLength(1)
  })
})
