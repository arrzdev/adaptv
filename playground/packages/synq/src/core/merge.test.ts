import { describe, expect, it } from "vitest"
import {
  documentsEqual,
  getConflicts,
  hasConflicts,
  isDeleted,
  mergeDocuments,
} from "#synq/core/merge"
import type {
  FieldConflict,
  Hlc,
  StoredDocument,
} from "#synq/types/synq.types"

const H = (wall: number, node = "x", counter = 0): Hlc => ({
  wall,
  counter,
  node,
})

function doc<T extends Record<string, unknown>>(
  id: string,
  row: T,
  fields: Record<string, Hlc>,
  tombstones: Record<string, Hlc> = {},
): StoredDocument<T> {
  return {
    $id: id,
    $meta: { fields, tombstones },
    ...row,
  } as StoredDocument<T>
}

function data<T>(doc: StoredDocument<T>): Record<string, unknown> {
  const { $meta, ...rest } = doc as Record<string, unknown> & {
    $meta: unknown
  }
  return rest
}

describe("mergeDocuments — field-level LWW", () => {
  it("keeps non-overlapping edits from both sides", () => {
    //A edited title offline, B edited assignee online — both survive
    const a = doc(
      "1",
      { title: "A2", assignee: "Alice" },
      { title: H(2, "a"), assignee: H(1, "base") },
    )
    const b = doc(
      "1",
      { title: "A", assignee: "Bob" },
      { title: H(1, "base"), assignee: H(3, "s") },
    )
    expect(data(mergeDocuments(a, b))).toEqual({
      $id: "1",
      title: "A2",
      assignee: "Bob",
    })
  })

  it("resolves a same-field collision by the newer hlc", () => {
    const a = doc("1", { title: "Apple" }, { title: H(2, "a") })
    const b = doc("1", { title: "Banana" }, { title: H(3, "s") })
    expect(data(mergeDocuments(a, b)).title).toBe("Banana")
    expect(data(mergeDocuments(b, a)).title).toBe("Banana")
  })

  it("breaks an exact-tie (wall+counter) deterministically by node id", () => {
    //same physical instant, same counter, different nodes: the higher node
    //string wins, and the choice is identical regardless of merge order.
    const a = doc("1", { title: "from-a" }, { title: H(7, "aaa", 4) })
    const b = doc("1", { title: "from-b" }, { title: H(7, "zzz", 4) })
    expect(data(mergeDocuments(a, b)).title).toBe("from-b")
    expect(data(mergeDocuments(b, a)).title).toBe("from-b")
    expect(mergeDocuments(a, b)).toEqual(mergeDocuments(b, a))
  })

  it("preserves unknown fields from a newer-schema peer (additive)", () => {
    //an old client merges a doc carrying a field it doesn't know about; the
    //field (and its stamp) must survive, never be clobbered.
    const known = doc("1", { title: "t" }, { title: H(2, "a") })
    const newer = doc(
      "1",
      { title: "t", futureField: 42 },
      { title: H(1, "base"), futureField: H(9, "s") },
    )
    expect(data(mergeDocuments(known, newer)).futureField).toBe(42)
  })
})

describe("mergeDocuments — atomic groups (semantic safety)", () => {
  it("resolves coupled fields as one block, newer side wins", () => {
    //hotel trap: A booked room 202 @ $300, B surcharged room 101 to $120.
    //without atomic grouping the merge would book 202 at the $120 price.
    const a = doc(
      "1",
      { roomNumber: "202", price: 300 },
      { roomNumber: H(2, "a"), price: H(2, "a") },
    )
    const b = doc(
      "1",
      { roomNumber: "101", price: 120 },
      { roomNumber: H(3, "s"), price: H(3, "s") },
    )
    const merged = mergeDocuments(a, b, {
      atomicGroups: [["roomNumber", "price"]],
    })
    expect(data(merged)).toEqual({
      $id: "1",
      roomNumber: "101",
      price: 120,
    })
  })
})

