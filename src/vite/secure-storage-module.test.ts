// @vitest-environment node
// The only question worth asking about this module is whether the backend's CODE
// reaches the bundle — not whether its NAME appears in it.
//
// That distinction is the entire bug it replaces. `import(/* @vite-ignore */ CONST)`
// type-checked, built without a warning, and shipped a bundle in which the package
// name was present as a plain string and the package itself was nowhere. Every
// cheap assertion — "the specifier is there", "the module compiles", "loadPlugin
// exists" — passed on that bundle. So these tests run a real Vite build against a
// real package on disk and look for a marker only the package's own source has.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { build } from "vite"
import { afterEach, describe, expect, it } from "vitest"
import {
  adaptvSecureStoragePlugin,
  hasSecureStorage,
  renderSecureStorageModule,
  SECURE_STORAGE_PACKAGE,
  SECURE_STORAGE_VIRTUAL_ID,
} from "#adaptv/vite/secure-storage-module.ts"

/** Appears only inside the fake package's source — never in its name. */
const MARKER = "KEYCHAIN_IMPLEMENTATION_MARKER_9f3a"

let root: string | null = null
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = null
})

/** An app root, optionally with the optional peer actually installed in it. */
function scaffold(withPackage: boolean): string {
  root = mkdtempSync(path.join(tmpdir(), "adaptv-secure-"))
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "scratch-app", type: "module" }),
  )
  writeFileSync(
    path.join(root, "entry.js"),
    //dynamic, exactly as `storage/secure.ts` loads it
    `export const load = () => import("${SECURE_STORAGE_VIRTUAL_ID}").then((m) => m.SecureStorage)\n`,
  )
  if (withPackage) {
    const dir = path.join(
      root,
      "node_modules",
      ...SECURE_STORAGE_PACKAGE.split("/"),
    )
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: SECURE_STORAGE_PACKAGE,
        version: "1.0.0",
        type: "module",
        main: "index.js",
      }),
    )
    writeFileSync(
      path.join(dir, "index.js"),
      `export const SecureStorage = { tag: "${MARKER}" }\n`,
    )
  }
  return root
}

/** Build `entry.js` with only adaptv's plugin, and return every emitted chunk. */
async function bundle(appRoot: string): Promise<string> {
  const result = await build({
    root: appRoot,
    logLevel: "silent",
    plugins: [
      adaptvSecureStoragePlugin({
        appRoot,
      } as Parameters<typeof adaptvSecureStoragePlugin>[0]),
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: path.join(appRoot, "entry.js"), formats: ["es"] },
    },
  })
  const output = (
    Array.isArray(result) ? result[0] : (result as { output: unknown })
  ) as { output: Array<{ type: string; code?: string }> }
  return output.output
    .filter((c) => c.type === "chunk")
    .map((c) => c.code ?? "")
    .join("\n")
}

describe("🔴 the backend's code, not just its name", () => {
  it("bundles the real package when the app has it installed", async () => {
    //THE test. A bundle that merely mentions the package is the broken state.
    const code = await bundle(scaffold(true))
    expect(code).toContain(MARKER)
  })

  it("leaves no bare specifier for the WebView to resolve", async () => {
    //A WebView has no import map, so a surviving bare specifier is an import that
    //rejects on every device — the exact shape of the original bug.
    const code = await bundle(scaffold(true))
    expect(code).not.toMatch(
      new RegExp(`import\\s*\\(\\s*["'\`]${SECURE_STORAGE_PACKAGE}`),
    )
  })

  it("builds fine, and yields null, when the peer is absent", async () => {
    //the web-only consumer: no install, no build failure, no crash
    const code = await bundle(scaffold(false))
    expect(code).not.toContain(MARKER)
    expect(code).toContain("null")
  })
})

describe("the installed check", () => {
  it("is true only when the package can actually be resolved", () => {
    expect(hasSecureStorage(scaffold(true))).toBe(true)
    rmSync(root as string, { recursive: true, force: true })
    expect(hasSecureStorage(scaffold(false))).toBe(false)
  })
})

describe("the consumer of all this — storage/secure.ts", () => {
  //The build tests above prove the virtual module works. They would all still pass
  //if someone put the old pattern back in `secure.ts` and simply stopped using it,
  //so the file itself is checked too.
  //`process.cwd()`, not `import.meta.url`: under vitest this module can be handed
  //a non-`file:` url, and resolving from it throws — the same trap
  //`native/installed-plugins.ts` documents in `adaptvRoots`.
  const source = readFileSync(
    path.join(process.cwd(), "src/storage/secure.ts"),
    "utf8",
  )
  const code = source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n")

  it("loads the backend through the virtual id", () => {
    expect(code).toContain(`import("${SECURE_STORAGE_VIRTUAL_ID}")`)
  })

  it("never names the optional package in a specifier again", () => {
    //the whole failure was a name Rollup could not follow
    expect(code).not.toContain(`"${SECURE_STORAGE_PACKAGE}"`)
    expect(code).not.toContain("@vite-ignore")
  })
})

describe("the emitted module keeps the property Rollup needs", () => {
  it("re-exports statically from a literal, never dynamically", () => {
    //A dynamic import or a computed specifier here would put the name back out of
    //Rollup's reach while still type-checking and still building.
    const source = renderSecureStorageModule(true)
    expect(source).toContain(`export { SecureStorage } from`)
    expect(source).toContain(`"${SECURE_STORAGE_PACKAGE}"`)
    expect(source).not.toContain("import(")
    expect(source).not.toContain("@vite-ignore")
  })
})
