import { act, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { kv } from "#nativ/storage/kv"
import { useKv } from "#nativ/storage/use-kv"

beforeEach(() => {
  kv.clear()
})

function Probe({ fallback = "none" }: { fallback?: string }) {
  const [value, setValue] = useKv("greeting", fallback)
  return (
    <button type="button" onClick={() => setValue("set")}>
      {value}
    </button>
  )
}

describe("useKv", () => {
  it("renders the fallback when nothing is stored", () => {
    render(<Probe />)
    expect(screen.getByRole("button").textContent).toBe("none")
  })

  it("renders a stored value synchronously on first paint", () => {
    //no loading state, no flash of the fallback — this is the whole reason the kv
    //tier is synchronous
    kv.set("greeting", "hello")
    render(<Probe />)
    expect(screen.getByRole("button").textContent).toBe("hello")
  })

  it("re-renders when the value changes elsewhere", () => {
    render(<Probe />)
    act(() => kv.set("greeting", "external"))
    expect(screen.getByRole("button").textContent).toBe("external")
  })

  it("writes through the returned setter", () => {
    render(<Probe />)
    act(() => {
      screen.getByRole("button").click()
    })
    expect(kv.get("greeting")).toBe("set")
    expect(screen.getByRole("button").textContent).toBe("set")
  })

  it("falls back again after the key is removed", () => {
    kv.set("greeting", "hello")
    render(<Probe />)
    act(() => kv.remove("greeting"))
    expect(screen.getByRole("button").textContent).toBe("none")
  })

  it("does not loop on an object fallback", () => {
    //useSyncExternalStore re-renders forever if getSnapshot returns a new value
    //each call. An object literal default is the classic trigger, which is why
    //the fallback is applied OUTSIDE the snapshot.
    function ObjectProbe() {
      const [value] = useKv("config", { a: 1 })
      return <span>{JSON.stringify(value)}</span>
    }
    expect(() => render(<ObjectProbe />)).not.toThrow()
    expect(screen.getByText('{"a":1}')).toBeTruthy()
  })
})
