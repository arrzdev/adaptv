// @vitest-environment node
import { describe, expect, it } from "vitest"
import { explainFailure, toolErrorParts } from "./explain.mjs"
import { namesPlumbing } from "./opacity.mjs"

/**
 * The opacity boundary, enforced on the only path that ever crossed it.
 *
 * A consumer writes `adaptv.config.ts` and imports from `@arrzdev/adaptv`. They are never told
 * that TanStack Router, TanStack Start or Capacitor are underneath (`docs/design/cli-contract.md` R8, `docs/decisions/register.md` L20).
 * That held for as long as failures were worded by hand, and broke the moment one was taught
 * to lift the real cause out of captured tool output onto the `✖` line: the real cause was
 * `Cannot find module 'tanstack-start-injected-head-scripts:v'`, and it shipped.
 *
 * Every fixture below is REAL output, captured from the failure it is named after. A rule
 * checked against invented strings only ever proves the invention was well-formed.
 */

/** Captured verbatim from `vite` stderr, playground frontend, 2026-08-07. */
const TANSTACK_SSR_500 = [
  "Error: Cannot find module 'tanstack-start-injected-head-scripts:v' imported from '/Users/arrz/Documents/Github/adaptv/playground/node_modules/.pnpm/@tanstack+start-server-core@1.167.7/node_modules/@tanstack/start-server-core/dist/esm/router-manifest.js'",
  "cause: Error: Cannot find module 'tanstack-start-injected-head-scripts:v' imported from '/Users/arrz/Documents/Github/adaptv/playground/node_modules/.pnpm/@tanstack+start-server-core@1.167.7/node_modules/@tanstack/start-server-core/dist/esm/router-manifest.js'",
].join("\n")

/** The shape `devServerUnhealthy` builds for a 500 whose cause is inside adaptv's own graph. */
const internalDevServerFailure = () => {
  const err = new Error("the app did not render")
  err.fix = [
    "every request to http://localhost:41730 answered 500 for 30s.",
    "a module adaptv needs could not be resolved. Reinstall dependencies, then run again.",
  ]
  err.tail = TANSTACK_SSR_500
  return err
}

