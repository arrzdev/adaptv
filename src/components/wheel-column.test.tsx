import { act, fireEvent, render, screen } from "@testing-library/react"
import { Profiler, useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WheelItem } from "#adaptv/components/wheel-column"
import {
  WHEEL_ITEM_HEIGHT,
  WheelColumn,
} from "#adaptv/components/wheel-column"
import { wheelRowTransform } from "#adaptv/components/wheel-column-geometry"

/*
 * WheelColumn's scroll pipeline — what a consumer's `onChange` receives for a given
 * scroll, when the wheel rolls itself onto a row, and when it keeps its hands off.
 *
 * The geometry (snap index, drum projection) is pure and pinned in
 * wheel-column-geometry.test.ts; this file pins the component that drives it. The
 * engine is played by hand: happy-dom neither scrolls nor fires `scroll`, so each step
 * writes `scrollTop` and dispatches the event the browser would, which is exactly the
 * pair React's `onScroll` reads. What that CANNOT show — momentum, the real smooth
 * roll converging, a mouse wheel or a finger producing those events at all — is
 * playground/e2e/wheel-column.spec.ts on a real engine.
 */

const H = WHEEL_ITEM_HEIGHT // 30

const pad = (n: number) => String(n).padStart(2, "0")
const range = (from: number, to: number): WheelItem[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    value: from + i,
    label: pad(from + i),
  }))
const HOURS = range(0, 23)

let scrollToSpy: { mock: { calls: unknown[][] } }