describe("mergeDocuments — field tombstones (anti-zombie)", () => {
  it("keeps a scalar field cleared when the clear is newer", () => {
    const a = doc(
      "1",
      { title: "x" },
      { title: H(1, "base") },
      { nickname: H(5, "a") },
    )
    const b = doc(
      "1",
      { title: "x", nickname: "Bob" },
      { title: H(1, "base"), nickname: H(3, "s") },
    )
    expect(data(mergeDocuments(a, b))).not.toHaveProperty("nickname")
  })

  it("revives a field when the re-write is newer than the clear", () => {
    //field-level clear is LWW; a later write of the same field is legal
    const a = doc(
      "1",
      { title: "x" },
      { title: H(1, "base") },
      { nickname: H(2, "a") },
    )
    const b = doc(
      "1",
      { title: "x", nickname: "Bob" },
      { title: H(1, "base"), nickname: H(3, "s") },
    )
    expect(data(mergeDocuments(a, b)).nickname).toBe("Bob")
  })

  it("does not resurrect an array element removed after it was added", () => {
    const a = doc(
      "1",
      { tags: [] as string[] },
      { "tags::marketing": H(1, "base") },
      { "tags::marketing": H(2, "a") },
    )
    const b = doc(
      "1",
      { tags: ["marketing", "urgent"] },
      { "tags::marketing": H(1, "base"), "tags::urgent": H(25, "s") },
    )
    expect(data(mergeDocuments(a, b)).tags).toEqual(["urgent"])
  })

  it("keeps concurrent adds of different elements (OR-set)", () => {
    const a = doc("1", { tags: ["red"] }, { "tags::red": H(4, "a") })
    const b = doc("1", { tags: ["blue"] }, { "tags::blue": H(4, "b") })
    expect(data(mergeDocuments(a, b)).tags).toEqual(["blue", "red"])
  })
})

describe("mergeDocuments — row deletion (delete wins permanently)", () => {
  function deleted(
    id: string,
    at: Hlc,
  ): StoredDocument<{ title: string }> {
    return {
      $id: id,
      $meta: { fields: {}, tombstones: {}, deletedAt: at },
    } as StoredDocument<{ title: string }>
  }

  it("stays deleted when the delete is newer than the edit", () => {
    const del = deleted("1", H(5, "a"))
    const edit = doc("1", { title: "edited" }, { title: H(3, "s") })
    const merged = mergeDocuments(del, edit)
    expect(isDeleted(merged)).toBe(true)
    expect(data(merged)).not.toHaveProperty("title")
  })

  it("stays deleted EVEN when a concurrent edit is newer (no resurrection)", () => {
    //the decision: a stale offline edit must never bring a deleted row back
    const del = deleted("1", H(3, "a"))
    const edit = doc("1", { title: "edited" }, { title: H(99, "s") })
    expect(isDeleted(mergeDocuments(del, edit))).toBe(true)
    expect(isDeleted(mergeDocuments(edit, del))).toBe(true)
    expect(mergeDocuments(del, edit)).toEqual(mergeDocuments(edit, del))
  })

  it("delete absorbs a whole live document, dropping its fields + sets", () => {
    const del = deleted("1", H(3, "a"))
    const live = doc(
      "1",
      { title: "t", tags: ["x"] },
      { title: H(50, "s"), "tags::x": H(50, "s") },
    )
    expect(data(mergeDocuments(del, live))).toEqual({ $id: "1" })
  })
})

//---- CRDT laws (randomised property tests) -------------------------
//a merge that isn't commutative + associative + idempotent silently
//diverges replicas. these generate adversarial doc versions (overlapping
//fields, set add/remove races, field clears, deletes) and assert the laws
//hold structurally — $meta included, so stamps converge too, not just data.

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const NODES = ["a", "b", "c"]
const SCALARS = ["title", "count", "owner"]
const ELEMENTS = ["x", "y", "z"]

