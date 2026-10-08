// @vitest-environment node
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { exec } from "./exec.mjs"
import {
  explainFailure,
  toolErrorParts,
  withoutAbsolutePaths,
} from "./explain.mjs"
import { namesPlumbing } from "./opacity.mjs"
import { runLine } from "./render.mjs"
import { errorTail } from "./tool-log.mjs"

/**
 * The opacity boundary, enforced on the only path that ever crossed it.
 *
 * A consumer writes `adaptv.config.ts` and imports from `adaptv`. They are never told
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

/**
 * Captured verbatim from `vite build` stderr on a playground copy, 2026-09-02, with
 * `router: { routesDirectory: 42 }`. `appConfigErrors` refuses that value now, before the
 * build; the SHAPE is what any crash inside the plugin prints, and it is the shape that lost
 * the ✖ line to `error during build:` — the trailer above it, which says nothing.
 */
const VITE_TYPEERROR = [
  "error during build:",
  'TypeError [ERR_INVALID_ARG_TYPE]: The "paths[2]" argument must be of type string. Received type number (42)',
  "    at Object.resolve (node:path:1257:7)",
  "    at resolveRoutesDir (file:///Users/arrz/Documents/Github/adaptv/.claude/worktrees/playground-repo-cleanup-8e176e/src/vite/route-tints-module.ts:23:15)",
  "    at adaptv (file:///Users/arrz/Documents/Github/adaptv/.claude/worktrees/playground-repo-cleanup-8e176e/src/vite/adaptv-plugin.ts:192:21)",
  "    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)",
  "    at async Promise.all (index 0)",
  "    at async asyncFlatten (file:///Users/arrz/Documents/Github/adaptv/.claude/worktrees/playground-repo-cleanup-8e176e/node_modules/.pnpm/vite@8.0.11_@types+node@26.1.1_esbuild@0.28.0_jiti@2.7.0_terser@5.49.0/node_modules/vite/dist/node/chunks/node.js:2348:10)",
  "  code: 'ERR_INVALID_ARG_TYPE'",
  "}",
]

/**
 * Same capture, same day, with `styles` removed: the sentence `src/vite/app-config-errors.ts`
 * writes, thrown from the plugin's config hook and printed by the tool with its own `Error:`
 * in front and adaptv's `[adaptv]` tag behind it.
 */
const VITE_CONFIG_REFUSED = [
  "error during build:",
  "Error: [adaptv] adaptv.config.ts: 'styles' must be a path to the app's stylesheet, got undefined",
  "    at loadAppConfig (file:///Users/arrz/Documents/Github/adaptv/.claude/worktrees/playground-repo-cleanup-8e176e/src/vite/app-config-loader.ts:62:11)",
  "    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)",
  "    at async adaptv (file:///Users/arrz/Documents/Github/adaptv/.claude/worktrees/playground-repo-cleanup-8e176e/src/vite/adaptv-plugin.ts:118:20)",
  "    at async Promise.all (index 0)",
]

/** What `exec` hands the explainer: the captured stream, narrowed by `errorTail`. */
const buildFailure = (captured) => {
  const err = new Error("vite build exited with code 1")
  err.tail = errorTail(captured).join("\n")
  return err
}

/**
 * The shape `vite build` prints when an adaptv plugin refuses a module with `this.error()`
 * (`src/vite/engine-imports.ts`), captured 2026-10-05 from a created app. The bundler's count
 * sits above the plugin's sentence and says `error:`, so it was the whole ✖ line:
 * `✖ web  Build failed with 1 error:`. The engine-naming lines below it are the dev's own
 * import and its caret frame, which the opacity filter keeps off the CLI.
 */
const VITE_PLUGIN_REFUSED = [
  "✗ Build failed in 4.72s",
  "error during build:",
  "Build failed with 1 error:",
  "[plugin adaptv:engine-imports] /w/my-app/src/routing/pages/home.page.tsx:1:26",
  "RolldownError: src/routing/pages/home.page.tsx imports a package missing from the app's package.json — add it there, or import from an adaptv subpath.",
  'The import is "@tanstack/react-router". adaptv\'s own dependencies are not part of the app.',
  '1: import { useRouter } from "@tanstack/react-router"',
]

describe("a plugin's refusal of a web build names itself on the ✖ line", () => {
  it("puts the plugin's sentence on the ✖, not the bundler's error count", () => {
    const { reason } = explainFailure(
      "web",
      "/w/my-app",
    )(buildFailure(VITE_PLUGIN_REFUSED))
    expect(reason).toBe(
      "src/routing/pages/home.page.tsx imports a package missing from the app's package.json — add it there, or import from an adaptv subpath.",
    )
  })
})

