import type { Hlc } from "#synq/types/synq.types"

//---- Hybrid Logical Clock -----------------------------------------
//physical wall time fused with a logical counter (Kulkarni et al). it
//gives us causal, totally-ordered timestamps that keep moving forward
//even when a device's hardware clock is wrong or jumps backward — the
//thing raw Date.now() can never guarantee across offline devices.

//"<wall>:<counter>:<node>" — the form stored on rows and sent on the wire
export function formatHlc(h: Hlc): string {
  return `${h.wall}:${h.counter}:${h.node}`
}

export function parseHlc(s: string): Hlc {
  const first = s.indexOf(":")
  const second = s.indexOf(":", first + 1)
  if (first < 0 || second < 0) {
    throw new Error(`invalid hlc: ${s}`)
  }
  const wall = Number(s.slice(0, first))
  const counter = Number(s.slice(first + 1, second))
  //node id is a uuid (no colons), so the rest is taken verbatim
  const node = s.slice(second + 1)
  if (!Number.isFinite(wall) || !Number.isFinite(counter) || node === "") {
    throw new Error(`invalid hlc: ${s}`)
  }
  return { wall, counter, node }
}

//total order: wall, then counter, then node as a stable tiebreaker so
//two nodes can never call the exact same stamp a "tie".
export function compareHlc(a: Hlc, b: Hlc): -1 | 0 | 1 {
  if (a.wall !== b.wall) return a.wall < b.wall ? -1 : 1
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1
  if (a.node !== b.node) return a.node < b.node ? -1 : 1
  return 0
}

export function maxHlc(a: Hlc, b: Hlc): Hlc {
  return compareHlc(a, b) >= 0 ? a : b
}

//---- Clock instance -----------------------------------------------

export interface HlcClock {
  //the last stamp this clock produced or observed
  now: () => Hlc
  //stamp a local event — strictly greater than anything seen so far
  send: () => Hlc
  //fold in a stamp observed from another node, then advance past it
  recv: (remote: Hlc) => Hlc
}

export interface ClockOptions {
  //injectable physical clock for deterministic tests
  wallNow?: () => number
  //resume from a persisted stamp (e.g. the highest hlc in storage)
  last?: Hlc
}

export function createClock(
  node: string,
  opts: ClockOptions = {},
): HlcClock {
  const wallNow = opts.wallNow ?? Date.now
  let last: Hlc = opts.last ?? { wall: 0, counter: 0, node }

  function send(): Hlc {
    const phys = wallNow()
    const wall = Math.max(last.wall, phys)
    //same ms as last → bump the counter; time moved on → reset to 0
    const counter = wall === last.wall ? last.counter + 1 : 0
    last = { wall, counter, node }
    return last
  }

  function recv(remote: Hlc): Hlc {
    const phys = wallNow()
    const wall = Math.max(last.wall, remote.wall, phys)
    let counter: number
    if (wall === last.wall && wall === remote.wall) {
      counter = Math.max(last.counter, remote.counter) + 1
    } else if (wall === last.wall) {
      counter = last.counter + 1
    } else if (wall === remote.wall) {
      counter = remote.counter + 1
    } else {
      counter = 0
    }
    last = { wall, counter, node }
    return last
  }

  return {
    now: () => last,
    send,
    recv,
  }
}
