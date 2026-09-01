/**
 * How `doctor` reports on adaptv's OWN install.
 *
 * `doctor` answers one question: can this machine build this app, and if not, what do I
 * install? Every other row in it is about something the dev owns and can act on one at a
 * time — node, the Android SDK, a JDK, Xcode, their icon directory. This row is not. The
 * native command adaptv drives and the native modules it ships are adaptv's own
 * dependencies, resolved from adaptv's own package root, absent from the consumer's
 * `package.json` entirely (`src/native/installed-plugins.ts`). The dev did not choose them,
 * cannot install one of them, and has exactly one remedy for any of them: reinstall.
 *
 * So this is ONE fact with ONE action, and it used to be printed as twelve rows carrying the
 * vendor's name twelve times, under a heading that said out loud they were adaptv's:
 *
 *     ✓ capacitor cli  · 8.4.2
 *
 *     Plugins (shipped by adaptv; the consumer installs none)
 *     ✓ @capacitor/app
 *     ✓ @capacitor/browser
 *     … nine more
 *
 * Twelve of the thirty-one lines on the screen, teaching the consumer the one thing the
 * architecture spends its budget hiding (R8), in the command they run when something is
 * already wrong and they are most likely to go and search what they read.
 *
 * The shape of the fix is R8b's: adaptv owns its plumbing OUT LOUD but never BY NAME. The
 * row says whose install it is and whether it is usable; the failure says what to do about
 * it. Nothing is hidden that the dev could have acted on, because there was nothing there
 * they could act on. The names are real diagnostic value for whoever is debugging adaptv
 * itself rather than an app, and they are kept — under `--verbose`, which is raw by
 * contract.
 *
 * Pure on purpose: `bin/adaptv.mjs` runs the CLI on import, so copy that lives there cannot
 * be tested, which is the same reason `explainFailure` moved out of it.
 */

/** The row's label, in Core, alongside `node`. */
const LABEL = "adaptv's own install"

/**
 * The whole report for one `doctor` run, from the facts gathered about adaptv's install.
 *
 * `modules` is every native module checked and `missing` the ones that did not resolve;
 * `runnable` is whether the native command adaptv drives answered at all, and `version` what
 * it said. Both halves fail the same way and are fixed the same way, so they settle on one
 * line rather than two: a dev whose install is broken does not need to know which half.
 */
export function describeOwnInstall({
  modules = [],
  missing = [],
  runnable = false,
  version = null,
  verbose = false,
}) {
  const ok = runnable && missing.length === 0
  return {
    ok,
    label: LABEL,
    note: ok ? "complete" : "incomplete",
    //Terse, and each line names an action (R7). The second exists because `pnpm install` is
    //not always the answer: a genuinely broken publish needs a report, and a report needs the
    //names, so the one command that has them is named at the moment they are wanted. Under
    //`--verbose` the list is already on the screen, and a line pointing at what the next line
    //shows is the preamble R6 refuses.
    notices: ok
      ? []
      : verbose
        ? ["Reinstall with 'pnpm install'."]
        : [
            "Reinstall with 'pnpm install'.",
            "Run with '--verbose' to list what is missing.",
          ],
    //`--verbose` is the raw escape hatch and stays raw: this is the ONE surface in the CLI
    //where the engines may be named, and the only place these names are worth anything.
    detail: verbose
      ? [
          version ? `native cli ${version}` : "native cli did not run",
          ...modules.map((m) =>
            missing.includes(m) ? `${m}  MISSING` : m,
          ),
        ]
      : [],
  }
}