describe("a crash inside the web build names itself on the ✖ line", () => {
  it("puts the TypeError's sentence on the ✖, not the trailer above it", () => {
    //Through `errorTail` deliberately: the line was lost twice, once by the tail filter
    //and once by the pick here, and both had the same missing word boundary.
    const { reason, detail } = explainFailure("web")(
      buildFailure(VITE_TYPEERROR),
    )
    expect(reason).toBe(
      'The "paths[2]" argument must be of type string. Received type number (42)',
    )
    expect(detail).toEqual([])
  })

  it("says the config sentence as adaptv's own, file first, no tag", () => {
    const { reason, detail } = explainFailure("web")(
      buildFailure(VITE_CONFIG_REFUSED),
    )
    expect(reason).toBe(
      "adaptv.config.ts: 'styles' must be a path to the app's stylesheet, got undefined",
    )
    expect(detail).toEqual([])
  })

  it("prints no absolute path and no engine on either", () => {
    for (const captured of [VITE_TYPEERROR, VITE_CONFIG_REFUSED]) {
      const { reason, detail } = explainFailure("web")(
        buildFailure(captured),
      )
      for (const line of [reason, ...detail]) {
        expect(line).not.toMatch(/\/Users\//)
        expect(namesPlumbing(line)).toBe(false)
      }
    }
  })
})

describe("toolErrorParts", () => {
  it("strips an error's class and code, and adaptv's own tag", () => {
    expect(
      toolErrorParts("TypeError [ERR_INVALID_ARG_TYPE]: The x argument")
        .message,
    ).toBe("The x argument")
    expect(
      toolErrorParts("TypeError: Cannot read properties").message,
    ).toBe("Cannot read properties")
    expect(toolErrorParts("[adaptv] Error: no routes").message).toBe(
      "no routes",
    )
    expect(
      toolErrorParts("Error: [adaptv] adaptv.config.ts: 'x' must be y")
        .message,
    ).toBe("adaptv.config.ts: 'x' must be y")
  })

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

//Built rather than written as a literal: a raw ESC inside a regex trips
//lint/suspicious/noControlCharactersInRegex.
const ESC_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")

/**
 * The row a failed lane actually settles on, from both streams, colour stripped — the step
 * run through `runLine` with this explainer, the way every native lane is. The assertions
 * below are about what the dev READS, and a `{ reason }` object is not that.
 */
async function renderedFailure(label, err, appRoot) {
  const lines = []
  const take = (s) => {
    lines.push(...String(s).replace(ESC_SGR, "").split("\n"))
    return true
  }
  const spies = [
    vi.spyOn(process.stdout, "write").mockImplementation(take),
    vi.spyOn(process.stderr, "write").mockImplementation(take),
  ]
  try {
    await runLine(
      label,
      async () => {
        throw err
      },
      { explain: explainFailure(label, appRoot) },
    ).catch(() => {})
  } finally {
    for (const s of spies) s.mockRestore()
  }
  const at = lines.findIndex((l) => l.includes("✖"))
  return {
    row: lines[at] ?? "",
    detail: lines
      .slice(at + 1)
      .map((l) => l.trim())
      .filter(Boolean),
  }
}

const glyphs = (row) => row.split("✖").length - 1

/**
 * Captured from the native CLI's own task chain and logger — its `runTask`, `runCommand`,
 * `fatal` and `logger.error`, the path `run ios` takes — spawned through adaptv's `exec` and
 * narrowed by `errorTail`, 2026-09-13. The runner's framing is its real bytes; the xcodebuild
 * body inside it is xcodebuild-SHAPED (a run-script phase failure), since no native build ran.
 */
const CAP_RUN_XCODEBUILD_FAILED = [
  "✖ Running xcodebuild - failed!",
  "        Command PhaseScriptExecution failed with a nonzero exit code",
  "        ** BUILD FAILED **",
  "        The following build commands failed:",
  "        PhaseScriptExecution [CP]\\ Embed\\ Pods\\ Frameworks /Users/arrz/Library/Developer/Xcode/DerivedData/App-gqzbvkdqcbzjtcfdzgtmbnaaaqyb/Build/Intermediates.noindex/App.build/Debug-iphonesimulator/App.build/Script-9592DBEFFC6D2A0C8D5DEB22.sh (in target 'App' from project 'App')",
  "        (1 failure)",
].join("\n")

const capRunFailed = (tail) => {
  const err = new Error(
    "node cap.mjs run ios --no-sync exited with code 1",
  )
  err.tail = tail
  return err
}

describe("a native runner's own verdict is not the reason (R2)", () => {
  it("settles a failed iOS run on ONE failure mark and the tool's sentence", async () => {
    const { row } = await renderedFailure(
      "ios",
      capRunFailed(CAP_RUN_XCODEBUILD_FAILED),
    )
    expect(glyphs(row)).toBe(1)
    expect(row).toMatch(
      /✖ ios {2}Command PhaseScriptExecution failed with a nonzero exit code · \d+ms$/,
    )
  })

  it("never puts the runner's verdict in the detail either", async () => {
    const { detail } = await renderedFailure(
      "ios",
      capRunFailed(CAP_RUN_XCODEBUILD_FAILED),
    )
    for (const line of detail) {
      expect(line).not.toContain("- failed!")
      expect(glyphs(line)).toBe(0)
    }
  })

  it("says which step failed when the verdict is all the tail holds", async () => {
    const { row } = await renderedFailure(
      "ios",
      capRunFailed("✖ Running xcodebuild - failed!"),
    )
    expect(glyphs(row)).toBe(1)
    expect(row).toMatch(/✖ ios {2}xcodebuild failed · \d+ms$/)
  })

  it("does not settle a failure on a step that passed, nor on a log tag", async () => {
    //No line here says `error:`, so the pick falls back to the raw tail — which is where a
    //passing step's verdict, and the logger's `[error]` tag, would have been lifted from.
    const { row } = await renderedFailure(
      "android",
      capRunFailed(
        [
          "✔ Copying web assets from web to android/app/src/main/assets/public in 12.34ms",
          "[error] The web assets directory must contain an index.html file.",
        ].join("\n"),
      ),
    )
    expect(row).toMatch(
      /✖ android {2}The web assets directory must contain an index\.html file\. · \d+ms$/,
    )
  })
})

/**
 * xcodebuild-SHAPED, from `build ios` (xcodebuild run directly on `.adaptv/ios`) with the pods
 * never installed: the reason names the file list by its absolute path, spaces unescaped inside
 * quotes. Laid out as `errorTail` leaves it; no native build ran to capture it.
 */
const APP_ROOT = "/Users/arrz/Documents/Github/chopchop"
const XCODEBUILD_FILE_LIST = [
  `error: Unable to load contents of file list: '${APP_ROOT}/.adaptv/ios/App/Pods/Target Support Files/Pods-App/Pods-App-frameworks-Release-input-files.xcfilelist' (in target 'App' from project 'App')`,
].join("\n")

describe("a tool's paths reach the page app-root-relative or not at all (R9)", () => {
  it("names a file under the app the way an artifact row does", async () => {
    const err = new Error("xcodebuild exited with code 65")
    err.tail = XCODEBUILD_FILE_LIST
    const { row } = await renderedFailure("ios", err, APP_ROOT)
    expect(row).toContain(
      "Unable to load contents of file list: '.adaptv/ios/App/Pods/Target Support Files/Pods-App/Pods-App-frameworks-Release-input-files.xcfilelist'",
    )
    expect(row).not.toContain("/Users/")
  })

  it("cuts a DerivedData path outside the app to its file name", async () => {
    const { row, detail } = await renderedFailure(
      "ios",
      capRunFailed(CAP_RUN_XCODEBUILD_FAILED),
      APP_ROOT,
    )
    for (const line of [row, ...detail])
      expect(line).not.toMatch(/\/Users\//)
    expect(detail).toContain(
      "PhaseScriptExecution [CP]\\ Embed\\ Pods\\ Frameworks Script-9592DBEFFC6D2A0C8D5DEB22.sh (in target 'App' from project 'App')",
    )
  })

  //A dev server's module id, a route, an API path and a regex all start with `/` and are the
  //dev's own words about their app. Cutting them to a last segment made one of them false.
  it.each([
    [
      "a dev server's module id",
      "Error: Failed to load url /src/routes/cart.tsx (resolved id: /src/routes/cart.tsx)",
      "Failed to load url /src/routes/cart.tsx (resolved id: /src/routes/cart.tsx)",
    ],
    [
      "a route",
      "Error: No route matched /products/featured/42",
      "No route matched /products/featured/42",
    ],
    [
      "an API path",
      "Error: GET /api/orders/7 returned 500",
      "GET /api/orders/7 returned 500",
    ],
    [
      "a regex literal",
      "Error: the 'include' pattern /^foo$/g matched no files",
      "the 'include' pattern /^foo$/g matched no files",
    ],
    [
      "a route under a Linux root's name",
      "Error: No route matched /home/feed/3",
      "No route matched /home/feed/3",
    ],
    [
      "an API path under a Linux root's name",
      "Error: GET /dev/tools/1 500",
      "GET /dev/tools/1 500",
    ],
  ])(
    "leaves %s whole, since it is not a file on disk",
    async (_, tail, reason) => {
      const err = new Error("vite build exited with code 1")
      err.tail = tail
      const { row } = await renderedFailure("web", err, APP_ROOT)
      expect(row).toContain(`✖ web  ${reason} · `)
    },
  )

  it("keeps a locator's line and column and a URL whole", () => {
    expect(
      withoutAbsolutePaths(
        `${APP_ROOT}/ios/App/App/AppDelegate.swift:54:32: warning: x`,
        APP_ROOT,
      ),
    ).toBe("ios/App/App/AppDelegate.swift:54:32: warning: x")
    expect(
      withoutAbsolutePaths(
        "every request to http://localhost:41730/cart answered 500",
        APP_ROOT,
      ),
    ).toBe("every request to http://localhost:41730/cart answered 500")
    expect(
      withoutAbsolutePaths(
        `at run (file://${APP_ROOT}/src/vite/plugin.ts:23:15)`,
        APP_ROOT,
      ),
    ).toBe("at run (src/vite/plugin.ts:23:15)")
  })
})

/** Same capture as {@link CAP_RUN_XCODEBUILD_FAILED}: the runner spawning a `./gradlew` with no exec bit. */
const CAP_RUN_GRADLEW_EACCES = [
  "✖ Running Gradle build - failed!",
  "[error] Command error. Error: spawn ./gradlew EACCES",
].join("\n")

describe("a gradle wrapper that cannot be started says so, and what to do", () => {
  const roots = []
  afterEach(() => {
    for (const dir of roots.splice(0))
      rmSync(dir, { recursive: true, force: true })
  })

  /** A real `.adaptv/android/gradlew` without its exec bit, spawned the way `build android` does. */
  async function spawnLockedWrapper(parent = tmpdir()) {
    const appRoot = mkdtempSync(path.join(parent, "adaptv-gradlew-"))
    roots.push(appRoot)
    const android = path.join(appRoot, ".adaptv", "android")
    mkdirSync(android, { recursive: true })
    writeFileSync(path.join(android, "gradlew"), "#!/bin/sh\nexit 0\n")
    chmodSync(path.join(android, "gradlew"), 0o644)
    const err = await exec(
      path.join(android, "gradlew"),
      ["assembleDebug"],
      {
        cwd: android,
      },
    ).catch((e) => e)
    return { appRoot, err }
  }

  it("names the file, relative to the app, as not executable", async () => {
    const { appRoot, err } = await spawnLockedWrapper()
    const { row } = await renderedFailure("android", err, appRoot)
    expect(row).toMatch(
      /✖ android {2}\.adaptv\/android\/gradlew is not executable · \d+ms$/,
    )
  })

  it("carries the action that still works when adaptv could not restore it", async () => {
    const { appRoot, err } = await spawnLockedWrapper()
    const { detail } = await renderedFailure("android", err, appRoot)
    expect(detail).toEqual([
      "Delete .adaptv/android and run again. adaptv regenerates it.",
    ])
  })

  it("names it the same when the app lives under a directory with a space", async () => {
    //Node does not quote the path in `spawn <file> EACCES`, and `My Apps` or iCloud's
    //`Mobile Documents` is an ordinary place for an app to be.
    const parent = mkdtempSync(path.join(tmpdir(), "adaptv-My Apps-"))
    roots.push(parent)
    const { appRoot, err } = await spawnLockedWrapper(parent)
    expect(appRoot).toContain(" ")
    const { row, detail } = await renderedFailure("android", err, appRoot)
    expect(row).toMatch(
      /✖ android {2}\.adaptv\/android\/gradlew is not executable · \d+ms$/,
    )
    expect(detail).toEqual([
      "Delete .adaptv/android and run again. adaptv regenerates it.",
    ])
  })

  it("reads the same through the native runner, which spawns it as ./gradlew", async () => {
    const err = new Error(
      "node cap.mjs run android --no-sync exited with code 1",
    )
    err.tail = CAP_RUN_GRADLEW_EACCES
    const { row, detail } = await renderedFailure("android", err, APP_ROOT)
    expect(glyphs(row)).toBe(1)
    expect(row).toMatch(
      /✖ android {2}\.adaptv\/android\/gradlew is not executable · \d+ms$/,
    )
    expect(detail).toEqual([
      "Delete .adaptv/android and run again. adaptv regenerates it.",
    ])
  })
})