//generate a well-formed version of row "1": some scalar writes, some set
//element adds/removes, occasional field clears, occasional whole-row delete.
function genVersion(
  rng: () => number,
): StoredDocument<Record<string, unknown>> {
  const stamp = (): Hlc => ({
    //tiny ranges force frequent collisions + exact ties → exercises tiebreak
    wall: 1 + Math.floor(rng() * 4),
    counter: Math.floor(rng() * 2),
    node: NODES[Math.floor(rng() * NODES.length)],
  })

  if (rng() < 0.15) {
    return {
      $id: "1",
      $meta: { fields: {}, tombstones: {}, deletedAt: stamp() },
    } as StoredDocument<Record<string, unknown>>
  }

  const row: Record<string, unknown> = {}
  const fields: Record<string, Hlc> = {}
  const tombstones: Record<string, Hlc> = {}

  for (const f of SCALARS) {
    const r = rng()
    if (r < 0.5) {
      row[f] = Math.floor(rng() * 5)
      fields[f] = stamp()
    } else if (r < 0.65) {
      //field clear (tombstone, no value)
      tombstones[f] = stamp()
    }
  }

  const present: string[] = []
  for (const el of ELEMENTS) {
    const r = rng()
    if (r < 0.4) {
      fields[`tags${"::"}${el}`] = stamp()
      present.push(el)
    } else if (r < 0.6) {
      tombstones[`tags${"::"}${el}`] = stamp()
    } else if (r < 0.75) {
      //add then remove the same element (race within one version)
      fields[`tags${"::"}${el}`] = stamp()
      tombstones[`tags${"::"}${el}`] = stamp()
    }
  }
  if (
    present.length ||
    Object.keys(tombstones).some((k) => k.startsWith("tags"))
  ) {
    row.tags = present.sort()
  }

  return {
    $id: "1",
    ...row,
    $meta: { fields, tombstones },
  } as StoredDocument<Record<string, unknown>>
}

describe("mergeDocuments — CRDT laws (property)", () => {
  it("is commutative: merge(a,b) == merge(b,a)", () => {
    const rng = mulberry32(1)
    for (let i = 0; i < 300; i++) {
      const a = genVersion(rng)
      const b = genVersion(rng)
      expect(mergeDocuments(a, b)).toEqual(mergeDocuments(b, a))
    }
  })

  it("is associative: merge(merge(a,b),c) == merge(a,merge(b,c))", () => {
    const rng = mulberry32(2)
    for (let i = 0; i < 300; i++) {
      const a = genVersion(rng)
      const b = genVersion(rng)
      const c = genVersion(rng)
      const left = mergeDocuments(mergeDocuments(a, b), c)
      const right = mergeDocuments(a, mergeDocuments(b, c))
      expect(left).toEqual(right)
    }
  })

  it("is idempotent: merge(m,m) == m for any merged m", () => {
    const rng = mulberry32(3)
    for (let i = 0; i < 300; i++) {
      const m = mergeDocuments(genVersion(rng), genVersion(rng))
      expect(mergeDocuments(m, m)).toEqual(m)
    }
  })

  it("converges: any shuffle of N versions folds to the same state", () => {
    const rng = mulberry32(4)
    for (let trial = 0; trial < 60; trial++) {
      const n = 3 + Math.floor(rng() * 4)
      const versions: StoredDocument<Record<string, unknown>>[] = []
      for (let i = 0; i < n; i++) versions.push(genVersion(rng))

      const fold = (order: number[]) => {
        let acc = versions[order[0]]
        for (let i = 1; i < order.length; i++) {
          acc = mergeDocuments(acc, versions[order[i]])
        }
        return acc
      }

      const baseline = fold(versions.map((_, i) => i))
      for (let s = 0; s < 6; s++) {
        const order = versions.map((_, i) => i)
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1))
          ;[order[i], order[j]] = [order[j], order[i]]
        }
        expect(fold(order)).toEqual(baseline)
      }
    }
  })
})

describe("documentsEqual", () => {
  it("ignores causal metadata", () => {
    const x = doc("1", { a: 1, b: 2 }, { a: H(1), b: H(1) })
    const y = doc("1", { a: 1, b: 2 }, { a: H(5, "z"), b: H(9, "q") })
    expect(documentsEqual(x, y)).toBe(true)
  })

  it("detects differing data", () => {
    const x = doc("1", { a: 1, b: 2 }, { a: H(1), b: H(1) })
    const z = doc("1", { a: 1, b: 3 }, { a: H(1), b: H(1) })
    expect(documentsEqual(x, z)).toBe(false)
  })
})

//attach preserved conflicts to a doc's $meta for propagation/GC tests
function withConflicts<T extends Record<string, unknown>>(
  d: StoredDocument<T>,
  conflicts: Record<string, FieldConflict[]>,
): StoredDocument<T> {
  return {
    ...d,
    $meta: { ...d.$meta, conflicts },
  } as StoredDocument<T>
}

