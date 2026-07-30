import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ScrollView } from "#adaptv/components/scroll-view"

function scrollNode(container: HTMLElement): HTMLElement {
  const node = container.querySelector("[data-scroll-view]")
  expect(node, "scroll node not found").not.toBeNull()
  return node as HTMLElement
}

describe("ScrollView — behaviour is a prop, not a className (L6)", () => {
  //The scroll axis is owned by the `horizontal` / `scrollEnabled` PROPS. A
  //consumer className must not be able to silently defeat them: that is the exact
  //guarantee `mergeStyles`' `locked` layer exists to provide, and without it the
  //component's whole contract is advisory.
  //
  //This is not hypothetical — `overflow-hidden` on a scroller is a very common
  //thing to reach for, and the failure is invisible until someone can't scroll.
  it("keeps the scroll utility when a className fights it", () => {
    const { container } = render(
      <ScrollView className="overflow-hidden">content</ScrollView>,
    )
    expect(scrollNode(container).className).toContain("overflow-y-auto")
  })

  it("keeps the horizontal utility too", () => {
    const { container } = render(
      <ScrollView horizontal className="overflow-hidden">
        content
      </ScrollView>,
    )
    expect(scrollNode(container).className).toContain("overflow-x-auto")
  })

  it("honours scrollEnabled={false} over a scroll className", () => {
    //the inverse direction: a consumer cannot force scrolling back on either
    const { container } = render(
      <ScrollView scrollEnabled={false} className="overflow-y-auto">
        content
      </ScrollView>,
    )
    expect(scrollNode(container).className).toContain("overflow-hidden")
  })

  it("applies the same guarantee with fades on", () => {
    //fades used to render a SECOND branch with a duplicated class list, so a fix
    //applied to one and not the other looked correct in the common case only.
    //There is one node now, and this is the test that keeps it that way.
    const { container } = render(
      <ScrollView fade className="overflow-hidden">
        content
      </ScrollView>,
    )
    expect(scrollNode(container).className).toContain("overflow-y-auto")
  })

  it("marks which ends fade, and nothing when they do not", () => {
    const both = render(<ScrollView fade>content</ScrollView>)
    expect(scrollNode(both.container).dataset.fade).toBe("both")

    const one = render(<ScrollView fade="end">content</ScrollView>)
    expect(scrollNode(one.container).dataset.fade).toBe("end")

    const none = render(<ScrollView>content</ScrollView>)
    expect(scrollNode(none.container).hasAttribute("data-fade")).toBe(
      false,
    )
  })

  it("takes the fade depth as a prop, as an inline custom property", () => {
    const { container } = render(
      <ScrollView fade fadeSize="3rem">
        content
      </ScrollView>,
    )
    expect(
      scrollNode(container).style.getPropertyValue("--fade-length"),
    ).toBe("3rem")
  })

  it("sets nothing when the depth is left to CSS", () => {
    //otherwise the prop would beat `edge-fade-*` even for callers who never used it
    const { container } = render(<ScrollView fade>content</ScrollView>)
    expect(
      scrollNode(container).style.getPropertyValue("--fade-length"),
    ).toBe("")
  })

  it("keeps a consumer's own style alongside the depth", () => {
    //the prop writes into the same channel a consumer `style` uses, so the naive
    //spread order drops theirs entirely
    const { container } = render(
      <ScrollView fade fadeSize="3rem" style={{ background: "red" }}>
        content
      </ScrollView>,
    )
    const node = scrollNode(container)
    expect(node.style.getPropertyValue("--fade-length")).toBe("3rem")
    expect(node.style.background).toBe("red")
  })

  it("lets a hand-written --fade-length beat the prop", () => {
    //someone who wrote the variable themselves was more specific than someone who
    //passed a prop, and this is the escape hatch when the prop is in the way
    const { container } = render(
      <ScrollView
        fade
        fadeSize="3rem"
        style={{ "--fade-length": "9rem" } as React.CSSProperties}
      >
        content
      </ScrollView>,
    )
    expect(
      scrollNode(container).style.getPropertyValue("--fade-length"),
    ).toBe("9rem")
  })

  it("renders no wrapper for fades — the mask is on the scroller itself", () => {
    //the old implementation wrapped the scroller in a relative box and laid two
    //absolutely-positioned bands over it. That wrapper changed the layout of
    //everything around it, which is why `fill` had to be applied in two places.
    const { container } = render(<ScrollView fade>content</ScrollView>)
    expect(container.firstElementChild).toBe(scrollNode(container))
  })

  it("still lets a consumer style everything that is NOT structural", () => {
    //locking must stay narrow — if it swallowed ordinary styling the component
    //would be unusable
    const { container } = render(
      <ScrollView className="bg-red-500 px-4">content</ScrollView>,
    )
    const className = scrollNode(container).className
    expect(className).toContain("bg-red-500")
    expect(className).toContain("px-4")
  })
})
