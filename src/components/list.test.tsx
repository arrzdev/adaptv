import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { List } from "#adaptv/components/list"

// happy-dom has no layout, so the real virtualizer would window 0 rows. Mock it to a
// fixed 2-row window; the actual windowing is verified on-device (see the QA doc).
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [
      { index: 0, key: 0, start: 0, size: 56 },
      { index: 1, key: 1, start: 56, size: 56 },
    ],
    getTotalSize: () => 112,
    measureElement: () => {},
  }),
}))

type Row = { id: string; label: string }
const DATA: Row[] = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Bravo" },
]

afterEach(() => {
  cleanup()
})

describe("List", () => {
  it("renders the windowed rows via renderItem", () => {
    const { getByText } = render(
      <List
        data={DATA}
        keyExtractor={(r) => r.id}
        renderItem={(r) => <span>{r.label}</span>}
      />,
    )
    expect(getByText("Alpha")).toBeTruthy()
    expect(getByText("Bravo")).toBeTruthy()
  })

  it("renders the empty state for empty data", () => {
    const { getByText, queryByText } = render(
      <List
        data={[] as Row[]}
        keyExtractor={(r) => r.id}
        renderItem={(r) => <span>{r.label}</span>}
        emptyState={<div>Nothing here</div>}
      />,
    )
    expect(getByText("Nothing here")).toBeTruthy()
    expect(queryByText("Alpha")).toBeNull()
  })

  it("keys rows via keyExtractor", () => {
    const keyExtractor = vi.fn((r: Row) => r.id)
    render(
      <List
        data={DATA}
        keyExtractor={keyExtractor}
        renderItem={(r) => <span>{r.label}</span>}
      />,
    )
    expect(keyExtractor).toHaveBeenCalledWith(DATA[0], 0)
    expect(keyExtractor).toHaveBeenCalledWith(DATA[1], 1)
  })

  it("fires onEndReached when the last row is windowed", () => {
    const onEndReached = vi.fn()
    render(
      <List
        data={DATA}
        keyExtractor={(r) => r.id}
        renderItem={(r) => <span>{r.label}</span>}
        onEndReached={onEndReached}
      />,
    )
    expect(onEndReached).toHaveBeenCalled()
  })
})

describe("List · onEndReached", () => {
  //`onEndReached` fires once the last row enters the window — once per
  //arrival, not once per render. An app that passes an inline callback
  //re-renders on every state change; a list parked at its end must not turn
  //each of those renders into another page request

  const row = (r: Row) => <span>{r.label}</span>
  const key = (r: Row) => r.id

  it("fires once per arrival at the end, not again for a re-render with a new callback", () => {
    const calls: number[] = []
    const ONE = DATA.slice(0, 1)
    const view = render(
      <List
        data={ONE}
        keyExtractor={key}
        renderItem={row}
        onEndReached={() => calls.push(ONE.length)}
      />,
    )
    expect(calls).toEqual([1])
    //the same end, a fresh callback identity: the app re-rendered, the list did not move
    view.rerender(
      <List
        data={ONE}
        keyExtractor={key}
        renderItem={row}
        onEndReached={() => calls.push(ONE.length)}
      />,
    )
    expect(calls).toEqual([1])
  })

  it("a callback that arrives after the end was reached fires for that end", () => {
    //`onEndReached={loading ? undefined : loadMore}`: the end was reached
    //while a page was loading, and the callback the app hands over once it
    //is done is owed that arrival
    const calls: number[] = []
    const ONE = DATA.slice(0, 1)
    const view = render(
      <List data={ONE} keyExtractor={key} renderItem={row} />,
    )
    expect(calls).toEqual([])
    view.rerender(
      <List
        data={ONE}
        keyExtractor={key}
        renderItem={row}
        onEndReached={() => calls.push(ONE.length)}
      />,
    )
    expect(calls).toEqual([1])
    //and it is one arrival: the next render with a fresh callback is not another
    view.rerender(
      <List
        data={ONE}
        keyExtractor={key}
        renderItem={row}
        onEndReached={() => calls.push(ONE.length)}
      />,
    )
    expect(calls).toEqual([1])
  })

  it("fires again when rows are appended and the new end is windowed", () => {
    const calls: number[] = []
    const ONE = DATA.slice(0, 1)
    const view = render(
      <List
        data={ONE}
        keyExtractor={key}
        renderItem={row}
        onEndReached={() => calls.push(ONE.length)}
      />,
    )
    expect(calls).toEqual([1])
    //the page arrived: two rows, and the mocked window shows both — the new end
    view.rerender(
      <List
        data={DATA}
        keyExtractor={key}
        renderItem={row}
        onEndReached={() => calls.push(DATA.length)}
      />,
    )
    expect(calls).toEqual([1, 2])
  })
})

describe("List on an engine without Array.prototype.at (iOS 15.0–15.3)", () => {
  let at: PropertyDescriptor | undefined

  beforeEach(() => {
    at = Object.getOwnPropertyDescriptor(Array.prototype, "at")
    Reflect.deleteProperty(Array.prototype, "at")
  })

  afterEach(() => {
    if (at) Object.defineProperty(Array.prototype, "at", at)
  })

  it("renders its rows and still finds the last windowed one", () => {
    expect(Array.prototype.at).toBeUndefined()
    const onEndReached = vi.fn()
    const { getByText } = render(
      <List
        data={DATA}
        keyExtractor={(r) => r.id}
        renderItem={(r) => <span>{r.label}</span>}
        onEndReached={onEndReached}
      />,
    )
    expect(getByText("Bravo")).toBeTruthy()
    expect(onEndReached).toHaveBeenCalled()
  })
})
