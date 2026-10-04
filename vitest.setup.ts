import { afterEach } from "vitest"

//Testing Library's automatic cleanup only self-registers when the test framework
//exposes a global `afterEach`, which Vitest does not without `globals: true`.
//Without this, every `render()` stays mounted in document.body for the rest of the
//file — so a document-wide query silently matches an EARLIER test's tree.
//
//That failure is nasty because it usually presents as "found multiple elements"
//in a test that renders exactly one, and it can also produce false PASSES when a
//stale node happens to satisfy the assertion.
//
//So `afterEach` is exposed as the one global it looks for, and Testing Library
//registers its own `afterEach(cleanup)` when a test file imports it. Importing it
//here instead loaded React, react-dom and Testing Library into every one of the
//318 files to clean up after the 100 that render — in an isolated run that load
//is paid again per file, and it was a large share of the suite's time on CI.
//Only `afterEach`: with `beforeAll`/`afterAll` global too, Testing Library would
//also start flipping React's act environment, which this suite has never had.
Object.defineProperty(globalThis, "afterEach", {
  value: afterEach,
  configurable: true,
  writable: true,
})

//happy-dom 20 does not provide Web Storage (Node warns that localStorage needs
//`--localstorage-file`). The code under test targets browsers, where both exist
//unconditionally, so a minimal spec-shaped implementation is the honest stand-in —
//the alternative would be contorting the source to accommodate a test environment
//gap that no real target has.
class MemoryStorage implements Storage {
  #entries = new Map<string, string>()

  get length(): number {
    return this.#entries.size
  }
  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null
  }
  getItem(key: string): string | null {
    return this.#entries.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.#entries.set(key, String(value))
  }
  removeItem(key: string): void {
    this.#entries.delete(key)
  }
  clear(): void {
    this.#entries.clear()
  }
  [name: string]: unknown
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  if (typeof globalThis[name] !== "undefined") continue
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, name, {
    value: storage,
    configurable: true,
    writable: true,
  })
  if (typeof window !== "undefined") {
    Object.defineProperty(window, name, {
      value: storage,
      configurable: true,
      writable: true,
    })
  }
}
