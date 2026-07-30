import { render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { OrientationGuard } from "#adaptv/components/orientation-guard"

/*
 * The rotate guard, which is the hardest full-screen component to catch by hand.
 *
 * It is a conditional host: `null` until the manifest asks for one orientation and the
 * device is in the other. That is why it is not in `data-adaptv.test.tsx` — a list that
 * reads `container.firstElementChild` sees nothing for it — and it is also why it needs
 * a suite of its own: nothing else asserts that the thing appears at all, and a guard
 * that silently never renders looks exactly like a guard that is not needed.
 */

//`matchMedia` does not exist in happy-dom, and the guard reads it through
//`useMediaQuery`. `matches` is what decides whether the device is mismatched.
function stubOrientation({ mismatched }: { mismatched: boolean }) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: mismatched,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
}

//the guard resolves the required orientation from the web manifest
function stubManifest(orientation: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: orientation !== null,
      json: async () => (orientation ? { orientation } : {}),
    })) as unknown as typeof fetch,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("OrientationGuard", () => {
  it("renders nothing while the orientation matches", async () => {
    stubManifest("portrait")
    stubOrientation({ mismatched: false })
    const { container } = render(
      <OrientationGuard manifestPath="/manifest.webmanifest" />,
    )
    //allow the manifest fetch to settle before concluding "nothing rendered"
    await vi.waitFor(() => {
      expect(container.firstElementChild).toBeNull()
    })
  })

  it("renders nothing at all when the manifest asks for no orientation", async () => {
    //`any` is the common case, and a guard that fired on it would make the app
    //unusable in landscape for no reason
    stubManifest("any")
    stubOrientation({ mismatched: true })
    const { container } = render(
      <OrientationGuard manifestPath="/manifest.webmanifest" />,
    )
    await vi.waitFor(() => {
      expect(container.firstElementChild).toBeNull()
    })
  })

  it("takes over the screen when the device is mismatched, and identifies itself", async () => {
    stubManifest("portrait")
    stubOrientation({ mismatched: true })
    const { container } = render(
      <OrientationGuard manifestPath="/manifest.webmanifest" />,
    )

    await vi.waitFor(() => {
      const root = container.firstElementChild as HTMLElement | null
      expect(root, "the guard never rendered").not.toBeNull()
      //the identity attribute the rest of the primitives carry — asserted here
      //rather than in data-adaptv.test.tsx because getting it to render is the work
      expect(root?.getAttribute("data-adaptv")).toBe("orientation-guard")
      //it must actually cover the app, or it is just a message behind the UI
      expect(root?.className).toContain("fixed")
      expect(root?.className).toContain("inset-0")
      //and be announced, because it replaces the entire screen
      expect(root?.getAttribute("role")).toBe("alert")
    })
  })
})
