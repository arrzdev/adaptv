// Argument parsing. The ONLY module in the CLI that imports commander.
//
// Commander is a second engine, and `render.mjs` owns every byte the CLI prints — so this
// module's whole job is to let commander do the parsing while never letting it say anything.
// It is silenced four independent ways (see `quiet()`), because the failure mode is not a
// crash but a foreign sentence in a visual language the rest of the CLI spent 43 rules
// defining. `engine.test.mjs` asserts the quarantine: no other file may import commander.
//
// The other design point is that we never READ commander's prose. Every error path is
// intercepted at the method that raises it, and what comes out is a structured fault carrying
// the offending TOKEN — the sentence is chosen by us, from the spec. A commander version bump
// can therefore change its own wording freely without changing a word the dev sees.
import { Command } from "commander"
import {
  commandAt,
  commandNames,
  flagsFor,
  matchCommand,
  SPEC,
  suggest,
} from "./cli-spec.mjs"

/**
 * A problem with the INVOCATION — the dev typed something that cannot run. Distinct from a
 * run failure: nothing has started, so there is nothing to tear down and nothing to report
 * beyond the sentence and the fix. Carries a `kind` the renderer and `--json` both switch on.
 */
export class CliFault extends Error {
  constructor(kind, fields = {}) {
    super(kind)
    this.name = "CliFault"
    this.kind = kind
    Object.assign(this, fields)
  }
}

/**
 * Split off everything after a lone `--`.
 *
 * Done BEFORE commander sees argv, because commander folds post-`--` tokens in with the
 * operands and the boundary is exactly what `viteArgs` needs. One line of hand-rolled parsing,
 * kept deliberately.
 */
export function splitPassthrough(argv) {
  const i = argv.indexOf("--")
  return i === -1
    ? { head: argv, after: null }
    : { head: argv.slice(0, i), after: argv.slice(i + 1) }
}

/** A commander `Command` that cannot print, cannot exit, and cannot invent a sentence. */
function quiet(name) {
  const program = new Command(name)
  program
    //1. nothing commander decides to say reaches a stream, on any path, ever.
    .configureOutput({
      writeOut: () => {},
      writeErr: () => {},
      outputError: () => {},
    })
    //2. `_exit` throws instead of killing the process — we own every exit code.
    .exitOverride()
    //3. commander's own help layout never runs; ours is rendered from the spec.
    .configureHelp({ formatHelp: () => "" })
    //4. its built-ins are off: `-h`/`-V` are ordinary spec flags here, so the action handler
    //   knows WHICH command was asked about — commander's CommanderError does not carry that.
    .helpOption(false)
    .helpCommand(false)
    .allowExcessArguments(false)
    .showSuggestionAfterError(false)
    .showHelpAfterError(false)
  return program
}

/**
 * Replace every path where commander would compose an English error with one that throws a
 * structured fault instead. These are all real prototype methods.
 */
function intercept(program, path) {
  program.unknownOption = (flag) => {
    //Matched against the flags THIS command accepts, not every flag in the CLI — proposing
    //`--input` to someone running `dev` would be a correction that cannot work.
    throw new CliFault("unknown-flag", {
      token: flag,
      path,
      suggestions: suggest(flag, knownFlags(path)),
    })
  }
  program.missingArgument = (name) => {
    throw new CliFault("missing-arg", { name, path })
  }
  program.optionMissingArgument = (option) => {
    throw new CliFault("flag-needs-value", { long: option.long, path })
  }
  program.missingMandatoryOptionValue = (option) => {
    throw new CliFault("missing-flag", { long: option.long, path })
  }
  //Called with EVERY operand, not just the surplus ones, and called regardless of
  //`allowExcessArguments` — the flag is checked inside the default implementation, which this
  //replaces. So the arity is applied here.
  program._excessArguments = (received) => {
    const declared = commandAt(path)?.args.length ?? 0
    throw new CliFault("excess-args", {
      received: received.slice(declared),
      path,
    })
  }
  return program
}

/** `--target <id>` → the commander flag string, including the short form when there is one. */
function flagString(f) {
  const names = f.short ? `-${f.short}, --${f.long}` : `--${f.long}`
  return f.value ? `${names} ${f.value}` : names
}

/**
 * Global flags, accepted before any command: `adaptv --help`, `adaptv --version`.
 * Deliberately tiny — everything else belongs to a command.
 */
const GLOBALS = [
  { long: "help", short: "h", describe: "show help for a command" },
  { long: "version", short: "v", describe: "print the version and exit" },
]

const isGlobal = (t) =>
  t === "--help" || t === "-h" || t === "--version" || t === "-v"

