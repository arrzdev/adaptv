// Real lines, copied from actual xcodebuild / gradle / CocoaPods runs against the
// project-zero harness — the point of this suite is that the mapping keeps working on what
// the tools ACTUALLY print, not on a tidied-up idea of it.
import { describe, expect, it } from "vitest"
import {
  errorTail,
  gradleCause,
  isRawToolNoise,
  phaseLabel,
} from "./tool-log.mjs"

describe("phaseLabel — xcodebuild", () => {
  it("says what a compile step means, not how it was invoked", () => {
    expect(
      phaseLabel(
        "CompileSwift normal arm64 /Users/x/app/.adaptv/ios/App/App/AppDelegate.swift (in target 'App' from project 'App')",
      ),
    ).toBe("compiling")
  })

  it("names the subject only when it isn't the app's own target", () => {
    // every Pods target is a different plugin — worth saying which one
    expect(
      phaseLabel(
        "CompileC /Users/x/o/CDVPlugin.o normal arm64 objective-c (in target 'CapacitorCordova' from project 'Pods')",
      ),
    ).toBe("compiling · CapacitorCordova")
    // the app's own target repeats on every line — wallpaper
    expect(
      phaseLabel(
        "Ld /Users/x/Build/App normal (in target 'App' from project 'App')",
      ),
    ).toBe("linking")
  })

  it("maps the long tail of step verbs", () => {
    const cases = [
      [
        "CodeSign /Users/x/App.app (in target 'App' from project 'App')",
        "signing",
      ],
      [
        "PhaseScriptExecution [CP]\\ Copy\\ Pods\\ Resources /Users/x/script.sh (in target 'App' from project 'App')",
        "running build script",
      ],
      [
        "ProcessInfoPlistFile /Users/x/Info.plist /Users/x/Other-Info.plist (in target 'App' from project 'App')",
        "processing resources",
      ],
      [
        "GenerateDSYMFile /Users/x/App.app.dSYM /Users/x/App (in target 'App' from project 'App')",
        "generating debug symbols",
      ],
      [
        "CompileAssetCatalog /Users/x/App.app /Users/x/Assets.xcassets (in target 'App' from project 'App')",
        "compiling assets",
      ],
    ]
    for (const [line, want] of cases) expect(phaseLabel(line)).toBe(want)
  })

  it("shows nothing for bookkeeping steps and banners", () => {
    expect(
      phaseLabel("CreateBuildDirectory /Users/x/Build/Products"),
    ).toBe("")
    expect(
      phaseLabel(
        "Touch /Users/x/App.app (in target 'App' from project 'App')",
      ),
    ).toBe("")
    expect(
      phaseLabel("WriteAuxiliaryFile /Users/x/App.LinkFileList"),
    ).toBe("")
    expect(phaseLabel("** BUILD SUCCEEDED **")).toBe("")
  })
})

describe("phaseLabel — gradle & CocoaPods", () => {
  it("passes a gradle task name through as the phase", () => {
    expect(phaseLabel("> Task :app:mergeDebugResources")).toBe(
      "gradle · mergeDebugResources",
    )
    expect(
      phaseLabel("> Task :app:compileDebugJavaWithJavac UP-TO-DATE"),
    ).toBe("gradle · compileDebugJavaWithJavac")
    expect(phaseLabel("> Configure project :capacitor-android")).toBe(
      "gradle · configuring",
    )
  })

  it("names the pod being installed", () => {
    expect(phaseLabel("Installing Capacitor (8.4.2)")).toBe(
      "installing pods · Capacitor",
    )
    expect(phaseLabel("Installing CapacitorHaptics (8.0.3)")).toBe(
      "installing pods · CapacitorHaptics",
    )
    expect(phaseLabel("Analyzing dependencies")).toBe("analyzing pods")
    expect(phaseLabel("Pod installation complete! 12 dependencies")).toBe(
      "",
    )
  })
})

describe("phaseLabel — unknown lines", () => {
  it("returns null so the caller's generic prettifier still gets a turn", () => {
    expect(phaseLabel("copying web assets")).toBeNull()
    expect(phaseLabel("✔ update ios in 1.2s")).toBeNull()
  })
})

