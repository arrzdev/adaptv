import { describe, expect, it } from "vitest"
import {
  isDocMeta,
  isHlc,
  isStoredDocument,
} from "#synq/protocol/validate"

const hlc = { wall: 5, counter: 0, node: "n1" }

describe("isHlc", () => {
  it("accepts a well-formed stamp", () => {
    expect(isHlc(hlc)).toBe(true)
  })

  it("rejects malformed stamps", () => {
    expect(isHlc(null)).toBe(false)
    expect(isHlc({ wall: "5", counter: 0, node: "n1" })).toBe(false)
    expect(isHlc({ wall: 5, counter: 0, node: "" })).toBe(false)
    expect(isHlc({ wall: Number.NaN, counter: 0, node: "n1" })).toBe(false)
    expect(isHlc({ wall: 5, counter: 0 })).toBe(false)
  })
})

describe("isDocMeta", () => {
  it("accepts minimal and full metas", () => {
    expect(isDocMeta({ fields: {}, tombstones: {} })).toBe(true)
    expect(
      isDocMeta({
        fields: { title: hlc },
        tombstones: { "tags::urgent": hlc },
        deletedAt: hlc,
        conflicts: { title: [{ hlc, value: "x", against: hlc }] },
      }),
    ).toBe(true)
  })

  it("rejects malformed metas", () => {
    expect(isDocMeta(null)).toBe(false)
    expect(isDocMeta({})).toBe(false)
    expect(isDocMeta({ fields: {}, tombstones: { t: "bad" } })).toBe(false)
    expect(isDocMeta({ fields: {}, tombstones: {}, deletedAt: 5 })).toBe(
      false,
    )
    expect(
      isDocMeta({
        fields: {},
        tombstones: {},
        conflicts: { title: [{ value: "x" }] },
      }),
    ).toBe(false)
  })
})

describe("isStoredDocument", () => {
  it("accepts a sound document and a tombstone", () => {
    expect(
      isStoredDocument({
        $id: "a",
        $meta: { fields: { title: hlc }, tombstones: {} },
        title: "hello",
      }),
    ).toBe(true)
    expect(
      isStoredDocument({
        $id: "a",
        $meta: { fields: {}, tombstones: {}, deletedAt: hlc },
      }),
    ).toBe(true)
  })

  it("rejects a missing/empty $id or a broken $meta", () => {
    expect(isStoredDocument(null)).toBe(false)
    expect(
      isStoredDocument({ $meta: { fields: {}, tombstones: {} } }),
    ).toBe(false)
    expect(
      isStoredDocument({ $id: "", $meta: { fields: {}, tombstones: {} } }),
    ).toBe(false)
    expect(isStoredDocument({ $id: "a" })).toBe(false)
    expect(isStoredDocument({ $id: "a", $meta: { fields: {} } })).toBe(
      false,
    )
  })
})
