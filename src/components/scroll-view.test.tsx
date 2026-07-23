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
    expect(scrollNode(container).className).toContain("scrollable-y")
  })

  it("keeps the horizontal utility too", () => {
    const { container } = render(
      <ScrollView horizontal className="overflow-hidden">
        content
      </ScrollView>,
    )
    expect(scrollNode(container).className).toContain("scrollable-x")
  })

  it("honours scrollEnabled={false} over a scroll className", () => {
    //the inverse direction: a consumer cannot force scrolling back on either
    const { container } = render(
      <ScrollView scrollEnabled={false} className="scrollable-y">
        content
      </ScrollView>,
    )
    expect(scrollNode(container).className).toContain("overflow-hidden")
  })

  it("applies the same guarantee on the edge-fade branch", () => {
    //the class list was duplicated across both render branches, so a fix applied
    //to one and not the other would look correct in the common case only
    const { container } = render(
      <ScrollView edgeFades className="overflow-hidden">
        content
      </ScrollView>,
    )
    expect(scrollNode(container).className).toContain("scrollable-y")
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
