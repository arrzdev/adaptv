// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { loadAdaptvModule } from "./load-ts.mjs"
import { ownInstallMissingPlatform } from "./native.mjs"
import { namesPlumbing } from "./opacity.mjs"
import { prettyLine } from "./render.mjs"

/**
 * adaptv's consumers never learn that TanStack Router, TanStack Start or Capacitor are
 * underneath (`docs/design/cli-contract.md` R8, `docs/decisions/register.md` L20 / O2). Every fixture here is a real line from a real
 * tool, because the leak that prompted this module was a real line from a real tool that
 * nobody thought to invent.
 */

describe("namesPlumbing — the engines, in the spellings errors actually use", () => {
  it.each([
    "Error: Cannot find module 'tanstack-start-injected-head-scripts:v'",
    "imported from '/a/node_modules/@tanstack/start-server-core/dist/esm/router-manifest.js'",
    "/a/node_modules/.pnpm/@tanstack+start-server-core@1.167.7/node_modules/x",
    "Compiling CapacitorSplashScreen.swift",
    "> Task :capacitor-android:compileDebugJavaWithJavac",
    "ProcessInfoPlistFile ResourceBundle-CapacitorCordova-Info.plist",
    "[capacitor] error: something",
    "installing @capacitor/ios",
  ])("catches %s", (line) => {
    expect(namesPlumbing(line)).toBe(true)
  })

  it.each([
    //The platform toolchain is NOT hidden: the contract names it out loud (R24's phase
    //vocabulary has `gradle · assembleDebug`, and the busy-port fix tells the dev to pass
    //`-- --port <n>`). Hiding these would cost diagnosis and buy no opacity.
    "vite dev exited (code 1) before it was ready",
    "port 41730 is already in use",
    "gradle · assembleDebug",
    "compiling",
    "linking plugins · device",
    "/a/src/routes/cart.tsx:12:3: error: unexpected token",
  ])("leaves %s alone", (line) => {
    expect(namesPlumbing(line)).toBe(false)
  })
})

describe("the live row cannot narrate the plumbing either", () => {
  it("drops an unrecognised tool line that names an engine", () => {
    //One lowercase pass away from being the phase on screen, before the gate existed.
    expect(prettyLine("Compiling CapacitorSplashScreen.swift")).toBe("")
    expect(prettyLine("Touching Capacitor.framework")).toBe("")
  })

  it("still passes adaptv's OWN vocabulary through untouched", () => {
    //Including a plugin the dev registered, whatever it is called — that one is THEIRS (R8),
    //and it reaches the row above the gate via OWN_PHASES.
    expect(prettyLine("linking plugins · device")).toBe(
      "linking plugins · device",
    )
    expect(prettyLine("packaging")).toBe("packaging")
  })
})

/**
 * The manifest is a surface too, and it was the one nothing watched.
 *
 * `description` read `… native iOS/Android (Capacitor) …` and survived every test in this
 * file, because everything above it checks a line on its way to a terminal. npm, GitHub and
 * every tooling UI render that field on sight, to people who have not run the CLI once. The
 * README is held to R8; the manifest is the same promise with wider distribution and no
 * reader between the leak and the audience.
 *
 * So the walk is by EXCLUSION, not an allowlist of fields to check. A leak arrives in a field
 * nobody thought of — `keywords` (absent today), a `homepage`, a `bugs` blurb — and an
 * allowlist would greet each of them the way the terminal tests greeted `description`.
 * Keys are scanned as well as values, so a `capacitorVersion` field fails on its own name.
 */
const PKG = JSON.parse(
  readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../package.json",
    ),
    "utf8",
  ),
)

/**
 * The dependency graph, which MUST name the engines and is decided to
 * (`docs/decisions/facade-and-opacity.md` §1 rule 2: `@tanstack/react-router` stays a named
 * engine dependency, the Expo↔react-native model). Opacity is a promise about what adaptv
 * SAYS, and a version range is not a sentence. Nothing else is exempt.
 */
