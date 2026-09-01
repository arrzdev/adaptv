// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { carriesNativeCode } from "../../src/native/installed-plugins.ts"
import { ADAPTV_ROOT } from "./load-ts.mjs"
import { locatePackage, ownNativeModules } from "./own-modules.mjs"

/**
 * `doctor`'s one row about adaptv's own install used to check a hand-written array of eleven
 * package names. adaptv shipped fifteen. `@capacitor/clipboard`, `@capacitor/device`,
 * `@capacitor/share` and `@capawesome/capacitor-live-update` — the OTA mechanism itself —
 * had been added to `package.json` and to nothing else, so any of them could have been
 * missing under a green `complete`.
 *
 * The list is gone rather than corrected, because a corrected list drifts again on the next
 * dependency. These tests are about the derivation that replaced it.
 */
const deps = Object.keys(
  JSON.parse(readFileSync(path.join(ADAPTV_ROOT, "package.json"), "utf8"))
    .dependencies ?? {},
)

describe("finding a package that is really there", () => {
  it("locates every dependency adaptv declares", () => {
    //The whole check: a declared dependency that cannot be found is a broken install, and
    //this is the assertion that would have caught the four missing names had they ever gone
    //missing. It also fails the moment a `pnpm install` is half-done.
    const lost = deps.filter((d) => locatePackage(d, ADAPTV_ROOT) === null)
    expect(lost).toEqual([])
  })

  it("does not mistake a package that hides its manifest for a missing one", () => {
    //`ink`, `sharp`, `commander` and `@vitejs/plugin-react` all answer
    //`ERR_PACKAGE_PATH_NOT_EXPORTED` to `require.resolve("<name>/package.json")`. A probe
    //that reads a throw as "not installed" paints the row red on a healthy install — and
    //there is no version of that bug that is quiet.
    for (const name of ["ink", "sharp"]) {
      expect(deps).toContain(name)
      expect(locatePackage(name, ADAPTV_ROOT)).not.toBeNull()
    }
  })

  it("answers null for something that was never installed", () => {
    expect(
      locatePackage("@capacitor/not-a-real-plugin", ADAPTV_ROOT),
    ).toBeNull()
  })
})

describe("the native modules are derived, never listed", () => {
  const real = () =>
    ownNativeModules({
      dependencies: deps,
      locate: (name) => locatePackage(name, ADAPTV_ROOT),
      isNative: carriesNativeCode,
    })

  it("reports adaptv's own install as complete and non-empty", () => {
    const { modules, missing } = real()
    expect(missing).toEqual([])
    expect(modules.length).toBeGreaterThan(0)
  })

  it("keeps every module it names inside adaptv's own dependencies", () => {
    const { modules } = real()
    for (const m of modules) expect(deps).toContain(m)
  })

  it("names something outside the engine's own namespace", () => {
    //The trap `src/native/installed-plugins.ts` documents: a `@capacitor/` prefix filter
    //scopes the enumeration to one vendor, and the first thing it drops is the OTA plugin —
    //invisible to the very row that is supposed to say whether OTA can work at all. If this
    //ever goes to zero, a name filter has come back.
    const { modules } = real()
    expect(modules.some((m) => !m.startsWith("@capacitor/"))).toBe(true)
  })

  it("leaves out a dependency that ships no native code", () => {
    //`@capacitor/cli` is the sharp one: it carries the `capacitor` field and no platform
    //tree, which is why `carriesNativeCode` demands both.
    const { modules } = real()
    expect(deps).toContain("@capacitor/cli")
    expect(modules).not.toContain("@capacitor/cli")
  })
})

describe("what the derivation does with a broken install", () => {
  //No filesystem: the shape is the point, and it has to be checkable without breaking one.
  const fake = ({ present = [], native = [] }) =>
    ownNativeModules({
      dependencies: [...present, ...native, "gone"].sort(),
      locate: (name) =>
        [...present, ...native].includes(name) ? `/pkg/${name}` : null,
      isNative: (dir) => native.some((n) => dir === `/pkg/${n}`),
    })

  it("reports a package it cannot find, whether or not it is native", () => {
    const { modules, missing } = fake({
      present: ["plain"],
      native: ["shipped"],
    })
    expect(missing).toEqual(["gone"])
    //Both lists: `--verbose` prints `modules`, and a missing name is the one worth printing.
    expect(modules).toEqual(["gone", "shipped"])
  })

  it("says nothing at all when everything resolves", () => {
    const { missing } = ownNativeModules({
      dependencies: ["a", "b"],
      locate: (name) => `/pkg/${name}`,
      isNative: () => true,
    })
    expect(missing).toEqual([])
  })
})
