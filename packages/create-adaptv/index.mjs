#!/usr/bin/env node
// `pnpm create adaptv <name>` → this file. Parsing and printing only; the work is `create.mjs`.
import path from "node:path"
import {
  create,
  GLYPH,
  invalidName,
  packageManager,
  runCommand,
} from "./create.mjs"

//The CLI's palette (bin/lib/render.mjs), restated because this package ships alone.
const noColor = "NO_COLOR" in process.env
const paint = (code) => (s) => (noColor ? s : `\x1b[${code}m${s}\x1b[0m`)
const c = {
  dim: paint("2"),
  bold: paint("1"),
  green: paint("32"),
  red: paint("31"),
  magenta: paint("35"),
}

const pm = packageManager(process.env.npm_config_user_agent)
const createCommand = `${pm} create adaptv <name>`

/** One `✖`, on stderr, and leave (R7, R30). */
function fail(message) {
  process.stderr.write(`  ${c.red(GLYPH.fail)} ${message}\n\n`)
  process.exit(1)
}

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    `\n  ${c.bold(c.magenta("adaptv"))} ${c.dim("· create")}\n\n  ${createCommand}\n\n`,
  )
  process.exit(0)
}

const name = args.find((a) => !a.startsWith("-"))
process.stdout.write(
  `\n  ${c.bold(c.magenta("adaptv"))} ${c.dim(`· create${name ? ` ${name}` : ""}`)}\n\n`,
)
const flag = args.find((a) => a.startsWith("-"))
if (flag) fail(`unknown option '${flag}'`)
if (!name) fail(`missing app name — '${createCommand}'`)
if (args.length > 1) fail(`one app name, not ${args.length}`)
const invalid = invalidName(name)
if (invalid) fail(invalid)

try {
  //`ADAPTV_SPEC` points the app at something other than the release: a `link:` to a
  //checkout, to try the template before anything is published.
  create({
    dir: path.resolve(name),
    name,
    adaptv: process.env.ADAPTV_SPEC || undefined,
  })
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

const next = [`cd ${name}`, `${pm} install`, runCommand(pm, "dev")]
process.stdout.write(
  `  ${c.green(GLYPH.ok)} created ${name}\n\n${next.map((l) => `    ${c.dim(l)}\n`).join("")}\n`,
)
