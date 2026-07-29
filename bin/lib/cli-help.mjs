// The help page and the invocation-failure page, composed from the spec.
//
// Both are STATIC pages: printed once, never redrawn. That is why they wrap instead of
// clipping (R44) — a live row must fit one physical line because it is redrawn in place, and
// neither of these ever is. Losing the tail of an error to `…` costs the dev the instructions
// (R15); losing the tail of a flag description costs them the reason it exists, which is the
// complaint this whole change answers.
//
// Everything here goes through `render.mjs`. Nothing writes to a stream.
import {
  commandAt,
  flagSyntax,
  flagsFor,
  orList,
  SPEC,
  usageLines,
} from "./cli-spec.mjs"
import {
  c,
  header,
  helpText,
  lineBlock,
  paragraph,
  section2,
  spacer,
  table,
  usageFail,
} from "./render.mjs"

/**
 * `adaptv --version` — one bare line and nothing else.
 *
 * No banner, no indent, no colour: a version is DATA. `adaptv --version` is read by scripts
 * far more often than by people, and the convention every other CLI follows is a single line
 * that can be captured without post-processing.
 */
export function renderVersion(version) {
  helpText(version)
}

/**
 * The top-level page: what the CLI is, its commands, and how to go deeper. Deliberately does
 * NOT list every flag of every command — that is what `adaptv <command> --help` is for, and
 * the old single page listing all of them is what grew to 40 lines nobody read.
 */
function overview() {
  header(SPEC.name)
  paragraph(SPEC.tagline)
  lineBlock("Usage", [`${SPEC.name} <command> [surface] [options]`])
  section2(
    "Commands",
    SPEC.commands.map((cmd) => ({
      left: cmd.path.join(" "),
      right: cmd.summary,
    })),
  )
  section2("Options", [
    { left: "-h, --help", right: "show help for a command" },
    { left: "-v, --version", right: "print the version and exit" },
  ])
  paragraph(
    `'${SPEC.name} <command> --help' explains that command's flags and what each is for.`,
  )
  spacer()
}

/** One command's page: what it does, how to call it, and every flag it accepts. */
function commandPage(cmd) {
  header(cmd.path.join(" "))
  paragraph(cmd.summary)

  lineBlock("Usage", usageLines(cmd))

  const arg = cmd.args[0]
  if (arg)
    section2(
      "Surfaces",
      arg.choices.map((ch) => ({
        left: ch,
        right: SURFACE_HELP[ch] ?? "",
      })),
    )

  //Two groups, because a flag nobody should need next to one everybody does makes both harder
  //to find. `--host` is the worked example: correct by default, and only ever reached for when
  //detection guessed wrong.
  const flags = flagsFor(cmd)
  const common = flags.filter((f) => f.group === "common")
  const advanced = flags.filter((f) => f.group !== "common")
  const row = (f) => ({
    left: flagSyntax(f),
    right: f.required ? `${f.describe} (required)` : f.describe,
  })
  section2("Options", common.map(row))
  section2("Advanced", advanced.map(row))

  //A titled block, not a headingless one: a section with no heading reads as stray output,
  //and `--` is a flag as far as the dev is concerned.
  if (cmd.passthrough)
    section2("Passthrough", [
      {
        left: `-- ${cmd.passthrough.token}`,
        right: cmd.passthrough.describe,
      },
    ])

  for (const p of cmd.prose ?? []) paragraph(p)

  lineBlock("Examples", cmd.examples)
  spacer()
}

/** What each surface actually runs — the same words in every command's page. */
const SURFACE_HELP = {
  web: "the dev server or web build alone, no device",
  ios: "a simulator, or a connected iPhone",
  android: "an emulator, or a connected device",
  all: "every surface at once",
}

/** `adaptv --help`, or `adaptv <command> --help`. */
export function renderHelp(path) {
  const cmd = path?.length ? commandAt(path) : null
  if (cmd) commandPage(cmd)
  else overview()
}

/** `— did you mean 'x'?`, or nothing at all when nothing is close enough. */
const didYouMean = (s) =>
  s?.length ? ` — did you mean ${orList(s)}?` : ""

/** The one-line synopsis shown under an error, as the dim fix line. */
const synopsis = (path) => {
  const cmd = commandAt(path)
  return cmd ? usageLines(cmd) : []
}

/**
 * An invocation that cannot run.
 *
 * Every branch says the same three things in the same order: what was wrong, what you probably
 * meant, and the shape that would have worked. A VALUE error gets no synopsis — the shape was
 * not the problem, and repeating it implies it was (R35).
 */
export function renderFault(fault) {
  const where = fault.path?.length ? ` for '${fault.path.join(" ")}'` : ""
  switch (fault.kind) {
    case "unknown-command":
      return usageFail(
        `unknown command '${fault.token}'${didYouMean(fault.suggestions)}`,
        [`'${SPEC.name} --help' lists every command`],
      )

    case "retired-command":
      return usageFail(
        `${fault.reason} — did you mean '${fault.suggestion}'?`,
      )

    case "unknown-flag":
      return usageFail(
        `unknown flag '${fault.token}'${where}${didYouMean(fault.suggestions)}`,
        synopsis(fault.path),
      )

    case "flag-needs-value": {
      const f = flagsFor(commandAt(fault.path)).find(
        (x) => `--${x.long}` === fault.long,
      )
      return usageFail(
        `'${fault.long}' needs a value — ${f?.describe ?? "see --help"}`,
      )
    }

    case "missing-flag": {
      const f = flagsFor(commandAt(fault.path)).find(
        (x) => `--${x.long}` === fault.long,
      )
      return usageFail(
        `${where.trim() || "this command"} needs '${fault.long}' — ${f?.describe ?? ""}`,
        synopsis(fault.path),
      )
    }

    case "invalid-value":
      //No synopsis: they typed the right shape with the wrong contents.
      return usageFail(fault.message)

    case "missing-surface":
      return usageFail(
        `'${fault.path.join(" ")}' needs a surface — one of ${fault.choices.join(", ")}`,
        synopsis(fault.path),
      )

    case "unknown-surface":
      //`build web` is a word that means something ELSEWHERE in the CLI, so the honest answer
      //names the command that has it rather than listing the ones that don't.
      return usageFail(
        fault.rejection
          ? `'${fault.path.join(" ")}' has no '${fault.token}' surface — ${fault.rejection}`
          : `unknown surface '${fault.token}'${where}${didYouMean(fault.suggestions)}`,
        fault.rejection ? [] : synopsis(fault.path),
      )

    case "conflict":
      return usageFail(fault.reason, synopsis(fault.path))

    case "no-passthrough":
      return usageFail(
        `'${fault.path.join(" ")}' forwards nothing after '--'`,
        [
          `only ${orList(
            SPEC.commands
              .filter((x) => x.passthrough)
              .map((x) => x.path.join(" ")),
          )} reach vite`,
        ],
      )

    case "excess-args":
      return usageFail(
        `${where.trim() || SPEC.name} does not take ${orList(fault.received)}`,
        synopsis(fault.path),
      )

    default:
      return usageFail(fault.message ?? String(fault))
  }
}

/** Exported for the tests, which assert the page never exceeds the terminal width. */
export { commandPage, overview, table, c }
