import { afterEach, describe, expect, it, vi } from "vitest"
import { OWN_PHASES } from "../ui/theme.mjs"
import {
  addresses,
  check,
  detail,
  fail,
  flushNotices,
  header,
  nextPhase,
  prettyLine,
  runLanes,
  runLine,
  skip,
  spacer,
} from "./render.mjs"

//Built rather than written as a literal: a raw ESC inside a regex trips
//lint/suspicious/noControlCharactersInRegex.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")

/**
 * Capture what the CLI actually wrote, minus colour — from BOTH streams.
 *
 * Failures go to stderr and everything else to stdout, so a helper watching only stdout would
 * see a `✖` block as silence. These tests are about what the dev READS, and the dev reads both.
 */
function captureOut(fn) {
  const lines = []
  const take = (s) => {
    lines.push(String(s).replace(ANSI, "").trimEnd())
    return true
  }
  const spies = [
    vi.spyOn(process.stdout, "write").mockImplementation(take),
    vi.spyOn(process.stderr, "write").mockImplementation(take),
  ]
  try {
    fn()
  } finally {
    for (const s of spies) s.mockRestore()
  }
  return lines
}

/** {@link captureOut} for work that has to be awaited — `runLine` / `runLanes`. */
async function captureOutAsync(fn) {
  const lines = []
  const take = (s) => {
    lines.push(String(s).replace(ANSI, "").trimEnd())
    return true
  }
  const spies = [
    vi.spyOn(process.stdout, "write").mockImplementation(take),
    vi.spyOn(process.stderr, "write").mockImplementation(take),
  ]
  try {
    await fn()
  } finally {
    for (const s of spies) s.mockRestore()
  }
  return lines
}

/** The notices themselves, without the blank line that closes the block. */
const said = (lines) => lines.filter(Boolean)

afterEach(() => vi.restoreAllMocks())

describe("flushNotices — severity and repetition", () => {
  it("gives every notice the `!` — there is no glyphless severity", () => {
    //R5: a line the CLI meant to say carries the mark. A notice with no glyph read as
    //stray output and left the dev deciding whether an unmarked sentence was a problem;
    //anything that doesn't earn a `!` isn't printed at all (R4).
    const out = captureOut(() =>
      flushNotices([
        "ios launcher icon upscaled from 512px — add a 1024px icon",
        "no icons in ./public/favicons — add one to brand the launcher icon",
      ]),
    )
    expect(out[0]).toContain("!")
    expect(out[1]).toContain("!")
    expect(out[1]).toContain("no icons in ./public/favicons")
  })

  it("prints an app-level fact once, not once per platform", () => {
    //Regression: asset config is discovered per platform, so `build all` printed the
    //same sentence twice — reading as two separate problems when it is one.
    const same =
      "no icons in ./public/favicons — add one to brand the launcher icon"
    const out = captureOut(() => flushNotices([same, same]))
    expect(said(out)).toHaveLength(1)
  })

  it("dedupes each distinct sentence on its own", () => {
    const out = captureOut(() =>
      flushNotices(["same text", "same text", "other", "other"]),
    )
    expect(said(out)).toHaveLength(2)
  })

  it("empties the list so a later flush cannot reprint it", () => {
    //Notices surface next to the step that produced them; a second flush at the end
    //of the run must not repeat them.
    const notices = ["a", "b"]
    captureOut(() => flushNotices(notices))
    expect(notices).toHaveLength(0)
    expect(captureOut(() => flushNotices(notices))).toHaveLength(0)
  })

  it("closes the notices with a blank line, and says nothing when there are none", () => {
    //R33: the `!`s are a BLOCK between the banner and the first step, not loose lines
    //leaning against the run. A flush with nothing to say prints nothing at all —
    //including the gap, which would otherwise push every step down a row on a good app.
    expect(captureOut(() => flushNotices(["one"])).at(-1)).toBe("")
    expect(captureOut(() => flushNotices([]))).toHaveLength(0)
  })
})

describe("spacer — breathing room is asked for, not counted", () => {
  it("does not open a second gap where there is already one", () => {
    //Every block closes with a blank line and the next opens after one, so at each seam
    //two of them ask for the same gap. Counting both put `preview all` two rows below
    //its banner on an app with nothing to warn about.
    captureOut(() => header("preview all"))
    expect(captureOut(() => spacer())).toHaveLength(0)
    //…and after real output it still separates.
    captureOut(() => skip("web", "cached"))
    expect(captureOut(() => spacer())).toHaveLength(1)
  })
})

