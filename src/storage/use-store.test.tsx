import "fake-indexeddb/auto"
import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { store } from "#adaptv/storage/store"
import { useStore } from "#adaptv/storage/use-store"

beforeEach(async () => {
  await store.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function Probe({ storeKey = "doc", label = "probe" }) {
  const { data, isLoading, set } = useStore<string>(storeKey)
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => void set(`written-${storeKey}`)}
    >
      {isLoading ? "loading" : (data ?? "empty")}
    </button>
  )
}

const text = (label = "probe") =>
  screen.getByRole("button", { name: label }).textContent

/** A `store.get` whose answer the test releases, one call at a time, by key. */
function holdReads() {
  const pending = new Map<string, (value: unknown) => void>()
  vi.spyOn(store, "get").mockImplementation(
    (key: string) =>
      new Promise((resolve) => {
        pending.set(key, resolve as (value: unknown) => void)
      }),
  )
  return (key: string, value: unknown) => {
    const resolve = pending.get(key)
    if (!resolve) throw new Error(`no read pending for ${key}`)
    pending.delete(key)
    return act(async () => resolve(value))
  }
}

describe("useStore", () => {
  it("says it is loading until the read settles, then shows the value", async () => {
    //the store is genuinely async, so a first frame that pretended to know the
    //value would have to lie with a default
    await store.set("doc", "stored")
    render(<Probe />)
    expect(text()).toBe("loading")
    await waitFor(() => expect(text()).toBe("stored"))
  })

  it("settles to no data for an absent key", async () => {
    render(<Probe />)
    await waitFor(() => expect(text()).toBe("empty"))
  })

  it("writes through the returned setter and shows the new value", async () => {
    render(<Probe />)
    await waitFor(() => expect(text()).toBe("empty"))
    await act(async () => screen.getByRole("button").click())
    await waitFor(() => expect(text()).toBe("written-doc"))
    expect(await store.get("doc")).toBe("written-doc")
  })

  it("re-renders every component watching the key when one of them writes", async () => {
    //the same-process reactivity useKv has: two views of one document must not
    //disagree after either of them saves
    render(
      <>
        <Probe label="a" />
        <Probe label="b" />
      </>,
    )
    await waitFor(() => expect(text("b")).toBe("empty"))
    await act(async () =>
      screen.getByRole("button", { name: "a" }).click(),
    )
    await waitFor(() => expect(text("b")).toBe("written-doc"))
  })

  it("re-renders when the key is written, removed or cleared outside React", async () => {
    render(<Probe />)
    await waitFor(() => expect(text()).toBe("empty"))
    await act(() => store.set("doc", "external"))
    await waitFor(() => expect(text()).toBe("external"))
    await act(() => store.remove("doc"))
    await waitFor(() => expect(text()).toBe("empty"))
    await act(() => store.set("doc", "again"))
    await waitFor(() => expect(text()).toBe("again"))
    await act(() => store.clear())
    await waitFor(() => expect(text()).toBe("empty"))
  })

  it("does not let the mount's read overwrite a write that landed before it settled", async () => {
    //the first read goes to the database and the re-read after a write is
    //answered from memory, so the older read can settle LAST
    await store.set("doc", "old")
    render(<Probe />)
    await act(() => store.set("doc", "new"))
    //a read queued now settles after every read queued before it, the mount's
    //included — so by then the stale answer has had its chance to land
    await act(() => store.keys())
    expect(text()).toBe("new")
  })

  it("ignores a read for the previous key that settles after the key changed", async () => {
    //otherwise the OLD key's value lands under the new key — random data
    //appearing under the wrong name
    const release = holdReads()
    const { rerender } = render(<Probe storeKey="first" />)
    rerender(<Probe storeKey="second" />)

    await release("second", "second-value")
    await release("first", "first-value")
    expect(text()).toBe("second-value")
  })

  it("stops listening once unmounted", async () => {
    const { unmount } = render(<Probe />)
    await waitFor(() => expect(text()).toBe("empty"))
    unmount()

    const get = vi.spyOn(store, "get")
    await store.set("doc", "after-unmount")
    //a listener left behind would re-read on every write for the life of the
    //page, once per component that ever mounted
    expect(get).not.toHaveBeenCalled()
  })
})
