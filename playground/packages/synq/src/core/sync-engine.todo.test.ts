import { describe, it } from "vitest"

//---- Roadmap: remaining layers ------------------------------------
//the pure core + snapshot sync engine + in-memory storage are done. what
//is left is the ergonomic surface and the browser persistence.

describe("db factory (createSynq)", () => {
  it.todo("exposes db[name] handles with insert/update/delete/get/query")
  it.todo("db.sync() reconciles every collection; db[name].sync() one")
  it.todo("insert appends an op and the read view shows it optimistically")
})

describe("react useQuery adapter", () => {
  it.todo("serves warm memory cache instantly, then live-updates")
  it.todo("query cache is ref-counted and GC'd after the last unmount")
  it.todo("exposes isSyncing during a sync run")
})

describe("indexeddb storage adapter", () => {
  it.todo("persists rows/ops/cursor across reopen (fake-indexeddb)")
  it.todo("notifies subscribers once per atomic transaction")
})