describe("fail — the timeless ✖ opens with the same `·` every other row does", () => {
  it("puts a `·` between the label and the reason", () => {
    //R25/R31: `·` introduces a row's right-hand side when nothing precedes it — the same
    //dot `✓ web  · 3.9s` and `✓ ios  · cached` open with. Without it the ✖ started one
    //column left of every neighbour, and settling a surface then failing it read ragged.
    const out = captureOut(() =>
      fail(
        "web",
        "listen EADDRINUSE: address already in use 127.0.0.1:41720",
      ),
    )
    expect(out[0]).toMatch(
      /✖ web {2}· listen EADDRINUSE: address already in use 127\.0\.0\.1:41720$/,
    )
  })

  it("lines its reason up with a settled row's metadata", () => {
    //The point of the dot is alignment: both right-hand sides must start at the same column.
    const [ok] = captureOut(() => skip("web", "cached"))
    const [bad] = captureOut(() => fail("web", "the bundle did not build"))
    expect(bad.indexOf("·")).toBe(ok.indexOf("·"))
  })

  it("gives a doctor row the same dot — one CLI, not two", () => {
    //`doctor` is the command a dev runs when something is already wrong; it must not be
    //the one that looks like a different program (the reason it shares this glyph set).
    const [row] = captureOut(() => check(true, "node", "v26.0.0"))
    expect(row).toBe("  ✓ node  · v26.0.0")
    //…and a row with nothing to report still says only its label.
    expect(captureOut(() => check(true, "@capacitor/app"))[0]).toBe(
      "  ✓ @capacitor/app",
    )
  })
})

describe("nextPhase — the live line samples the stream, it does not follow it", () => {
  it("shows the first phase immediately", () => {
    expect(
      nextPhase({ detail: "", pending: "compiling", shownAt: 0 }, 0),
    ).toEqual({
      detail: "compiling",
      shownAt: 0,
    })
  })

  it("holds a phase for its dwell before another may replace it", () => {
    const row = { detail: "compiling", pending: "linking", shownAt: 1000 }
    //too soon — the row keeps what it has
    expect(nextPhase(row, 1300).detail).toBe("compiling")
    //dwell elapsed — the newest phase takes the row
    expect(nextPhase(row, 1700).detail).toBe("linking")
  })

  it("adopts whatever is newest at the window boundary, not what queued first", () => {
    //xcodebuild alternates compiling↔processing resources per pod; sampling means the row
    //takes the current phase when its turn comes, never replays a backlog.
    let row = {
      detail: "compiling",
      pending: "processing resources",
      shownAt: 0,
    }
    row = { ...row, ...nextPhase(row, 800), pending: "linking" }
    expect(row.detail).toBe("processing resources")
    expect(nextPhase(row, 1000).detail).toBe("processing resources") //still its turn
    expect(nextPhase(row, 1600).detail).toBe("linking")
  })

  it("never rewrites the row for a phase that has not changed", () => {
    const row = { detail: "compiling", pending: "compiling", shownAt: 0 }
    expect(nextPhase(row, 99999)).toEqual({
      detail: "compiling",
      shownAt: 0,
    })
  })
})

describe("prettyLine — the vocabulary is closed (R24)", () => {
  //A live row shows either a phase adaptv CHOSE or a build-tool line mapped into one. Both
  //went through the same filter, and the filter is tuned for the second kind — so "drop a
  //lone verb", which is right for gradle, silently ate `sync`, `package` and `packaging`.
  //The row then sat on `preparing` for the whole of `cap sync`.
  it.each([
    "syncing",
    "packaging",
    "launching device",
    "reloading device",
    "linking server",
    "building app",
    "starting server",
  ])("lets adaptv's own phase '%s' through untouched", (phase) => {
    expect(prettyLine(phase)).toBe(phase)
  })

  it("keeps the metadata on a phase that carries some", () => {
    expect(prettyLine("syncing · cached")).toBe("syncing · cached")
  })

  it("has no bare-noun phase left anywhere in the vocabulary (R45)", () => {
    //Every phase must finish "right now adaptv is …". `sync` and `package` did not, and they
    //sat on the same row as `compiling`.
    for (const p of OWN_PHASES) {
      const head = p.split(" ")[0]
      expect(
        head.endsWith("ing"),
        `'${p}' is not a present participle`,
      ).toBe(true)
    }
  })

  it("still drops a lone verb a TOOL printed", () => {
    //The rule this exception is carved out of, and it has to keep working.
    expect(prettyLine("running")).toBe("")
    expect(prettyLine("building")).toBe("")
  })

  it("drops a bundle listing", () => {
    //Reached the live line during every web build: a filename, a hash and two sizes.
    expect(
      prettyLine(
        "dist/client/assets/preload-helper-rov5cbgt.js  1.19 kB │ gzip: 0.68 kB",
      ),
    ).toBe("")
  })

  it("drops a line of the dev's own source quoted by a compiler warning", () => {
    //xcodebuild echoes the offending source under a warning, so `self?.tmpWindow = nil`
    //became the phase — the build appearing to narrate the app's internals.
    expect(prettyLine("self?.tmpWindow = nil")).toBe("")
    expect(prettyLine("2576 modules transformed.")).toBe("")
  })

  it("drops every line of a crash dump (R70)", () => {
    //`adaptv build android` with the port ports.ts pins already taken. Only the last line
    //ever reached the row (`⠴ web  node.js v26.0.0`); assert the WHOLE dump renders nothing,
    //so no future reshuffle of these filters lets a different line of it through.
    const dump = `node:events:487
      throw er; // Unhandled 'error' event
      ^

Error: listen EADDRINUSE: address already in use 127.0.0.1:41740
    at Server.setupListenHandle [as _listen2] (node:net:2008:16)
    at listenInCluster (node:net:2065:12)
    at node:net:2274:7
    at process.processTicksAndRejections (node:internal/process/task_queues:90:21)
Emitted 'error' event on WebSocketServer instance at:
    at Server.emit (node:events:521:24)
    at Server.emit (node:domain:473:12)
    at emitErrorNT (node:net:2044:8) {
  code: 'EADDRINUSE',
  errno: -48,
  syscall: 'listen',
  address: '127.0.0.1',
  port: 41740
}

Node.js v26.0.0`
    for (const line of dump.split("\n")) expect(prettyLine(line)).toBe("")
  })

  it("keeps a line that already reads like a phase", () => {
    expect(prettyLine("launching device")).toBe("launching device")
  })
})