/**
 * argv → `{ path, flags, rest, viteArgs, help, version }`, or a thrown {@link CliFault}.
 *
 * The `flags` object is deliberately the SAME shape the hand-rolled parser produced — every
 * adaptv flag is a single lowercase word, so commander's camel-casing is a no-op and every
 * command that reads `flags.target` / `flags.viteArgs` is untouched by this rewrite. That is
 * what makes the migration safe rather than merely tested.
 */
export function parse(argv) {
  const { head, after } = splitPassthrough(argv)

  // `--help` / `--version` before any command, and bare `adaptv`.
  if (head.length === 0)
    return { path: [], flags: {}, rest: [], help: true }
  if (head.every(isGlobal)) {
    return {
      path: [],
      flags: {},
      rest: [],
      help: head.some((t) => t === "--help" || t === "-h"),
      version: head.some((t) => t === "--version" || t === "-v"),
    }
  }

  // `adaptv help [command]` — kept because it works today.
  if (head[0] === "help") {
    const { cmd } = matchCommand(head.slice(1))
    return { path: cmd?.path ?? [], flags: {}, rest: [], help: true }
  }

  const { cmd, rest } = matchCommand(head)
  if (!cmd) {
    const token = head[0]
    const retired = SPEC.retired.find((r) => r.path[0] === token)
    if (retired)
      throw new CliFault("retired-command", {
        token,
        reason: retired.reason,
        suggestion: retired.suggest(head.slice(1)),
      })
    throw new CliFault("unknown-command", {
      token,
      suggestions: suggest(token, commandNames()),
    })
  }

  const path = cmd.path
  if (after !== null && !cmd.passthrough)
    throw new CliFault("no-passthrough", { path })

  // `--help` wins over everything, and is answered BEFORE commander parses. Otherwise a
  // command with a required flag refuses to explain itself: `adaptv gen icons --help` failed
  // with "needs '--input'", which is the one question the dev was asking.
  if (rest.some((t) => t === "--help" || t === "-h"))
    return { path, flags: {}, rest: [], help: true }

  const program = intercept(quiet(SPEC.name), path)
  //Declared OPTIONAL even when the spec requires it, so a missing surface is our error —
  //naming the choices and suggesting a correction — rather than commander's "missing argument".
  for (const a of cmd.args) program.argument(`[${a.name}]`)
  for (const f of [...GLOBALS, ...flagsFor(cmd)]) {
    const spec = f.value ? f : { ...f, value: null }
    const opt = program.createOption(flagString(spec), f.describe)
    if (f.parse)
      //A PLAIN error, deliberately not commander's `InvalidArgumentError`: that one gets
      //wrapped in "option '--x <y>' argument 'z' is invalid. …", so the dev would read
      //commander's sentence with ours stapled to the end. This passes straight through.
      opt.argParser((raw) => f.parse(raw))
    //`--host [ip]` with no value arrives as `true`; the spec's parser decides what that means.
    if (f.required) opt.makeOptionMandatory(true)
    program.addOption(opt)
  }

  try {
    program.parse(rest, { from: "user" })
  } catch (err) {
    if (err instanceof CliFault) throw err
    //An `InvalidArgumentError` reaches here wrapped by commander; the message is already ours.
    const message = String(err?.message ?? "").replace(/^error:\s*/i, "")
    throw new CliFault("invalid-value", { message, path })
  }

  const flags = program.opts()
  if (flags.help) return { path, flags: {}, rest: [], help: true }

  const positionals = program.args
  const arg = cmd.args[0]
  if (arg) {
    const given = positionals[0]
    if (given === undefined && arg.required)
      throw new CliFault("missing-surface", { path, choices: arg.choices })
    if (given !== undefined && !arg.choices.includes(given))
      throw new CliFault("unknown-surface", {
        token: given,
        path,
        choices: arg.choices,
        //`build web` is a word that means something elsewhere — say where, don't list.
        rejection: arg.rejects?.[given] ?? null,
        suggestions: suggest(given, arg.choices),
      })
  }
  if (positionals.length > (arg ? 1 : 0))
    throw new CliFault("excess-args", {
      path,
      received: positionals.slice(arg ? 1 : 0),
    })

  for (const c of cmd.conflicts ?? []) {
    if (flags[c.flag] !== undefined && c.whenArg.includes(positionals[0]))
      throw new CliFault("conflict", { path, reason: c.reason })
  }

  //`viteArgs` is always present, as it was before, so callers need no null check.
  const { help: _h, version: _v, ...rest_ } = flags
  return {
    path,
    flags: { ...rest_, viteArgs: after ?? [] },
    rest: positionals,
    viteArgs: after ?? [],
  }
}

/** Every flag name a command accepts — the candidate list for a did-you-mean. */
export function knownFlags(path) {
  const cmd = commandAt(path)
  return [
    ...GLOBALS.map((g) => `--${g.long}`),
    ...flagsFor(cmd).map((f) => `--${f.long}`),
  ]
}
