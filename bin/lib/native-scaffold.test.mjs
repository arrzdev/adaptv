// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * The native project has ONE home, `.adaptv/<platform>`, and nothing at the app root is
 * adaptv's to take.
 *
 * `capAddIfMissing` used to adopt an `ios/` or `android/` found at the app root — rename it
 * into `.adaptv/`, purge its build caches, and print a notice — as a one-time migration from
 * a layout adaptv itself once scaffolded. adaptv is unpublished, so no install anywhere has
 * that layout, and a migration for it is a compatibility shim the repo says it does not carry
 * (`cli-parse.mjs`: "No migration path for a renamed command, deliberately";
 * `app-config.ts` `ROUTER_BUILD_KEYS`: "adaptv carries no compatibility shims"). Worse than
 * dead: a dev with their OWN `ios/` directory — a separate native project, a folder of
 * screenshots — had it moved into a git-ignored directory on their first `adaptv dev ios`.
 *
 * The scaffold path is reached by making adaptv's own platform package unresolvable, which
 * is the first thing that path checks and the one failure it can raise without spawning a
 * native toolchain. That the call REJECTS there is the proof the branch ran: the old code
 * returned early, after the rename, and never got this far.
 */

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createRequire: () => ({
      resolve: () => {
        throw new Error("MODULE_NOT_FOUND")
      },
    }),
  }
})

const { capAddIfMissing, ownInstallMissingPlatform } = await import(
  "./native.mjs"
)

describe("capAddIfMissing — the app root is the dev's", () => {
  const roots = []
  afterEach(() => {
    for (const r of roots.splice(0))
      rmSync(r, { recursive: true, force: true })
  })

  it.each(["ios", "android"])(
    "leaves an app-root %s/ exactly where the dev put it",
    async (platform) => {
      const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-scaffold-"))
      roots.push(appRoot)
      const theirs = path.join(appRoot, platform, "App")
      mkdirSync(theirs, { recursive: true })
      writeFileSync(path.join(theirs, "theirs.txt"), "not adaptv's\n")

      await expect(
        capAddIfMissing(appRoot, platform, process.env),
      ).rejects.toThrow(ownInstallMissingPlatform(platform))

      expect(existsSync(path.join(theirs, "theirs.txt"))).toBe(true)
      expect(existsSync(path.join(appRoot, ".adaptv", platform))).toBe(
        false,
      )
    },
  )
})
