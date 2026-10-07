// `create-adaptv`: copy `template/`, write a package.json, and say what to type next.
//
// Deliberately the smallest thing that makes `pnpm create adaptv my-app` true
// (docs/design/create-adaptv.md). It asks nothing, installs nothing and runs nothing: the
// app name is its one input, and the dev's own package manager does the install.
//
// It ships as its own package with no dependencies, so it cannot import the CLI's render
// engine. The few lines it prints follow the same contract (docs/design/cli-contract.md)
// and its glyphs are held to `bin/ui/theme.mjs` by `create.test.mjs`.
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const TEMPLATE = fileURLToPath(
  new URL("./template", import.meta.url),
)

/** The CLI's glyphs (bin/ui/theme.mjs), restated because this package ships alone. */
export const GLYPH = { ok: "✓", fail: "✖" }

/** The framework release a new app depends on. `create.test.mjs` holds it to the root version. */
export const ADAPTV_VERSION = "0.1.0-alpha.1"

/**
 * The framework's peers, at the versions it pins them to. The template is plain CSS, so
 * it imports nothing else (docs/decisions/styling.md §0.1). `create.test.mjs` holds the
 * peers to the root `peerDependencies`.
 */
export const DEPENDENCIES = {
  motion: "12.35.0",
  react: "19.2.3",
  "react-dom": "19.2.3",
  vite: "8.0.11",
}
export const DEV_DEPENDENCIES = {
  "@types/react": "19.2.7",
  "@types/react-dom": "19.2.3",
  typescript: "5.9.3",
}

/** The app's scripts: the real CLI surface, web by default. */
export const SCRIPTS = {
  doctor: "adaptv doctor",
  dev: "adaptv dev web",
  preview: "adaptv preview web",
  build: "adaptv build web",
}

/** The files whose text carries the app's name. */
const NAMED = ["adaptv.config.ts", "src/routing/pages/home.page.tsx"]

/** A name that is a valid npm package name AND a plain directory name. */
const VALID_NAME = /^[a-z0-9][a-z0-9._-]*$/

/** Why `name` cannot be an app name, or null when it can. */
export function invalidName(name) {
  if (!VALID_NAME.test(name) || name.length > 214)
    return `'${name}' is not a valid app name — use lowercase letters, digits and '-'`
  return null
}

/** `my-app` → `com.example.myapp`: a placeholder the dev replaces, and one both stores accept. */
export function appIdFor(name) {
  const segment = name.replace(/[^a-z0-9]/g, "")
  return `com.example.${/^[a-z]/.test(segment) ? segment : `app${segment}`}`
}

/** The package manager that ran us, from the user agent every one of them sets. */
export function packageManager(userAgent = "") {
  const pm = userAgent.split("/")[0]
  return ["pnpm", "yarn", "bun"].includes(pm) ? pm : "npm"
}

/** The command that runs a package script under `pm`. */
export function runCommand(pm, script) {
  return pm === "npm" || pm === "bun"
    ? `${pm} run ${script}`
    : `${pm} ${script}`
}

/**
 * Write a new app into `dir`.
 * @param {{ dir: string, name: string, adaptv?: string }} options
 *   `adaptv` is the framework's dependency spec — a version by default, a `link:` or
 *   `file:` spec to try the template against a checkout.
 */
export function create({ dir, name, adaptv = ADAPTV_VERSION }) {
  if (existsSync(dir) && readdirSync(dir).length > 0)
    throw new Error(`'${name}' already exists and is not empty`)
  cpSync(TEMPLATE, dir, { recursive: true })
  //npm drops a `.gitignore` from every published tarball, so it ships under another name
  renameSync(path.join(dir, "gitignore"), path.join(dir, ".gitignore"))
  for (const file of NAMED) {
    const at = path.join(dir, file)
    writeFileSync(
      at,
      readFileSync(at, "utf8")
        .replaceAll("__APP_ID__", appIdFor(name))
        .replaceAll("__NAME__", name),
    )
  }
  const pkg = {
    name,
    version: "0.0.0",
    private: true,
    type: "module",
    scripts: SCRIPTS,
    dependencies: { "@arrzdev/adaptv": adaptv, ...DEPENDENCIES },
    devDependencies: DEV_DEPENDENCIES,
  }
  writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify(pkg, null, 2)}\n`,
  )
}
