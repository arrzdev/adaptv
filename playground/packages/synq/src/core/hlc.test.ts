import { describe, expect, it } from "vitest"
import {
  compareHlc,
  createClock,
  formatHlc,
  maxHlc,
  parseHlc,
} from "#synq/core/hlc"
import type { Hlc } from "#synq/types/synq.types"

const hlc = (wall: number, counter: number, node: string): Hlc => ({
  wall,
  counter,
  node,
})

describe("hlc format/parse", () => {
  it("round-trips through the wire form", () => {
    const h = hlc(1718395200000, 7, "node-abc")
    expect(parseHlc(formatHlc(h))).toEqual(h)
  })

  it("keeps node ids verbatim", () => {
    const node = "a1b2c3d4-0000-4000-8000-000000000000"
    expect(parseHlc(formatHlc(hlc(10, 0, node))).node).toBe(node)
  })

  it("throws on malformed strings", () => {
    expect(() => parseHlc("nope")).toThrow()
    expect(() => parseHlc("10:0")).toThrow()
    expect(() => parseHlc("10:0:")).toThrow()
  })
})

describe("hlc compare", () => {
  it("orders by wall, then counter, then node", () => {
    expect(compareHlc(hlc(1, 0, "a"), hlc(2, 0, "a"))).toBe(-1)
    expect(compareHlc(hlc(2, 0, "a"), hlc(2, 1, "a"))).toBe(-1)
    expect(compareHlc(hlc(2, 1, "a"), hlc(2, 1, "b"))).toBe(-1)
    expect(compareHlc(hlc(2, 1, "b"), hlc(2, 1, "a"))).toBe(1)
    expect(compareHlc(hlc(2, 1, "a"), hlc(2, 1, "a"))).toBe(0)
  })

  it("maxHlc returns the greater stamp", () => {
    expect(maxHlc(hlc(1, 0, "a"), hlc(2, 0, "a"))).toEqual(hlc(2, 0, "a"))
    expect(maxHlc(hlc(5, 9, "z"), hlc(5, 9, "a"))).toEqual(hlc(5, 9, "z"))
  })
})

describe("hlc clock", () => {
  it("send is strictly monotonic within the same wall ms", () => {
    const clock = createClock("n1", { wallNow: () => 1000 })
    const a = clock.send()
    const b = clock.send()
    const c = clock.send()
    expect(a).toEqual(hlc(1000, 0, "n1"))
    expect(b).toEqual(hlc(1000, 1, "n1"))
    expect(c).toEqual(hlc(1000, 2, "n1"))
  })

  it("send advances wall and resets counter when time moves on", () => {
    let t = 1000
    const clock = createClock("n1", { wallNow: () => t })
    clock.send()
    clock.send()
    t = 2000
    expect(clock.send()).toEqual(hlc(2000, 0, "n1"))
  })

  it("never moves backward when the hardware clock jumps back", () => {
    let t = 5000
    const clock = createClock("n1", { wallNow: () => t })
    const first = clock.send()
    t = 1000 //clock drifts 4s into the past
    const second = clock.send()
    expect(compareHlc(second, first)).toBe(1)
    expect(second).toEqual(hlc(5000, 1, "n1"))
  })

  it("recv folds a remote stamp and advances past both", () => {
    const clock = createClock("local", { wallNow: () => 1000 })
    clock.send() //local at 1000:0
    const remote = hlc(3000, 4, "remote")
    const folded = clock.recv(remote)
    expect(compareHlc(folded, remote)).toBe(1)
    expect(folded.wall).toBe(3000)
    expect(folded.node).toBe("local")
  })

  it("recv breaks ties on equal wall by max counter + 1", () => {
    const clock = createClock("local", {
      wallNow: () => 3000,
      last: hlc(3000, 2, "local"),
    })
    const folded = clock.recv(hlc(3000, 5, "remote"))
    expect(folded).toEqual(hlc(3000, 6, "local"))
  })

  it("resumes from a persisted stamp", () => {
    const clock = createClock("n1", {
      wallNow: () => 100,
      last: hlc(9999, 3, "n1"),
    })
    expect(clock.send()).toEqual(hlc(9999, 4, "n1"))
  })
})
