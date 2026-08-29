import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/*
 * The capability barrel is mostly `export *`, and four entries are named lists.
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
const BARREL = resolve(
  process.cwd(),
  "src/interface/capabilities.index.ts",
)

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
function exportedNames(module: string): string[] {
  const src = readFileSync(
    resolve(CAPABILITIES_DIR, `${module}.ts`),
    "utf8",
  )
  const names: string[] = []
  const pattern =
    /^export\s+(?:async\s+)?(?:function|const|type|class|interface)\s+([A-Za-z0-9_$]+)/gm
  let match = pattern.exec(src)
  while (match) {
    names.push(match[1])
    match = pattern.exec(src)
  }
  return names
}

describe("capabilities barrel", () => {
  const barrel = readFileSync(BARREL, "utf8")

  it("re-exports every capability module", () => {
    const missing = moduleNames().filter(
      (name) => !barrel.includes(`"../capabilities/${name}"`),
    )
    expect(missing).toEqual([])
  })

  it("withholds exactly the predicates it means to withhold", () => {
    const held: string[] = []
    for (const module of moduleNames()) {
      for (const name of exportedNames(module)) {
        //`export *` carries everything, so only a named list can hold anything back
        const named = new RegExp(
          `export \\{[^}]*\\}\\s*from "\\.\\./capabilities/${module}"`,
          "s",
        ).exec(barrel)
        if (!named) continue
        if (!new RegExp(`\\b${name}\\b`).test(named[0])) held.push(name)
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
      const callers = callSitesOf(name).filter(
        (file) => !file.startsWith("src/capabilities/"),
      )
      expect(callers, `${name} must be called only by ${owner}`).toEqual([
        owner,
      ])
    }
  })
})

/** Every file under `src/` that names `symbol`, excluding tests and the barrel itself. */
function callSitesOf(symbol: string): string[] {
  const pattern = new RegExp(`\\b${symbol}\\b`)
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      if (entry.name.endsWith(".test.ts")) continue
      if (entry.name.endsWith(".test.tsx")) continue
      if (full === BARREL) continue
      if (pattern.test(readFileSync(full, "utf8"))) {
        hits.push(full.slice(resolve(process.cwd()).length + 1))
      }
    }
  }
  walk(resolve(process.cwd(), "src"))
  return hits.sort()
}