/**
 * R24 for the WEB lane, which never had it. The native lanes were parsed from the day the
 * renderer existed; the web lane passed the bundler's stdout straight to the row, so every
 * line that happened to read like a phrase BECAME the phase:
 *
 *     ⠼ web  rendering chunks
 *     ⠧ web  computing gzip size
 *
 * The fixture is the real stream, byte for byte, from `adaptv build web` in the playground
 * (`ESC[2K` is the reporter erasing its own spinner line — that prefix is why `transforming`
 * never showed at all, and why it is here).
 */
const ESC = String.fromCharCode(27)
const WEB_BUILD = [
  "vite v8.0.11 building client environment for production...",
  `${ESC}[2Ktransforming...✓ 3028 modules transformed.`,
  "rendering chunks...",
  "computing gzip size...",
  ".output/public/assets/main-5aNtl1L4.css                66.58 kB │ gzip:  12.18 kB",
  "[plugin builtin:vite-reporter]",
  "(!) Some chunks are larger than 500 kB after minification. Consider:",
  "- Using dynamic import() to code-split the application",
  "✓ built in 1.47s",
  "[nitro] ◐ Building [Nitro] (preset: node-server, compatibility: 2026-08-30)",
  "ℹ Generated .output/nitro.json",
  "[adaptv] wrote .output/public/sw.js (build tag chopchop-34bd147964b6)",
]

/**
 * Everything a live row is allowed to say: adaptv's own phases (`OWN_PHASES`) and R24's
 * list, quoted from `docs/design/cli-contract.md`. Written out here rather than derived,
 * because a set derived from the code under test cannot fail.
 */
const CLOSED_VOCABULARY = new Set([
  ...OWN_PHASES,
  "preparing build",
  "configuring",
  "resolving dependencies",
  "downloading dependencies",
  "installing dependencies",
  "compiling",
  "compiling assets",
  "compiling interface",
  "linking",
  "processing resources",
  "running build script",
  "generating debug symbols",
  "extracting app metadata",
  "checking",
  "optimizing",
  "signing",
  "packaging",
  "installing",
  "cleaning",
  "building",
])

describe("the web lane speaks adaptv's vocabulary, not the bundler's (R24, R8)", () => {
  it("maps every line of a real web build into the closed vocabulary", () => {
    const said = WEB_BUILD.map(prettyLine).filter(Boolean)
    expect(said.filter((p) => !CLOSED_VOCABULARY.has(p))).toEqual([])
    //…and not by going silent: the row still tells the story, in the same two words an
    //iOS build uses for the same two steps.
    expect([...new Set(said)]).toEqual(["compiling", "linking"])
  })

  it.each([
    ["transforming...", "compiling"],
    ["transforming (1240) src/components/todo-row.tsx", "compiling"],
    ["rendering chunks...", "linking"],
    ["rendering chunks (12)...", "linking"],
  ])("says what '%s' MEANS", (line, phase) => {
    expect(prettyLine(line)).toBe(phase)
  })

  it.each([
    "computing gzip size...", // measuring a bundle it already wrote
    "vite v8.0.11 building client environment for production...", // a banner
    "✓ 3028 modules transformed.", // a count
    "✓ built in 1.47s", // the verdict the settled ✓ already carries
  ])("shows nothing for '%s'", (line) => {
    expect(prettyLine(line)).toBe("")
  })

  it("maps a verb it has never seen rather than passing it through", () => {
    //The vocabulary is closed against the FUTURE too: a bundler adds a phase in a release
    //nobody reads, and the old failure mode was that it simply appeared on the row.
    expect(prettyLine("inlining stylesheets...")).toBe("building")
    expect(prettyLine("minifying assets (12)...")).toBe("building")
  })
})

