// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { computeBuildTag, slugifyName } from "#adaptv/vite/build-tag.ts"

/*
 * The build tag is the service worker's cache namespace: runtime buckets are
 * `<bucket>-<buildTag>` and the activate sweep deletes every owned bucket whose
 * tag is not the current one (`docs/design/rendering.md` §3.3,
 * `docs/decisions/register.md` B2). So both directions are load-bearing. A tag
 * that stays put across a real deploy keeps serving the previous build's
 * `static-<tag>` entries for unversioned URLs; a tag that moves on a no-op
 * rebuild throws away every user's runtime cache for nothing.
 */

const roots: string[] = []
let savedOverride: string | undefined

beforeEach(() => {
  //the override is an escape hatch for multi-worker deploys, and a developer
  //who exported it in their shell would otherwise turn every test here green
  savedOverride = process.env.ADAPTV_BUILD_TAG
  delete process.env.ADAPTV_BUILD_TAG
})

afterEach(() => {
  if (savedOverride === undefined) delete process.env.ADAPTV_BUILD_TAG
  else process.env.ADAPTV_BUILD_TAG = savedOverride
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** A client output directory holding `files`, written in the given order. */
function output(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "adaptv-build-tag-"))
  roots.push(dir)
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    writeFileSync(path.join(dir, name), contents)
  }
  return dir
}

const build = {
  "index.html": "<!DOCTYPE html><div id=root></div>",
  "assets/client-abc123.js": "console.log(1)",
  "assets/main-def456.css": "html{}",
  "manifest.json": "{}",
}

describe("computeBuildTag — moves exactly when the deployable output moves", () => {
  it("is identical for the same bytes, whatever directory or write order produced them", async () => {
    //two separate builds of an unchanged app: different paths, different mtimes,
    //files landing in a different order. None of that is a deploy.
    const first = output(build)
    const second = output(
      Object.fromEntries(Object.entries(build).reverse()),
    )
    const tag = await computeBuildTag(first, "probe")
    expect(tag).toMatch(/^probe-[0-9a-f]{12}$/)
    expect(await computeBuildTag(second, "probe")).toBe(tag)
  })

  it("changes when a file's bytes change, when a file is added, and when one is renamed", async () => {
    const base = await computeBuildTag(output(build), "probe")

    const edited = output({
      ...build,
      "assets/client-abc123.js": "console.log(2)",
    })
    const added = output({ ...build, "robots.txt": "" })
    //same bytes under a new name: the URL is what a cache is keyed by, so a
    //rename is a deploy even though no content changed
    const { "assets/main-def456.css": css, ...rest } = build
    const renamed = output({ ...rest, "assets/main-0789ab.css": css })

    const tags = await Promise.all(
      [edited, added, renamed].map((dir) => computeBuildTag(dir, "probe")),
    )
    for (const tag of tags) expect(tag).not.toBe(base)
    expect(new Set(tags).size).toBe(3)
  })

  it("ignores the worker it is about to be baked into", async () => {
    //sw.js embeds the precache manifest and the tag itself, and sw-src.js is the
    //bundle it is stamped from. Hashing either would make the tag depend on its
    //own output, so a rebuild could never reproduce it.
    const before = await computeBuildTag(output(build), "probe")
    const after = await computeBuildTag(
      output({
        ...build,
        "sw.js": "self.__WB_MANIFEST=[]",
        "sw-src.js": "self.__WB_MANIFEST",
      }),
      "probe",
    )
    expect(after).toBe(before)
  })

  it("yields to ADAPTV_BUILD_TAG, which pins one tag across a multi-worker deploy", async () => {
    process.env.ADAPTV_BUILD_TAG = "pinned-tag"
    expect(await computeBuildTag(output(build), "probe")).toBe(
      "pinned-tag",
    )
  })
})

describe("slugifyName", () => {
  it("reduces an app name to a cache-safe prefix, never an empty one", () => {
    expect(slugifyName("  My Cool App! 2 ")).toBe("my-cool-app-2")
    //a name with nothing usable in it still reads as a tag, not as `-<hash>`
    expect(slugifyName("!!!")).toBe("app")
  })
})
