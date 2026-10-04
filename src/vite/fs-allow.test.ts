// @vitest-environment node
import { describe, expect, it } from "vitest"
import { addFsAllowRoot } from "#adaptv/vite/adaptv-plugin"

// adaptv lets Vite's dev server read its own package (router entry, root route, Start's
// default entries) when adaptv is linked from OUTSIDE the app root — a workspace, `file:`,
// `pnpm link`, or a git worktree. The subtle contract, and the reason this test exists:
// it must APPEND to Vite's resolved `server.fs.allow`, never REPLACE it. Returning
// `server.fs.allow` from a plugin `config()` suppresses Vite's computed default (the
// app's own workspace root), which then makes the app's generated files (e.g.
// `.adaptv/routeTree.gen.ts`) unreadable — and only in the cloudflare/workerd SSR
// environment, whose `fetchModule` honours the allow-list strictly, so the whole dev
// server 500s with "Failed to load url". The client transform hides it. → offline PR.

describe("addFsAllowRoot — extend Vite's allow-list without dropping its defaults", () => {
  it("appends adaptv's root while keeping the app's own root", () => {
    const appWorkspaceRoot = "/some/app/workspace"
    const allow = [appWorkspaceRoot]

    addFsAllowRoot(allow, "/link/to/adaptv")

    // the app's own root is still there (dropping it 500s the SSR env)…
    expect(allow).toContain(appWorkspaceRoot)
    // …and adaptv's package root was added alongside it, not in place of it.
    expect(allow).toEqual([appWorkspaceRoot, "/link/to/adaptv"])
  })

  it("is idempotent — re-resolving does not duplicate the entry", () => {
    const allow = ["/app"]
    addFsAllowRoot(allow, "/link/to/adaptv")
    addFsAllowRoot(allow, "/link/to/adaptv")
    expect(allow).toEqual(["/app", "/link/to/adaptv"])
  })
})