describe("mergeDocuments — conflict preservation (no silent LWW loss)", () => {
  const base = doc("1", { title: "orig" }, { title: H(1, "base") })

  it("captures the loser of a CONCURRENT same-field edit (base-aware)", () => {
    //both moved title off the common base → a genuine conflict. the higher
    //hlc wins the live value; the loser is preserved, not silently dropped.
    const local = doc("1", { title: "local" }, { title: H(2, "a") })
    const remote = doc("1", { title: "remote" }, { title: H(3, "s") })
    const merged = mergeDocuments(local, remote, { base })
    expect((merged as { title: string }).title).toBe("remote")
    expect(hasConflicts(merged)).toBe(true)
    expect(getConflicts(merged).title.map((c) => c.value)).toEqual([
      "local",
    ])
  })

  it("does NOT flag a sequential edit (only one side moved off base)", () => {
    //local still carries the base value/stamp; only remote edited → a normal
    //supersede, never a conflict
    const local = doc("1", { title: "orig" }, { title: H(1, "base") })
    const remote = doc("1", { title: "remote" }, { title: H(3, "s") })
    const merged = mergeDocuments(local, remote, { base })
    expect((merged as { title: string }).title).toBe("remote")
    expect(hasConflicts(merged)).toBe(false)
  })

  it("never captures without a base (plain two-way merge)", () => {
    const a = doc("1", { title: "local" }, { title: H(2, "a") })
    const b = doc("1", { title: "remote" }, { title: H(3, "s") })
    expect(hasConflicts(mergeDocuments(a, b))).toBe(false)
  })

  it("is symmetric: same winner + same preserved loser either order", () => {
    const local = doc("1", { title: "local" }, { title: H(2, "a") })
    const remote = doc("1", { title: "remote" }, { title: H(3, "s") })
    const ab = mergeDocuments(local, remote, { base })
    const ba = mergeDocuments(remote, local, { base })
    expect(getConflicts(ab)).toEqual(getConflicts(ba))
    expect((ab as { title: string }).title).toBe(
      (ba as { title: string }).title,
    )
  })

  it("propagates a preserved conflict through a plain two-way merge", () => {
    const conflicted = withConflicts(
      doc("1", { title: "remote" }, { title: H(3, "s") }),
      { title: [{ hlc: H(2, "a"), value: "local", against: H(3, "s") }] },
    )
    const plain = doc("1", { title: "remote" }, { title: H(3, "s") })
    const merged = mergeDocuments(conflicted, plain)
    expect(getConflicts(merged).title.map((c) => c.value)).toEqual([
      "local",
    ])
  })

  it("resolves (GCs) the conflict once a later write supersedes it", () => {
    const conflicted = withConflicts(
      doc("1", { title: "remote" }, { title: H(3, "s") }),
      { title: [{ hlc: H(2, "a"), value: "local", against: H(3, "s") }] },
    )
    //a fresh write to title, newer than the stamp the conflict was decided
    //against → the user resolved it
    const resolved = doc("1", { title: "final" }, { title: H(5, "a") })
    const merged = mergeDocuments(resolved, conflicted)
    expect((merged as { title: string }).title).toBe("final")
    expect(hasConflicts(merged)).toBe(false)
  })

  it("a row delete clears any preserved conflicts", () => {
    const conflicted = withConflicts(
      doc("1", { title: "remote" }, { title: H(3, "s") }),
      { title: [{ hlc: H(2, "a"), value: "local", against: H(3, "s") }] },
    )
    const deleted = {
      $id: "1",
      $meta: { fields: {}, tombstones: {}, deletedAt: H(9, "s") },
    } as StoredDocument<{ title: string }>
    const merged = mergeDocuments(conflicted, deleted)
    expect(isDeleted(merged)).toBe(true)
    expect(hasConflicts(merged)).toBe(false)
  })

  it("converges with conflicts present (commutative + idempotent)", () => {
    const c1 = withConflicts(
      doc("1", { title: "remote" }, { title: H(3, "s") }),
      { title: [{ hlc: H(2, "a"), value: "local", against: H(3, "s") }] },
    )
    const c2 = withConflicts(
      doc("1", { title: "remote" }, { title: H(3, "s") }),
      { title: [{ hlc: H(2, "b"), value: "other", against: H(3, "s") }] },
    )
    expect(mergeDocuments(c1, c2)).toEqual(mergeDocuments(c2, c1))
    const m = mergeDocuments(c1, c2)
    expect(mergeDocuments(m, m)).toEqual(m)
    expect(
      getConflicts(m)
        .title.map((c) => c.value)
        .sort(),
    ).toEqual(["local", "other"])
  })
})