beforeEach(() => {
  vi.useFakeTimers()
  //pass-through spy: the element still moves, the test sees how it was asked to
  scrollToSpy = vi.spyOn(Element.prototype, "scrollTo")
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** The consumer every real call site is: it stores what the wheel reports and hands it back. */
function Controlled({
  initial,
  items = HOURS,
  onChange,
}: {
  initial: number
  items?: WheelItem[]
  onChange: (value: number) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <WheelColumn
      items={items}
      value={value}
      onChange={(next) => {
        onChange(next)
        setValue(next)
      }}
      ariaLabel="Hour"
    />
  )
}

function wheel(): HTMLFieldSetElement {
  return screen.getByRole("group", { name: "Hour" }) as HTMLFieldSetElement
}

const activeRows = () =>
  [...wheel().querySelectorAll('button[data-active="true"]')].map(
    (row) => row.textContent,
  )

/** What the engine does on every scroll frame: move the box, then fire `scroll`. */
function scrollWheel(top: number) {
  act(() => {
    wheel().scrollTop = top
    fireEvent.scroll(wheel())
  })
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

/** Every `scrollTo` the wheel issued, as the options it passed. */
const scrollRequests = () =>
  scrollToSpy.mock.calls.map(([options]) => options as ScrollToOptions)

/** The smooth rolls the wheel asked for, as the `top` each one aims at. */
const smoothRolls = () =>
  scrollRequests()
    .filter((options) => options.behavior === "smooth")
    .map((options) => options.top)

/** The instant jumps (no `behavior`) — how it aligns to a value set from outside. */
const jumps = () =>
  scrollRequests()
    .filter((options) => options.behavior === undefined)
    .map((options) => options.top)

/** The drum transform sits on the row's slot (`<li>`), the box the projection moves. */
const rowTransform = (label: string) =>
  (
    screen.getByRole("button", { name: label })
      .parentElement as HTMLElement
  ).style.transform

describe("WheelColumn — mount", () => {
  it("opens centred on the value it is given, without reporting a change", () => {
    const onChange = vi.fn()
    render(<Controlled initial={9} onChange={onChange} />)
    expect(wheel().scrollTop).toBe(9 * H)
    expect(activeRows()).toEqual(["09"])
    advance(500)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("centres the first row when the value is not in the list", () => {
    render(<Controlled initial={99} onChange={() => {}} />)
    expect(wheel().scrollTop).toBe(0)
    expect(activeRows()).toEqual(["00"])
  })
})

describe("WheelColumn — what onChange receives for a scroll", () => {
  it("reports the centred row live, once per row crossed, without waiting for rest", () => {
    const onChange = vi.fn()
    render(<Controlled initial={9} onChange={onChange} />)

    scrollWheel(9 * H + 14) // still nearer 09
    expect(onChange).not.toHaveBeenCalled()

    scrollWheel(9 * H + 15) // the halfway mark belongs to the next row
    expect(onChange.mock.calls).toEqual([[10]])
    expect(activeRows()).toEqual(["10"])

    scrollWheel(10 * H) // same row again: nothing new to say
    scrollWheel(11 * H + 2)
    expect(onChange.mock.calls).toEqual([[10], [11]])
    expect(activeRows()).toEqual(["11"])
  })

  it("clamps a scroll past either end to the first or last row", () => {
    const onChange = vi.fn()
    render(<Controlled initial={9} onChange={onChange} />)
    scrollWheel(5000)
    expect(onChange).toHaveBeenLastCalledWith(23)
    expect(activeRows()).toEqual(["23"])

    scrollWheel(-40)
    expect(onChange).toHaveBeenLastCalledWith(0)
    expect(activeRows()).toEqual(["00"])
  })

  it("reports nothing from an empty list", () => {
    const onChange = vi.fn()
    render(
      <WheelColumn
        items={[]}
        value={0}
        onChange={onChange}
        ariaLabel="Hour"
      />,
    )
    scrollWheel(120)
    advance(500)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("re-reports a row the consumer did not store — the wheel is the source of truth mid-gesture", () => {
    //a consumer that ignores onChange keeps `value` at 9; every frame over row 10 is
    //still row 10, and the settle says so once more
    const onChange = vi.fn()
    render(
      <WheelColumn
        items={HOURS}
        value={9}
        onChange={onChange}
        ariaLabel="Hour"
      />,
    )
    scrollWheel(10 * H)
    scrollWheel(10 * H + 3)
    advance(120)
    expect(onChange.mock.calls).toEqual([[10], [10], [10]])
  })

  it("keeps re-reporting a row the consumer did not store on every frame, not only the first two", () => {
    //from the second frame on the wheel's own centred row no longer changes, so
    //nothing else re-renders it between frames
    const onChange = vi.fn()
    render(
      <WheelColumn
        items={HOURS}
        value={9}
        onChange={onChange}
        ariaLabel="Hour"
      />,
    )
    for (const top of [10 * H, 10 * H + 3, 10 * H + 5, 10 * H + 7]) {
      scrollWheel(top)
    }
    expect(onChange.mock.calls).toEqual([[10], [10], [10], [10]])
  })

  it("re-reports a row the consumer did not store to a scroll event that lands before the wheel's passive effects", () => {
    //the next frame's scroll event fired from the commit itself, after the layout
    //effects and before the passive ones: the earliest an engine can deliver it
    const onChange = vi.fn()
    let next: number | null = null
    render(
      <Profiler
        id="wheel"
        onRender={() => {
          if (next === null) return
          const top = next
          next = null
          wheel().scrollTop = top
          fireEvent.scroll(wheel())
        }}
      >
        <WheelColumn
          items={HOURS}
          value={9}
          onChange={onChange}
          ariaLabel="Hour"
        />
      </Profiler>,
    )
    act(() => {
      next = 10 * H + 3
      wheel().scrollTop = 10 * H
      fireEvent.scroll(wheel())
    })
    expect(next).toBeNull()
    expect(onChange.mock.calls).toEqual([[10], [10]])
  })

  it("reports a row the consumer stored only once, when the last scroll event is the one that crossed it", () => {
    //the settle's timer is armed by the scroll that reported the row, BEFORE the
    //consumer's re-render hands the row back as `value`
    const onChange = vi.fn()
    render(<Controlled initial={9} onChange={onChange} />)

    //a rest exactly on the row: the settle has nothing to roll and nothing to say
    scrollWheel(10 * H)
    advance(120)
    expect(onChange.mock.calls).toEqual([[10]])

    //a rest past the halfway mark: the settle rolls onto the row it already reported
    scrollWheel(10 * H + 14) // still row 10
    scrollWheel(10 * H + 16) // crosses into 11, and nothing scrolls after it
    advance(120)
    expect(smoothRolls().at(-1)).toBe(11 * H)
    expect(onChange.mock.calls).toEqual([[10], [11]])
  })

  it("reports a row the consumer stored only once when a finger lifts on the scroll that crossed it", () => {
    const onChange = vi.fn()
    render(<Controlled initial={9} onChange={onChange} />)

    //the lift after the consumer's re-render has landed
    fireEvent.touchStart(wheel())
    scrollWheel(10 * H + 16) // crosses into 11 under the finger
    fireEvent.touchEnd(wheel())
    advance(120)
    expect(onChange.mock.calls).toEqual([[11]])

    //the lift in the same frame as that scroll, before the re-render: a touchend
    //the engine delivers ahead of React's continuous-priority render
    fireEvent.touchStart(wheel())
    act(() => {
      wheel().scrollTop = 12 * H + 16 // crosses into 13
      fireEvent.scroll(wheel())
      fireEvent.touchEnd(wheel())
    })
    advance(120)
    expect(onChange.mock.calls).toEqual([[11], [13]])
  })

  it("reports a row the consumer stores only once when two scroll events cross it before the consumer re-renders", () => {
    //both events land ahead of React's continuous-priority render, so the second one
    //still reads the `value` from before the consumer stored the first report
    const onChange = vi.fn()
    render(<Controlled initial={9} onChange={onChange} />)
    act(() => {
      wheel().scrollTop = 10 * H // crosses into 10
      fireEvent.scroll(wheel())
      wheel().scrollTop = 10 * H + 3 // still 10
      fireEvent.scroll(wheel())
    })
    advance(120)
    expect(onChange.mock.calls).toEqual([[10]])
  })

  it("reports a row the consumer set from outside mid-glide only once, when the wheel rests on it", () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <WheelColumn
        items={HOURS}
        value={9}
        onChange={onChange}
        ariaLabel="Hour"
      />,
    )
    scrollWheel(12 * H)
    //the consumer lands on the same row by its own route before the settle
    rerender(
      <WheelColumn
        items={HOURS}
        value={12}
        onChange={onChange}
        ariaLabel="Hour"
      />,
    )
    advance(120)
    expect(onChange.mock.calls).toEqual([[12]])
  })

  it("never reports a row that left the list while the wheel settled", () => {
    //a day column over 31 while the month turns to February: the list shrinks to 28
    //and the consumer clamps the day, all before the settle runs
    const onChange = vi.fn()
    let shrink = () => {}
    function Days() {
      const [value, setValue] = useState(15)
      const [count, setCount] = useState(31)
      shrink = () => {
        setCount(28)
        setValue((day) => Math.min(day, 28))
      }
      return (
        <WheelColumn
          items={range(1, count)}
          value={value}
          onChange={(next) => {
            onChange(next)
            setValue(next)
          }}
          ariaLabel="Hour"
        />
      )
    }
    render(<Days />)
    scrollWheel(30 * H) // row 31
    act(() => shrink())
    advance(120)
    expect(onChange.mock.calls).toEqual([[31]])
    //the settle rolls onto the last row that still exists
    expect(smoothRolls().at(-1)).toBe(27 * H)
  })

  it("settles through the consumer's latest onChange, so a day column never sets back a month that changed mid-glide", () => {
    //a date picker whose day column writes the month from its own render, and which
    //starts a new month on its 1st; the day wheel is still gliding when the month turns
    const dates = vi.fn()
    let turnMonth = (_month: number) => {}
    function DatePicker() {
      const [date, setDate] = useState({ month: 1, day: 9 })
      turnMonth = (month) => setDate({ month, day: 1 })
      const count = date.month === 2 ? 28 : 31
      return (
        <WheelColumn
          items={range(1, count)}
          value={date.day}
          onChange={(day) => {
            dates(`${date.month}/${day}`)
            setDate({ month: date.month, day })
          }}
          ariaLabel="Hour"
        />
      )
    }
    render(<DatePicker />)
    scrollWheel(11 * H) // day 12
    act(() => turnMonth(2))
    advance(120)
    //the gesture wins over the reset to the 1st, and it lands in February
    expect(dates.mock.calls).toEqual([["1/12"], ["2/12"]])
  })

  it("settles through the consumer's latest onChange even when neither the value nor the list changed", () => {
    //a booking picker that refuses a day its month has blocked: the 12th is taken in
    //January, not in March, and both months share one list
    const dates = vi.fn()
    let turnMonth = (_month: number) => {}
    const days = range(1, 31)
    function BookingPicker() {
      const [month, setMonth] = useState(1)
      const [day, setDay] = useState(9)
      turnMonth = setMonth
      return (
        <WheelColumn
          items={days}
          value={day}
          onChange={(next) => {
            dates(`${month}/${next}`)
            if (!(month === 1 && next === 12)) setDay(next)
          }}
          ariaLabel="Hour"
        />
      )
    }
    render(<BookingPicker />)
    scrollWheel(11 * H) // the 12th, refused in January
    act(() => turnMonth(3))
    advance(120)
    expect(dates.mock.calls).toEqual([["1/12"], ["3/12"]])
  })
})

describe("WheelColumn — the settle snap", () => {
  it("rolls onto the nearest whole row once scrolling has been idle for 120ms", () => {
    const onChange = vi.fn()
    render(<Controlled initial={9} onChange={onChange} />)
    scrollWheel(9 * H + 14)

    advance(119)
    expect(smoothRolls()).toEqual([])
    advance(1)
    expect(smoothRolls()).toEqual([9 * H])
    expect(activeRows()).toEqual(["09"])
    //the rest is the row the drum already showed — no second report
    expect(onChange).not.toHaveBeenCalled()
  })

  it("does not roll when the rest is already within a pixel of a row", () => {
    render(<Controlled initial={9} onChange={() => {}} />)
    scrollWheel(10 * H + 1)
    advance(500)
    expect(smoothRolls()).toEqual([])
  })

  it("restarts the wait on every scroll event, so a coasting glide is never snapped mid-flight", () => {
    render(<Controlled initial={9} onChange={() => {}} />)
    scrollWheel(9 * H + 14)
    advance(100)
    scrollWheel(10 * H + 14)
    advance(100)
    expect(smoothRolls()).toEqual([])
    advance(20)
    expect(smoothRolls()).toEqual([10 * H])
  })

  it("leaves the wheel free while a finger is down, and settles 120ms after it lifts", () => {
    const onChange = vi.fn()
    render(<Controlled initial={9} onChange={onChange} />)
    fireEvent.touchStart(wheel())
    scrollWheel(10 * H + 14)
    //the value still tracks the finger live
    expect(onChange.mock.calls).toEqual([[10]])
    advance(2000)
    expect(smoothRolls()).toEqual([])

    fireEvent.touchEnd(wheel())
    advance(119)
    expect(smoothRolls()).toEqual([])
    advance(1)
    expect(smoothRolls()).toEqual([10 * H])
  })

  it("a second finger lifting does not settle the wheel from under the first", () => {
    //a thumb steadying the phone lands and lifts while the spinning finger is
    //still down: a touchend that leaves a finger on the wheel is not the lift
    render(<Controlled initial={9} onChange={() => {}} />)
    const one = [{ identifier: 0 }]
    fireEvent.touchStart(wheel(), { touches: one, changedTouches: one })
    scrollWheel(10 * H + 14)
    const two = [{ identifier: 0 }, { identifier: 1 }]
    fireEvent.touchStart(wheel(), {
      touches: two,
      changedTouches: [{ identifier: 1 }],
    })
    fireEvent.touchEnd(wheel(), {
      touches: one,
      changedTouches: [{ identifier: 1 }],
    })
    advance(2000)
    expect(smoothRolls()).toEqual([])

    fireEvent.touchEnd(wheel(), { touches: [], changedTouches: one })
    advance(120)
    expect(smoothRolls()).toEqual([10 * H])
  })

  it("the spinning finger's lift settles the wheel while a thumb rests elsewhere on the screen", () => {
    //the thumb never touched the wheel, so its touchstart never reached it,
    //but `touches` lists every point on the whole surface: the wheel's own
    //finger lifting with the thumb still down IS the lift
    render(<Controlled initial={9} onChange={() => {}} />)
    const one = [{ identifier: 0 }]
    fireEvent.touchStart(wheel(), { touches: one, changedTouches: one })
    scrollWheel(10 * H + 14)
    fireEvent.touchEnd(wheel(), {
      touches: [{ identifier: 1 }],
      changedTouches: one,
    })
    advance(120)
    expect(smoothRolls()).toEqual([10 * H])
  })

  it("a cancel naming only the thumb does not settle the wheel; one naming the spinning finger does", () => {
    render(<Controlled initial={9} onChange={() => {}} />)
    const one = [{ identifier: 0 }]
    fireEvent.touchStart(wheel(), { touches: one, changedTouches: one })
    scrollWheel(10 * H + 14)
    fireEvent.touchStart(wheel(), {
      touches: [{ identifier: 0 }, { identifier: 1 }],
      changedTouches: [{ identifier: 1 }],
    })
    fireEvent.touchCancel(wheel(), {
      touches: one,
      changedTouches: [{ identifier: 1 }],
    })
    advance(2000)
    expect(smoothRolls()).toEqual([])

    fireEvent.touchCancel(wheel(), { touches: [], changedTouches: one })
    advance(120)
    expect(smoothRolls()).toEqual([10 * H])
  })

  it("settles a cancelled touch the same as a lift", () => {
    render(<Controlled initial={9} onChange={() => {}} />)
    fireEvent.touchStart(wheel())
    scrollWheel(10 * H + 14)
    fireEvent.touchCancel(wheel())
    advance(120)
    expect(smoothRolls()).toEqual([10 * H])
  })

  it("leaves nothing scheduled when it unmounts mid-spin", () => {
    //mid-spin there is a paint loop and a pending settle; a picker closed while it
    //coasts (a drawer dismissed, a route left) must take both with it
    const { unmount } = render(
      <Controlled initial={9} onChange={() => {}} />,
    )
    scrollWheel(10 * H + 14)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("WheelColumn — an external value", () => {
  it("jumps an idle wheel straight to a value the consumer sets, without echoing it back", () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <WheelColumn
        items={HOURS}
        value={9}
        onChange={onChange}
        ariaLabel="Hour"
      />,
    )
    rerender(
      <WheelColumn
        items={HOURS}
        value={3}
        onChange={onChange}
        ariaLabel="Hour"
      />,
    )
    expect(jumps().at(-1)).toBe(3 * H)
    expect(wheel().scrollTop).toBe(3 * H)
    expect(activeRows()).toEqual(["03"])
    advance(500)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("follows a day clamped by a shorter month (31 → 28)", () => {
    const { rerender } = render(
      <WheelColumn
        items={range(1, 31)}
        value={31}
        onChange={() => {}}
        ariaLabel="Hour"
      />,
    )
    expect(wheel().scrollTop).toBe(30 * H)
    rerender(
      <WheelColumn
        items={range(1, 28)}
        value={28}
        onChange={() => {}}
        ariaLabel="Hour"
      />,
    )
    expect(wheel().querySelectorAll("button")).toHaveLength(28)
    expect(wheel().scrollTop).toBe(27 * H)
    expect(activeRows()).toEqual(["28"])
  })

  it("never yanks an in-flight glide when the consumer echoes the live value back", () => {
    render(<Controlled initial={9} onChange={() => {}} />)
    const before = jumps().length
    //row 10 is reported, the consumer stores it, `value` becomes 10 — and the drum,
    //still 14px short of that row, must stay under the finger
    scrollWheel(10 * H - 14)
    expect(jumps()).toHaveLength(before)
    expect(wheel().scrollTop).toBe(10 * H - 14)
  })

  it("lets the gesture win over a value set mid-glide", () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <WheelColumn
        items={HOURS}
        value={9}
        onChange={onChange}
        ariaLabel="Hour"
      />,
    )
    scrollWheel(12 * H)
    rerender(
      <WheelColumn
        items={HOURS}
        value={3}
        onChange={onChange}
        ariaLabel="Hour"
      />,
    )
    expect(wheel().scrollTop).toBe(12 * H)
    advance(120)
    expect(onChange).toHaveBeenLastCalledWith(12)
  })
})

describe("WheelColumn — tapping a row", () => {
  it("rolls the tapped row to the centre, and the value follows the roll rather than the tap", () => {
    const onChange = vi.fn()
    render(<Controlled initial={9} onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: "11" }))
    expect(smoothRolls()).toEqual([11 * H])
    expect(onChange).not.toHaveBeenCalled()

    //the roll's own scroll events carry the value
    scrollWheel(10 * H)
    scrollWheel(11 * H)
    expect(onChange.mock.calls).toEqual([[10], [11]])
  })
})

describe("WheelColumn — the keyboard", () => {
  //the rows stay out of the tab order on purpose, so the column itself is the one
  //keyboard stop — without it a keyboard user cannot reach the value at all
  it("is one tab stop, and the rows inside it are not", () => {
    render(<Controlled initial={9} onChange={() => {}} />)
    expect(wheel().tabIndex).toBe(0)
    //what focus lands on is the column assistive tech names, not an anonymous box
    act(() => wheel().focus())
    expect(document.activeElement).toBe(
      screen.getByRole("group", { name: "Hour" }),
    )
    for (const row of wheel().querySelectorAll("button")) {
      expect(row.tabIndex).toBe(-1)
    }
  })

  it("rolls one row per arrow press, and the value follows the roll", () => {
    const onChange = vi.fn()
    render(<Controlled initial={9} onChange={onChange} />)
    const down = fireEvent.keyDown(wheel(), { key: "ArrowDown" })
    //handled: the engine's own 40px arrow scroll would land between rows
    expect(down).toBe(false)
    expect(smoothRolls()).toEqual([10 * H])

    scrollWheel(10 * H)
    advance(120)
    expect(onChange).toHaveBeenLastCalledWith(10)

    fireEvent.keyDown(wheel(), { key: "ArrowUp" })
    fireEvent.keyDown(wheel(), { key: "ArrowUp" })
    expect(smoothRolls()).toEqual([10 * H, 9 * H, 8 * H])
  })

  it("reports the row a key rolls onto once, when the roll's last scroll event crosses into it", () => {
    const onChange = vi.fn()
    render(<Controlled initial={9} onChange={onChange} />)
    fireEvent.keyDown(wheel(), { key: "ArrowDown" })
    //the roll arrives in one scroll event, and nothing scrolls after it
    scrollWheel(10 * H)
    advance(120)
    expect(onChange.mock.calls).toEqual([[10]])
  })

  it("counts presses that land before the roll arrives", () => {
    render(<Controlled initial={9} onChange={() => {}} />)
    for (const _ of [1, 2, 3]) {
      fireEvent.keyDown(wheel(), { key: "ArrowDown" })
    }
    expect(smoothRolls()).toEqual([10 * H, 11 * H, 12 * H])
  })

  it("jumps a page of rows, or to either end, and never past the list", () => {
    render(<Controlled initial={9} onChange={() => {}} />)
    fireEvent.keyDown(wheel(), { key: "End" })
    fireEvent.keyDown(wheel(), { key: "ArrowDown" })
    fireEvent.keyDown(wheel(), { key: "PageUp" })
    fireEvent.keyDown(wheel(), { key: "Home" })
    fireEvent.keyDown(wheel(), { key: "ArrowUp" })
    fireEvent.keyDown(wheel(), { key: "PageDown" })
    expect(smoothRolls()).toEqual([23 * H, 23 * H, 18 * H, 0, 0, 5 * H])
  })

  it("leaves the keys to the page when the list is empty", () => {
    render(
      <WheelColumn
        items={[]}
        value={0}
        onChange={() => {}}
        ariaLabel="Hour"
      />,
    )
    //no row to step to: the key is not taken, and it rolls nothing
    expect(fireEvent.keyDown(wheel(), { key: "ArrowDown" })).toBe(true)
    expect(fireEvent.keyDown(wheel(), { key: "End" })).toBe(true)
    expect(smoothRolls()).toEqual([])
  })

  it("leaves every other key to the page", () => {
    render(<Controlled initial={9} onChange={() => {}} />)
    expect(fireEvent.keyDown(wheel(), { key: "Tab" })).toBe(true)
    expect(fireEvent.keyDown(wheel(), { key: "a" })).toBe(true)
    expect(smoothRolls()).toEqual([])
  })

  it("leaves Alt, Cmd and Ctrl with an arrow to the browser and the OS", () => {
    render(<Controlled initial={9} onChange={() => {}} />)
    for (const modifier of ["altKey", "metaKey", "ctrlKey"]) {
      for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
        expect(
          fireEvent.keyDown(wheel(), { key, [modifier]: true }),
          `${modifier}+${key}`,
        ).toBe(true)
      }
    }
    expect(smoothRolls()).toEqual([])
    //Shift is not a browser chord on a picker: Shift+Arrow still steps
    fireEvent.keyDown(wheel(), { key: "ArrowDown", shiftKey: true })
    expect(smoothRolls()).toEqual([10 * H])
  })

  it("starts counting from where a touch or a settled scroll left the wheel, not from an earlier press", () => {
    render(<Controlled initial={9} onChange={() => {}} />)
    fireEvent.keyDown(wheel(), { key: "ArrowDown" }) // aims at 10
    fireEvent.touchStart(wheel())
    scrollWheel(15 * H)
    fireEvent.touchEnd(wheel())
    fireEvent.keyDown(wheel(), { key: "ArrowDown" })
    expect(smoothRolls().at(-1)).toBe(16 * H)

    //the roll arrives and settles; a mouse wheel then moves it, with no touch at all
    scrollWheel(16 * H)
    advance(120)
    scrollWheel(20 * H)
    advance(120)
    fireEvent.keyDown(wheel(), { key: "ArrowDown" })
    expect(smoothRolls().at(-1)).toBe(21 * H)
  })
})

describe("WheelColumn — the drum", () => {
  it("projects every row around the centred one on mount", () => {
    render(<Controlled initial={9} onChange={() => {}} />)
    expect(rowTransform("09")).toBe(wheelRowTransform(0))
    expect(rowTransform("10")).toBe(wheelRowTransform(1))
    expect(rowTransform("07")).toBe(wheelRowTransform(-2))
  })

  it("repaints every frame from the live scrollTop while moving, even between scroll events", () => {
    render(<Controlled initial={9} onChange={() => {}} />)
    scrollWheel(9 * H + 15)
    advance(16)
    expect(rowTransform("09")).toBe(wheelRowTransform(-0.5))

    //a momentum fling: the compositor moves on, the coalesced scroll event has not come
    act(() => {
      wheel().scrollTop = 10 * H + 6
    })
    advance(16)
    //index − scrollTop/H, spelled the way the component computes it (float-exact)
    expect(rowTransform("10")).toBe(
      wheelRowTransform(10 - (10 * H + 6) / H),
    )
  })

  it("paints from the first frame a finger lands, before any scroll event", () => {
    render(<Controlled initial={9} onChange={() => {}} />)
    fireEvent.touchStart(wheel())
    act(() => {
      wheel().scrollTop = 9 * H + 9
    })
    advance(16)
    expect(rowTransform("09")).toBe(wheelRowTransform(9 - (9 * H + 9) / H))
  })

  it("stops painting once the wheel settles", () => {
    render(<Controlled initial={9} onChange={() => {}} />)
    scrollWheel(9 * H + 6)
    advance(200) // settled: the roll is issued and the loop sees an idle wheel
    const settled = rowTransform("09")

    act(() => {
      wheel().scrollTop = 12 * H
    })
    const frames = vi.spyOn(window, "requestAnimationFrame")
    advance(200)
    expect(frames).not.toHaveBeenCalled()
    expect(rowTransform("09")).toBe(settled)
  })

  it("projects rows that appear when the list grows (28 → 31 days)", () => {
    const { rerender } = render(
      <WheelColumn
        items={range(1, 28)}
        value={15}
        onChange={() => {}}
        ariaLabel="Hour"
      />,
    )
    rerender(
      <WheelColumn
        items={range(1, 31)}
        value={15}
        onChange={() => {}}
        ariaLabel="Hour"
      />,
    )
    //row 31 is index 30, sixteen rows below the centred 15 (index 14)
    expect(rowTransform("31")).toBe(wheelRowTransform(16))
  })
})

describe("WheelColumn — default rules in the layer, locks inline (styling.md §2)", () => {
  function mount(
    props: { className?: string; itemClassName?: string } = {},
  ) {
    render(
      <WheelColumn
        items={HOURS}
        value={0}
        onChange={() => {}}
        ariaLabel="Hour"
        {...props}
      />,
    )
    return wheel()
  }

  it("names its parts and emits no class of its own", () => {
    const column = mount()
    expect(column.getAttribute("data-part")).toBe("root")
    expect(column.getAttribute("class") ?? "").toBe("")
    const list = column.querySelector("ul") as HTMLElement
    expect(list.getAttribute("data-adaptv")).toBe("wheel-column")
    expect(list.getAttribute("data-part")).toBe("list")
    expect(list.hasAttribute("class")).toBe(false)
    for (const row of column.querySelectorAll("button")) {
      expect(row.getAttribute("data-part")).toBe("item")
      expect(row.getAttribute("class") ?? "").toBe("")
    }
  })

  it("passes consumer classes through untouched", () => {
    const column = mount({
      className: "border",
      itemClassName: "text-sm data-[active=true]:text-blue-600",
    })
    expect(column.className).toBe("border")
    expect(column.querySelector("button")?.className).toBe(
      "text-sm data-[active=true]:text-blue-600",
    )
  })

  it("keeps the scroll model, the drum and the full-slot rows locked inline", () => {
    const column = mount()
    expect(column.style.overflowY).toBe("auto")
    expect(column.style.overflowX).toBe("hidden")
    expect(column.style.overscrollBehaviorY).toBe("contain")
    expect(column.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    expect(column.style.height).toBe(`${5 * H}px`)
    const row = column.querySelector("button") as HTMLElement
    expect(row.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    expect(row.style.height).toBe("100%")
    expect(row.style.width).toBe("100%")
  })
})