const STRUCTURAL = new Set([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "pnpm",
])

/** Every key and every string value in the manifest, outside the dependency graph. */
function manifestStrings() {
  const out = []
  const walk = (node, at) => {
    if (typeof node === "string") {
      out.push({ at, text: node })
    } else if (Array.isArray(node)) {
      node.forEach((v, i) => {
        walk(v, `${at}[${i}]`)
      })
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        out.push({ at: `${at}.${k}`, text: k })
        walk(v, `${at}.${k}`)
      }
    }
  }
  for (const [k, v] of Object.entries(PKG)) {
    if (STRUCTURAL.has(k)) continue
    out.push({ at: k, text: k })
    walk(v, k)
  }
  return out
}

describe("package.json is a user-facing surface", () => {
  it("has fields to check at all", () => {
    //A walker that quietly collected nothing would make the rule below vacuously true, which
    //is the state this surface was already in.
    expect(manifestStrings().length).toBeGreaterThan(50)
  })

  it("names no engine in any field a registry or a UI shows", () => {
    const bad = manifestStrings().filter((s) => namesPlumbing(s.text))
    expect(bad.map((b) => `${b.at}  ${b.text}`)).toEqual([])
  })

  it("still scans the field the leak was actually in", () => {
    //Pins the walk to `description` by name: an exemption added to STRUCTURAL to make a
    //future failure go away must not be able to take this one with it.
    expect(manifestStrings().map((s) => s.at)).toContain("description")
    expect(PKG.description).toBeTruthy()
  })
})

describe("doctor's diagnostics are a user-facing surface too", () => {
  //`adaptv doctor` renders `formatDiagnostics` straight to the terminal, so R8 governs it
  //like any other row. It leaked for a long time because the two guards that could have
  //caught it both look elsewhere: `prettyLine` never sees this text (it is not tool output),
  //and the diagnostics live in `src/`, where a TS test cannot import this untyped module.
  //So the scan belongs here, driven off the REAL diagnostics rather than fixtures: the
  //shipped message named the engine four times, and any invented fixture would have passed.
  const everyDiagnostic = async () => {
    const { runDoctor, formatDiagnostics } =
      await loadAdaptvModule("native/doctor.ts")
    const diagnostics = runDoctor({
      iosInfoPlist: "<key>WKAppBoundDomains</key><array/>",
      capacitorConfig: "{}",
      androidVariablesGradle: "targetSdkVersion = 34",
      hasPrivacyManifest: false,
    })
    return { diagnostics, rendered: formatDiagnostics(diagnostics) }
  }

  it("fires every check, so the scan below is not vacuous", async () => {
    const { diagnostics } = await everyDiagnostic()
    expect(diagnostics).toHaveLength(3)
  })

  it("names no engine underneath, in any rendered line", async () => {
    const { rendered } = await everyDiagnostic()
    const leaks = rendered
      .split("\n")
      .filter((line) => namesPlumbing(line))
    expect(leaks).toEqual([])
  })
})

/**
 * The server-API ban is a user-facing surface three times over.
 *
 * It fires in the dev's terminal (`vite build`), in the dev overlay, and — through
 * `biome-shared.json`, which a consumer `extends` — as an editor squiggle. All three said
 * "a Capacitor build has none", and the doctor scan above could not see it because none of
 * this text passes through `prettyLine` or `formatDiagnostics`. The one engine word a ban
 * may carry is the specifier the dev typed: it is their import, in their file, and the
 * caret frame points at it. Everything around it is adaptv's sentence about adaptv's rule.
 */
