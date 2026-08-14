import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  appRelativePath,
  createAdaptvContext,
} from "#adaptv/vite/adaptv-context.ts"

describe("appRelativePath", () => {
  const context = createAdaptvContext(
    path.join("/Users", "someone", "app"),
  )

  it("states a path inside the app the way the app's own files do", () => {
    //The rule this exists for: build output must never print an absolute path.
    //It is the developer's home directory, in a line they may paste into an
    //issue, and it is unreadable next to `.output/public/sw.js`.
    //→ `docs/CLI-UX.md`
    expect(
      appRelativePath(
        context,
        path.join(
          "/Users",
          "someone",
          "app",
          ".output",
          "public",
          "sw.js",
        ),
      ),
    ).toBe(path.join(".output", "public", "sw.js"))
  })

  it("leaves a path outside the app alone", () => {
    //A `../../../..` chain is harder to read than what it was built from. This
    //is a legibility rule, not a redaction one — so the fallback is honest
    //rather than clever.
    const outside = path.join("/tmp", "elsewhere", "sw.js")
    expect(appRelativePath(context, outside)).toBe(outside)
  })

  it("leaves the app root itself alone rather than returning nothing", () => {
    //`path.relative(x, x)` is the empty string, which would print as
    //`wrote  (app shell)`.
    expect(appRelativePath(context, context.appRoot)).toBe(context.appRoot)
  })
})
