import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  callSitesOf,
  declaredExports,
  exportsOf,
} from "#adaptv/test-utils/barrel-guard"

/*
 * The capability barrel is mostly `export *`, and six entries are named lists.
 *
 * A named list is the only way to keep one export out of a public surface, and it
 * is also the only way for that surface to fall behind the module without anything
 * noticing — `tsc` is happy either way, and every capability's own suite imports
 * the module directly, so nothing else compares the two. The component barrels
 * drifted exactly like this and hid a finished `Text` from consumers.
 *
 * So this asserts both halves: every module is reachable, and the only names held
 * back are the ones deliberately held back.
 */

const CAPABILITIES_DIR = resolve(process.cwd(), "src/capabilities")
const BARREL = "src/interface/capabilities.index.ts"

/**
 * The whole point of the named lists — a standalone predicate answering what the
 * hook's `supported` and the call's own `"unsupported"` outcome already answer.
 * Adding to this set is a deliberate act; arriving here by accident is the bug.
 */
const WITHHELD_PREDICATES = new Set([
  "isShareSupported",
  "isClipboardWriteSupported",
  "isClipboardReadSupported",
  "isKeepAwakeSupported",
  "isOrientationLockSupported",
])

/**
 * The second reason to withhold, and a different one: not "something else already answers this"
 * but "this has exactly one owner inside the framework". A consumer calling one of these is not
 * asking a redundant question — it is fighting the module that owns the state, and winning only
 * until that module next runs. Each name is paired with the file that owns it, and the last test
 * here checks that the ownership is real rather than asserted.
 */
const WITHHELD_INTERNAL: Record<string, string> = {
  setThemeColorBase: "src/hooks/use-sync-theme.ts",
  measureKeyboardPayment: "src/hooks/use-keyboard.ts",
  listenNativeKeyboard: "src/hooks/use-keyboard.ts",
}

const WITHHELD = new Set([
  ...WITHHELD_PREDICATES,
  ...Object.keys(WITHHELD_INTERNAL),
])

/** Not capability modules: caches and the test files beside them. */
const NOT_A_CAPABILITY = new Set(["keyboard-height-cache"])

function moduleNames(): string[] {
  return readdirSync(CAPABILITIES_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => f.replace(/\.ts$/, ""))
    .filter((name) => !NOT_A_CAPABILITY.has(name))
}

/** Top-level `export` names in a capability module, types included. */
const exportedNames = (module: string) =>
  declaredExports(
    readFileSync(resolve(CAPABILITIES_DIR, `${module}.ts`), "utf8"),
  )

const EXPORTS = exportsOf(
  readFileSync(resolve(process.cwd(), BARREL), "utf8"),
)

/** The barrel's export line for a module, `export *` or named — or `undefined`. */
const lineFor = (module: string) =>
  EXPORTS.find((e) => e.spec === `../capabilities/${module}`)

describe("capabilities barrel", () => {
  /*
   * The vacuous pass: every assertion below compares against a directory scan and
   * a parse of one file, so a walk pointed at nothing — or a parser that stops
   * matching — compares two empty lists and reports perfect compliance. The floors
   * are well under the real counts today (18 modules, 84 names, 22 export lines)
   * and well over zero. → `docs/roadmap/src-reorg.md` §7
   */
  it("actually walked the directory it claims to have walked", () => {
    expect(moduleNames().length).toBeGreaterThanOrEqual(15)
    const names = moduleNames().flatMap(exportedNames)
    expect(names.length).toBeGreaterThanOrEqual(60)
    expect(EXPORTS.length).toBeGreaterThanOrEqual(15)
    for (const name of WITHHELD) {
      expect(
        names,
        `${name} is withheld but nothing exports it`,
      ).toContain(name)
    }
  })

  it("re-exports every capability module", () => {
    const missing = moduleNames().filter((name) => !lineFor(name))
    expect(missing).toEqual([])
  })

  it("withholds exactly the predicates it means to withhold", () => {
    const held: string[] = []
    for (const module of moduleNames()) {
      //`export *` carries everything, so only a named list can hold anything back
      const named = lineFor(module)?.names
      if (!named) continue
      for (const name of exportedNames(module)) {
        if (!named.includes(name)) held.push(name)
      }
    }
    expect(new Set(held)).toEqual(WITHHELD)
  })

  /*
   * The replacement has to actually exist, or this is just a deletion. Each
   * withheld predicate is paired with the hook field that answers for it.
   */
  it("keeps a hook answering for each predicate it withholds", () => {
    const answers: Record<string, [string, string]> = {
      isShareSupported: ["use-share", "supported"],
      isClipboardWriteSupported: ["use-clipboard", "canWrite"],
      isClipboardReadSupported: ["use-clipboard", "canRead"],
      isKeepAwakeSupported: ["use-keep-awake", "supported"],
      isOrientationLockSupported: ["use-orientation", "lockSupported"],
    }
    expect(new Set(Object.keys(answers))).toEqual(WITHHELD_PREDICATES)

    for (const [predicate, [hook, field]] of Object.entries(answers)) {
      const src = readFileSync(
        resolve(process.cwd(), `src/hooks/${hook}.ts`),
        "utf8",
      )
      expect(src, `${hook} must answer for ${predicate}`).toContain(
        `${field}:`,
      )
    }
  })

  /*
   * The justification for the second category, checked rather than trusted. "One owner" is the
   * whole reason these are held back — if a second caller appears inside the framework, the claim
   * is no longer true and the name needs a different answer than a named list.
   */
  it("keeps each internal-only capability down to its one owner", () => {
    for (const [name, owner] of Object.entries(WITHHELD_INTERNAL)) {
      const callers = callSitesOf(new RegExp(`\\b${name}\\b`), [
        BARREL,
      ]).filter((file) => !file.startsWith("src/capabilities/"))
      expect(callers, `${name} must be called only by ${owner}`).toEqual([
        owner,
      ])
    }
  })
})
