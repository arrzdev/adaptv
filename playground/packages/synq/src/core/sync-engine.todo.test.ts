import { describe, it } from "vitest"

//---- Roadmap: remaining layers ------------------------------------
//the db factory, the live-query engine behind useCollection and the
//IndexedDB adapter are done and tested in their own files. what is left
//is a sync-progress signal on the React surface.

describe("react useCollection adapter", () => {
  it.todo("exposes isSyncing during a sync run")
})