describe("the opacity boundary holds on the ✖ line", () => {
  it("never names an engine, however loudly the tool does", () => {
    const { reason, detail } = explainFailure("web")(
      internalDevServerFailure(),
    )
    //The assertion that matters: not "it says the right thing" but "it cannot say the wrong
    //one". Both halves, because the first fix put the package in `detail` after getting
    //`reason` right.
    expect(namesPlumbing(reason)).toBe(false)
    for (const line of detail) expect(namesPlumbing(line)).toBe(false)
  })

  it("falls back to adaptv's own sentence, not to silence", () => {
    //A blanked reason would be the other way to fail: the ✖ has to say something, and the
    //thrower's message is adaptv's words about adaptv's failure, which is always safe.
    const { reason, detail } = explainFailure("web")(
      internalDevServerFailure(),
    )
    expect(reason).toBe("the app did not render")
    expect(detail).toContain(
      "every request to http://localhost:41730 answered 500 for 30s.",
    )
    expect(detail).toContain(
      "a module adaptv needs could not be resolved. Reinstall dependencies, then run again.",
    )
  })

  it("prints no absolute path and no store path", () => {
    const { reason, detail } = explainFailure("web")(
      internalDevServerFailure(),
    )
    for (const line of [reason, ...detail]) {
      expect(line).not.toMatch(/\/Users\//)
      expect(line).not.toMatch(/node_modules/)
    }
  })
})

describe("the dev's OWN errors still reach them in full", () => {
  it("keeps a compiler error and splits its locator off the reason", () => {
    //Opacity must not become a gag. This is the dev's code and every word of it is theirs.
    const err = new Error("xcodebuild exited with code 65")
    err.tail =
      "/Users/arrz/app/ios/App/AppDelegate.swift:54:32: error: cannot convert value of type 'String' to specified type 'Int'"
    const { reason, detail } = explainFailure("ios")(err)
    expect(reason).toBe(
      "cannot convert value of type 'String' to specified type 'Int'",
    )
    expect(detail).toContain("at AppDelegate.swift:54:32")
  })

  it("keeps a resolution failure in the app's own source", () => {
    const err = new Error("the app did not render")
    err.fix = [
      "every request to http://localhost:41730 answered 500 for 30s.",
    ]
    err.tail =
      "Error: Cannot find module './lib/totals' imported from '/Users/arrz/app/src/routes/cart.tsx'"
    const { reason } = explainFailure("web")(err)
    expect(reason).toBe("Cannot find module './lib/totals'")
  })
})

describe("toolErrorParts", () => {
  it("carries no importer for an ESM resolution failure", () => {
    //The importer WAS carried, as its package, which is exactly how
    //`at @tanstack/start-server-core/dist/esm/router-manifest.js` reached a user's terminal.
    const { message, where } = toolErrorParts(
      "Error: Cannot find module 'x:v' imported from '/a/node_modules/@tanstack/start-server-core/i.js'",
    )
    expect(message).toBe("Cannot find module 'x:v'")
    expect(where).toBe("")
  })

  it("still splits a clang/swift locator", () => {
    const { message, where } = toolErrorParts(
      "/a/b/Foo.swift:12:3: error: use of unresolved identifier 'bar'",
    )
    expect(message).toBe("use of unresolved identifier 'bar'")
    expect(where).toBe("Foo.swift:12:3")
  })
})

describe("a busy port is unchanged by any of this", () => {
  it("still reads as the port and its fix", () => {
    const err = new Error("vite dev exited (code 1) before it was ready")
    err.tail =
      "Error: listen EADDRINUSE: address already in use 0.0.0.0:41730"
    const { reason, detail } = explainFailure("web")(err)
    expect(reason).toBe("port 41730 is already in use")
    expect(detail.length).toBeGreaterThan(0)
  })
})

/**
 * Captured verbatim from `xcodebuild … -destination id=<a booted simulator> build`, macOS,
 * Xcode 26.1.1, 2026-08-29 — the run behind R61. Every iOS destination on the machine is
 * ineligible because the platform Xcode wants was never downloaded, and xcodebuild answers
 * with an inventory instead of a sentence.
 */
const NO_IOS_PLATFORM = [
  "xcodebuild: error: Unable to find a destination matching the provided destination specifier:",
  "\t\t{ id:74B38563-076B-42D6-A5C3-FC96ABEB7CA8 }",
  '\tIneligible destinations for the "App" scheme:',
  "\t\t{ platform:iOS, arch:arm64e, id:00008140-001615581A10801C, name:iPhone de arrz, error:iOS 26.1 is not installed. Please download and install the platform from Xcode > Settings > Components. }",
  "\t\t{ platform:iOS, id:dvtdevice-DVTiPhonePlaceholder-iphoneos:placeholder, name:Any iOS Device, error:iOS 26.1 is not installed. Please download and install the platform from Xcode > Settings > Components. }",
].join("\n")

describe("an iOS build with no platform to build against (R61)", () => {
  it("says what is missing, not which destination specifier missed", () => {
    const err = new Error("xcodebuild exited with code 70")
    err.tail = NO_IOS_PLATFORM
    const { reason, detail } = explainFailure("ios")(err)
    expect(reason).toBe("Xcode is missing the iOS 26.1 platform")
    //The fix has to be a command, not a diagnosis — this one is a several-GB download the
    //dev has to start themselves.
    expect(detail.join(" ")).toContain(
      "'xcodebuild -downloadPlatform iOS'",
    )
  })

  it("answers the question the dev is actually left with", () => {
    //They picked that simulator off a list adaptv printed seconds earlier. Nothing else on
    //screen says the list was right and the build still could not run.
    const err = new Error("xcodebuild exited with code 70")
    err.tail = NO_IOS_PLATFORM
    const { detail } = explainFailure("ios")(err)
    expect(detail.join(" ")).toContain("simulators still boot")
  })

  it("never prints the inventory it read that from", () => {
    const err = new Error("xcodebuild exited with code 70")
    err.tail = NO_IOS_PLATFORM
    const { reason, detail } = explainFailure("ios")(err)
    for (const line of [reason, ...detail])
      expect(line).not.toContain("{ platform:")
  })

  it("still names the gap when the wording is one adaptv has never seen", () => {
    //The guard that matters long-term: a future Xcode can reword the headline and the
    //inventory is STILL not the failure detail — every record carries `error:`, so without
    //the filter they are exactly what the generic pass would pick.
    const err = new Error("xcodebuild exited with code 70")
    err.tail = [
      "xcodebuild: error: something no recogniser here has met yet",
      "\t\t{ platform:iOS, arch:arm64e, id:00008140-001615581A10801C, name:iPhone de arrz, error:some future wording. }",
    ].join("\n")
    const { reason, detail } = explainFailure("ios")(err)
    expect(reason).toBe("something no recogniser here has met yet")
    for (const line of detail) expect(line).not.toContain("{ platform:")
  })
})
