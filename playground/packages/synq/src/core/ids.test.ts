import { afterEach, describe, expect, it, vi } from "vitest"
import { isId, newId } from "#synq/core/ids"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ids", () => {
  it("generates a v4 uuid", () => {
    const id = newId()
    expect(isId(id)).toBe(true)
    expect(id).toHaveLength(36)
  })

  it("generates unique ids across many calls", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 10_000; i++) seen.add(newId())
    expect(seen.size).toBe(10_000)
  })

  it("rejects non-uuid strings and non-strings", () => {
    expect(isId("not-an-id")).toBe(false)
    expect(isId("")).toBe(false)
    expect(isId(123)).toBe(false)
    expect(isId(null)).toBe(false)
    expect(isId(undefined)).toBe(false)
  })

  //insecure contexts (a phone on a LAN http dev server) lack randomUUID
  it("falls back to a valid v4 uuid when crypto.randomUUID is missing", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = (i * 31 + 7) & 0xff
        return arr
      },
    })
    const id = newId()
    expect(isId(id)).toBe(true)
  })

  it("falls back to Math.random when crypto is entirely absent", () => {
    vi.stubGlobal("crypto", undefined)
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const id = newId()
      expect(isId(id)).toBe(true)
      ids.add(id)
    }
    expect(ids.size).toBe(1000)
  })
})