describe("isRawToolNoise", () => {
  it("catches unrecognised lines that are really just paths", () => {
    expect(
      isRawToolNoise(
        "SomeNewXcodeStep /Users/arrz/Documents/Github/p/.adaptv/ios/DerivedData/x/Info.plist",
      ),
    ).toBe(true)
  })

  it("does not mistake a URL for a filesystem path", () => {
    // the dev-server line is reported through the same pipe — killing it would blank the
    // one piece of information a `dev` run exists to give you.
    expect(isRawToolNoise("http://localhost:5173 · warming")).toBe(false)
    expect(
      isRawToolNoise("copy web assets to android/app/src/main/assets"),
    ).toBe(false)
  })
})

describe("errorTail", () => {
  it("prefers the lines that name the error over trailing chatter", () => {
    const lines = [
      "CompileSwift normal arm64 /Users/x/A.swift",
      "/Users/x/AppDelegate.swift:54:32: error: cannot convert value of type 'String' to specified type 'Int'",
      "SwiftCompile normal arm64 /Users/x/B.swift",
      "** BUILD FAILED **",
    ]
    expect(errorTail(lines)).toEqual([
      "/Users/x/AppDelegate.swift:54:32: error: cannot convert value of type 'String' to specified type 'Int'",
      "** BUILD FAILED **",
    ])
  })

  it("keeps a CocoaPods sandbox mismatch, which is the whole diagnosis", () => {
    const lines = [
      "note: Using new build system",
      "error: The sandbox is not in sync with the Podfile.lock. Run 'pod install'.",
      "** BUILD FAILED **",
    ]
    expect(errorTail(lines)[0]).toContain("sandbox is not in sync")
  })

  it("drags gradle's cause in behind its header, even when it says neither error nor failed", () => {
    const lines = [
      "> Configure project :app",
      "FAILURE: Build failed with an exception.",
      "* What went wrong:",
      "Could not find method compile() for arguments [x]",
      "on object of type DefaultDependencyHandler.",
    ]
    expect(errorTail(lines)).toContain(
      "Could not find method compile() for arguments [x]",
    )
  })

  it("ignores an error COUNT — it wins the race against the real diagnostic", () => {
    const lines = [
      "1 error generated.",
      "/Users/x/a.m:3:1: error: expected ';'",
    ]
    expect(errorTail(lines)).toEqual([
      "/Users/x/a.m:3:1: error: expected ';'",
    ])
  })

  it("falls back to the raw tail rather than reporting nothing", () => {
    const lines = ["something opaque", "and unhelpful"]
    expect(errorTail(lines)).toEqual(lines)
  })

  it("caps the output", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `error: line ${i}`)
    expect(errorTail(lines, 5)).toHaveLength(5)
    expect(errorTail(lines, 5).at(-1)).toBe("error: line 49")
  })
})

describe("gradleCause — the deepest link in gradle's chain", () => {
  const REAL = [
    "> Task :app:checkDebugAarMetadata FAILED",
    "FAILURE: Build failed with an exception.",
    "",
    "* What went wrong:",
    "Execution failed for task ':app:checkDebugAarMetadata'.",
    "> Could not resolve all files for configuration ':app:debugRuntimeClasspath'.",
    "   > Could not find dev.arrz.doesnot:exist:1.2.3.",
    "",
    "* Try:",
    "> Run with --stacktrace option to get the stack trace.",
    "BUILD FAILED in 2s",
  ]

  it("reports the actionable cause, not the task that failed", () => {
    expect(gradleCause(REAL)).toBe(
      "Could not find dev.arrz.doesnot:exist:1.2.3.",
    )
  })

  it("stops at `* Try:` so advice never wins over the cause", () => {
    expect(gradleCause(REAL)).not.toMatch(/--stacktrace/)
  })

  it("falls back to the sentence when there is no `>` chain", () => {
    expect(
      gradleCause([
        "* What went wrong:",
        "Could not compile build file '/x/build.gradle'.",
        "",
        "* Try:",
      ]),
    ).toBe("Could not compile build file '/x/build.gradle'.")
  })

  it("is null for non-gradle output, so xcodebuild keeps its own path", () => {
    expect(
      gradleCause([
        "AppDelegate.swift:6:35: error: bad",
        "** BUILD FAILED **",
      ]),
    ).toBe(null)
  })
})