/**
 * R12 — `--verbose` is the RAW escape hatch, so the phase filter is not on its path.
 *
 * The two `report()` closures used to run `prettyLine` first and `return` on a blank
 * result, with the raw write BELOW that early return. So every line R24 suppresses — the
 * bundle listing, the chunk-size warning, the SSR build, a crash dump — was suppressed from
 * `--verbose` as well. Measured on the playground before the fix: `adaptv build web
 * --verbose` printed 6 dim lines against a 329-line `vite build` stream, and `build ios
 * --verbose` printed 50 against xcodebuild's 336.
 *
 * `WEB_BUILD` is the fixture above — the real stream, byte for byte — and R24 already
 * asserts that only two of its eleven lines survive `prettyLine`. That is exactly what makes
 * it the test: `--verbose` has to show all eleven.
 */
describe("--verbose is raw — the phase filter is not on its path (R12)", () => {
  /** The dim sub-lines a `report()` wrote, in order, with their indent removed. */
  const streamed = (out) =>
    out
      .join("\n")
      .split("\n")
      .filter((l) => l.startsWith("    "))
      .map((l) => l.slice(4))

  it("streams every line of a real build, not the two R24 keeps (runLine)", async () => {
    const out = await captureOutAsync(() =>
      runLine(
        "web",
        async (report) => {
          for (const line of WEB_BUILD) report(line)
        },
        { verbose: true },
      ),
    )
    expect(streamed(out)).toEqual(WEB_BUILD)
  })

  it("streams every line of a real build, lane-labelled (runLanes)", async () => {
    //One idea, two implementations: `runLanes` carried the same bug in the same shape, and
    //a fix applied to only one of them is how the two drift apart again.
    const out = await captureOutAsync(() =>
      runLanes(
        [
          {
            label: "ios",
            run: async (report) => {
              for (const line of WEB_BUILD) report(line)
            },
          },
        ],
        { verbose: true },
      ),
    )
    expect(streamed(out)).toEqual(WEB_BUILD.map((l) => `ios: ${l}`))
  })

  it("still says nothing raw on the DEFAULT path", async () => {
    //The other half of the rule: raw-first must not leak a byte onto the calm rows. The
    //default run states the step and its outcome, and nothing the bundler said.
    const out = await captureOutAsync(() =>
      runLine("web", async (report) => {
        for (const line of WEB_BUILD) report(line)
      }),
    )
    expect(streamed(out)).toEqual([])
    for (const line of WEB_BUILD)
      expect(out.join("\n")).not.toContain(line)
  })
})

describe("a step with lines under it is a GROUP (R64)", () => {
  it("closes the group before the next step starts", async () => {
    //Reported from a screenshot of `dev all`: `✓ web` hung two addresses under itself and
    //`✓ ios` began on the very next row, so the eye had to work out where one step ended.
    const out = captureOut(() => {
      skip("web", "4.9s")
      addresses({
        local: "http://localhost:41730",
        network: "http://192.168.1.23:41730",
      })
      skip("ios", "41.7s")
      skip("android", "cached")
    })
    const rows = out.join("\n").split("\n")
    expect(rows).toEqual([
      "  ✓ web  · 4.9s",
      "    local    http://localhost:41730",
      "    network  http://192.168.1.23:41730",
      "",
      "  ✓ ios  · 41.7s",
      "  ✓ android  · cached",
    ])
  })

  it("leaves steps with nothing under them back-to-back", async () => {
    //The other half of the rule, and the reason it is not just "a blank between steps".
    const out = captureOut(() => {
      skip("ios", "41.7s")
      skip("android", "cached")
    })
    expect(out.join("\n").split("\n").filter(Boolean)).toHaveLength(2)
    expect(out.join("")).not.toContain("\n\n")
  })

  it("closes it before a notice too, not only before a step", async () => {
    const out = captureOut(() => {
      skip("web", "4.9s")
      detail("something hanging under it")
      flushNotices(["adaptv source change"])
    })
    const rows = out.join("\n").split("\n")
    expect(rows[1]).toContain("something hanging under it")
    expect(rows[2]).toBe("")
    expect(rows[3]).toContain("! adaptv source change")
  })

  it("asks for one blank line, not two, when a spacer follows anyway", async () => {
    const out = captureOut(() => {
      skip("web", "4.9s")
      detail("hanging")
      spacer()
      skip("ios", "1.0s")
    })
    expect(out.join("")).not.toContain("\n\n\n")
  })
})
