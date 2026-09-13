import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getChromeTint,
  setThemeColorBase,
} from "#adaptv/capabilities/theme-color"
import { Drawer } from "#adaptv/components/drawer/drawer"
import { THEME_COLOR_META_ID } from "#adaptv/shell/theme-init-script"

const LIGHT = "#eeeeec"
/** `#eeeeec` under `rgba(0, 0, 0, 0.4)`, as `drawer-chrome-tint.test.ts` works out */
const DIMMED = "#8f8f8e"

function seedMeta() {
  const meta = document.createElement("meta")
  meta.id = THEME_COLOR_META_ID
  meta.name = "theme-color"
  meta.content = LIGHT
  document.head.appendChild(meta)
}

function Sheet({
  open,
  scrim = true,
}: {
  open: boolean
  scrim?: boolean
}) {
  return (
    <Drawer open={open} onOpenChange={() => {}}>
      <Drawer.Portal>
        {scrim ? (
          <Drawer.Overlay
            style={{ backgroundColor: "rgba(0, 0, 0, 0.4)" }}
          />
        ) : null}
        <Drawer.Content>sheet</Drawer.Content>
      </Drawer.Portal>
    </Drawer>
  )
}

/** Let the engine's double-rAF open (and its measuring retries) run. */
async function frames(n = 12) {
  for (let i = 0; i < n; i += 1) {
    await act(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        ),
    )
  }
}

beforeEach(() => {
  //reduced motion lands every chrome transition at once, so no clock is needed
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        onchange: null,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
  //happy-dom lays nothing out, and the engine does not start its open motion on a
  //sheet with no height
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 390, height: 400 }),
  )
  seedMeta()
  setThemeColorBase(LIGHT)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  setThemeColorBase(null)
  document.getElementById(THEME_COLOR_META_ID)?.remove()
})

describe("Drawer — the browser chrome when a drawer goes away", () => {
  it("hands the chrome back when the drawer unmounts while open", async () => {
    const view = render(<Sheet open />)
    await frames()
    //the precondition: without the dim there is nothing for the unmount to undo
    expect(getChromeTint()).toBe(DIMMED)

    //what a browser Back does to a page with a drawer open on it
    view.unmount()

    expect(getChromeTint()).toBe(LIGHT)
  })

  it("leaves another open drawer's dim alone when a closed drawer unmounts", async () => {
    //a never-opened drawer renders nothing, so this pins the gates' combined result,
    //not either gate alone
    function Two({ second }: { second: boolean }) {
      return (
        <>
          <Sheet open />
          {second ? <Sheet open={false} /> : null}
        </>
      )
    }
    const view = render(<Two second />)
    await frames()
    expect(getChromeTint()).toBe(DIMMED)

    view.rerender(<Two second={false} />)
    await frames(2)

    expect(getChromeTint()).toBe(DIMMED)
  })

  it("leaves another drawer's dim alone when an open drawer with no backdrop unmounts", async () => {
    //a sheet without an overlay never dims the chrome, so it has nothing to give back
    function Two({ second }: { second: boolean }) {
      return (
        <>
          <Sheet open />
          {second ? <Sheet open scrim={false} /> : null}
        </>
      )
    }
    const view = render(<Two second />)
    await frames()
    expect(getChromeTint()).toBe(DIMMED)

    view.rerender(<Two second={false} />)
    await frames(2)

    expect(getChromeTint()).toBe(DIMMED)
  })
})