describe("the server-API ban is a user-facing surface", () => {
  it("names no engine beyond the import the dev wrote", async () => {
    const { describeServerApiBan, SERVER_ROUTE_HANDLERS_MESSAGE } =
      await loadAdaptvModule("vite/ban-server-apis.ts")
    //one specifier per door the ban covers: the root, a subpath, another package
    for (const source of [
      "@tanstack/react-start",
      "@tanstack/react-start/client-rpc",
      "@tanstack/start-client-core",
    ]) {
      const message =
        describeServerApiBan(source, "/app/src/routes/index.tsx") ?? ""
      //the scan below is vacuous on an empty message, and a null here means the
      //fixture stopped being application source, not that the ban went quiet
      expect(message, source).not.toBe("")
      const leaks = message
        .replaceAll(source, "")
        .split("\n")
        .filter((line) => namesPlumbing(line))
      expect(leaks, source).toEqual([])
    }
    expect(
      SERVER_ROUTE_HANDLERS_MESSAGE.split("\n").filter((line) =>
        namesPlumbing(line),
      ),
    ).toEqual([])
  })

  it("names none in the shared lint config either", () => {
    const shared = JSON.parse(
      readFileSync(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../biome-shared.json",
        ),
        "utf8",
      ),
    )
    //The KEYS and pattern GROUPS are the banned specifiers, which is what the rule is
    //about — structural, like the dependency graph. The messages are what the dev reads,
    //from `paths` and `patterns` alike.
    const options = shared.linter.rules.style.noRestrictedImports.options
    const messages = [
      ...Object.values(options.paths ?? {}).map((p) => p.message),
      ...(options.patterns ?? []).map((p) => p.message),
    ]
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.filter((m) => namesPlumbing(m))).toEqual([])
  })
})

/**
 * Refusals thrown from build-time code land on a `✖` line through `explainFailure`, whose
 * fallback for a reason that names plumbing is the thrower's OWN first line — so a thrown
 * message that names an engine is printed verbatim. These are the two that did.
 */
describe("build-time refusals are a user-facing surface", () => {
  it("reports adaptv's own broken install without naming the engine", () => {
    //`@capacitor/ios is missing from adaptv's install` was thrown straight onto the
    //platform's line. The fact is adaptv's; the fix is `pnpm install`; neither needs the name.
    for (const platform of ["ios", "android"]) {
      const message = ownInstallMissingPlatform(platform)
      expect(message).toContain(platform)
      expect(namesPlumbing(message)).toBe(false)
    }
  })

  it("refuses a missing appId in adaptv's words", async () => {
    //`preflight` catches this first (R33); the backstop said `to generate
    //capacitor.config`, naming a file the consumer never sees.
    const { buildCapacitorConfig } = await loadAdaptvModule(
      "vite/capacitor-config.ts",
    )
    let message = ""
    try {
      buildCapacitorConfig({ name: "x" })
    } catch (err) {
      message = String(err?.message ?? err)
    }
    expect(message).toContain("'appId'")
    expect(namesPlumbing(message)).toBe(false)
  })
})

/**
 * The consumer-facing docs, held to the same line. `docs/README.md` names them: the root
 * `README.md` and `guides/cookbook.md` must never name the machinery underneath (L20).
 *
 * One thing is stripped before the scan, and it is not an engine: `@tanstack/react-query`
 * is the cookbook author's own data library, chosen by the consumer and installed by the
 * consumer. Opacity hides adaptv's platform choices, not the consumer's
 * (`docs/decisions/rendering-and-delivery.md` §2, on hosting providers) — and it is
 * stripped by exact name so a mention of the router or Start next to it still fails.
 */
describe("the consumer-facing docs are a user-facing surface", () => {
  const CONSUMER_OWN_LIBRARY = /@tanstack\/react-query|TanStack Query/g
  const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  )

  it.each(["README.md", "docs/guides/cookbook.md"])(
    "%s names no engine",
    (file) => {
      const lines = readFileSync(path.join(ROOT, file), "utf8").split("\n")
      expect(lines.length).toBeGreaterThan(20)
      const leaks = lines
        .map((line, i) => ({
          at: `${file}:${i + 1}`,
          text: line.replace(CONSUMER_OWN_LIBRARY, ""),
        }))
        .filter((l) => namesPlumbing(l.text))
      expect(leaks.map((l) => `${l.at}  ${l.text.trim()}`)).toEqual([])
    },
  )
})
