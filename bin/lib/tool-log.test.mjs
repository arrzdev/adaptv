// Real lines, copied from actual xcodebuild / gradle / CocoaPods runs against the
// project-zero harness — the point of this suite is that the mapping keeps working on what
// the tools ACTUALLY print, not on a tidied-up idea of it.
import { describe, expect, it } from "vitest"
import {
  errorTail,
  gradleCause,
  isDestinationEntry,
  isRawToolNoise,
  phaseLabel,
  portInUse,
} from "./tool-log.mjs"

describe("phaseLabel — xcodebuild", () => {
  it("says what a compile step means, not how it was invoked", () => {
    expect(
      phaseLabel(
        "CompileSwift normal arm64 /Users/x/app/.adaptv/ios/App/App/AppDelegate.swift (in target 'App' from project 'App')",
      ),
    ).toBe("compiling")
  })

  it("says what is happening, never what it is happening to", () => {
    //The subject used to be appended (`compiling · CapacitorCordova`), so the live line
    //changed on every pod: 91 distinct phases and 140 rewrites in one 13s build. A phase
    //names the activity; `--verbose` is where the roll call lives.
    expect(
      phaseLabel(
        "CompileC /Users/x/o/CDVPlugin.o normal arm64 objective-c (in target 'CapacitorCordova' from project 'Pods')",
      ),
    ).toBe("compiling")
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
  it("maps a gradle task to the same vocabulary xcodebuild uses", () => {
    //Gradle has hundreds of tasks and used to be echoed verbatim (`gradle ·
    //parseDebugLocalResources`) — a raw camelCase identifier, a new one every few hundred
    //ms. Matching the verb inside the name makes an Android build read like an iOS one.
    expect(phaseLabel("> Task :app:mergeDebugResources")).toBe(
      "processing resources",
    )
    expect(phaseLabel("> Task :app:compileDebugJavaWithJavac")).toBe(
      "compiling",
    )
    expect(phaseLabel("> Task :app:packageDebug")).toBe("packaging")
    expect(phaseLabel("> Task :app:checkDebugAarMetadata")).toBe(
      "checking",
    )
    expect(phaseLabel("> Configure project :capacitor-android")).toBe(
      "configuring",
    )
    //An unknown task still says something honest rather than leaking its name.
    expect(phaseLabel("> Task :app:someFutureAgpTask")).toBe("building")
  })

  it("shows nothing for a gradle task that did no work", () => {
    //R4: the line keeps its last real phase rather than flickering through the dozens of
    //up-to-date tasks gradle walks on an incremental build.
    expect(
      phaseLabel("> Task :app:compileDebugJavaWithJavac UP-TO-DATE"),
    ).toBe("")
    expect(phaseLabel("> Task :app:preBuild NO-SOURCE")).toBe("")
    expect(phaseLabel("> Task :app:mergeDebugAssets FROM-CACHE")).toBe("")
  })

  it("does not name each dependency as it is installed", () => {
    //One line per pod, so the names were the flicker; which dependency is being unpacked
    //is not something a dev acts on.
    expect(phaseLabel("Installing Capacitor (8.4.2)")).toBe(
      "installing dependencies",
    )
    expect(phaseLabel("Installing CapacitorHaptics (8.0.3)")).toBe(
      "installing dependencies",
    )
    expect(phaseLabel("Analyzing dependencies")).toBe(
      "resolving dependencies",
    )
    expect(phaseLabel("Pod installation complete! 12 dependencies")).toBe(
      "",
    )
  })
})

describe("phaseLabel — a crashing tool (R70)", () => {
  it("never lets node's version footer become the phase", () => {
    //THE line. `adaptv build android` with the port ports.ts pins (supervisorPort) taken:
    //vite's prerender step starts its own server, the listen throws, and the tail of the
    //crash dump reached the live row as `⠴ web  node.js v26.0.0` — short, path-free prose,
    //so it passed every filter the rest of the dump tripped only by accident.
    expect(phaseLabel("Node.js v26.0.0")).toBe("")
  })

  it("recognises the rest of the dump by shape, not by punctuation", () => {
    //Verbatim from that run. Each of these was already shown as nothing — but by a bracket,
    //a colon or a length, none of which is a promise. Name them, so the next node release
    //reformatting a frame can't put one back on the row.
    const cases = [
      "node:events:487",
      "      throw er; // Unhandled 'error' event",
      "    at Server.setupListenHandle [as _listen2] (node:net:2008:16)",
      "    at listenInCluster (node:net:2065:12)",
      "    at node:net:2274:7",
      "    at process.processTicksAndRejections (node:internal/process/task_queues:90:21)",
      "Emitted 'error' event on WebSocketServer instance at:",
    ]
    for (const line of cases) expect(phaseLabel(line)).toBe("")
  })

  it("still reports the reason the dump was about", () => {
    //Silencing the dump on the live line must not cost the failure its diagnosis (R13) —
    //the row holds its last real phase, then `fail()` says what a dev can act on.
    expect(
      portInUse(
        "Error: listen EADDRINUSE: address already in use 127.0.0.1:41740",
      )?.msg,
    ).toBe("port 41740 is already in use")
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

  it("keeps a destination inventory, which is the only place the reason is written", () => {
    //Deliberate, and the opposite of what it looks like: these records must NOT be dropped
    //here. The line xcodebuild fails on says only that a specifier missed; the reason a dev
    //can act on ("iOS 26.1 is not installed") lives inside the records, where
    //`explainLaunchFailure` reads it. `explain.mjs` is what stops them being PRINTED (R61).
    const lines = [
      "xcodebuild: error: Unable to find a destination matching the provided destination specifier:",
      "{ platform:iOS, arch:arm64e, id:00008140-001615581A10801C, name:iPhone de arrz, error:iOS 26.1 is not installed. Please download and install the platform from Xcode > Settings > Components. }",
    ]
    expect(errorTail(lines)).toEqual(lines)
  })
})

describe("isDestinationEntry", () => {
  it("matches a record of the inventory and nothing else on the line", () => {
    expect(
      isDestinationEntry(
        "{ platform:iOS, id:dvtdevice-DVTiPhonePlaceholder-iphoneos:placeholder, name:Any iOS Device, error:iOS 26.1 is not installed. }",
      ),
    ).toBe(true)
    //The specifier that missed is printed the same way minus the platform, and a real
    //diagnostic must never be mistaken for the inventory.
    expect(
      isDestinationEntry("{ id:74B38563-076B-42D6-A5C3-FC96ABEB7CA8 }"),
    ).toBe(false)
    expect(
      isDestinationEntry(
        "error: The sandbox is not in sync with the Podfile.lock.",
      ),
    ).toBe(false)
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

describe("portInUse — one sentence for a port, whoever says it", () => {
  it("reads Node's raw EADDRINUSE, taking the port and not an IP octet", () => {
    //What a vite BUILD dies with when a plugin's pinned port is taken — the whole reason
    //`preview all` ever printed `✖ web  listen EADDRINUSE … 127.0.0.1:41720` (R32).
    const found = portInUse(
      "Error: listen EADDRINUSE: address already in use 127.0.0.1:41720",
    )
    expect(found?.msg).toBe("port 41720 is already in use")
    expect(found?.fix.join(" ")).toContain("lsof -nP -iTCP:41720")
  })

  it("reads vite's own sentence, which never says EADDRINUSE", () => {
    //`dev` runs vite with `--strictPort`, and that path reports in prose instead.
    expect(portInUse("Error: Port 7171 is already in use")?.msg).toBe(
      "port 7171 is already in use",
    )
  })

  it("is null for anything else, so a real build error keeps its own reason", () => {
    expect(portInUse("AppDelegate.swift:6:35: error: bad")).toBe(null)
  })
})
