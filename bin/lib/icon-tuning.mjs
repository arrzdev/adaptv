// The numeric knobs on `gen icons`, and what adaptv says about the values it is handed.
//
// The whole point of these flags is that adaptv's defaults are opinions, and a power user should
// be able to take them back. So the rule is the one the rest of the command follows: **refuse
// only what cannot be used, warn about what merely looks unwise, and stay silent on a value that
// is simply not the default.**
//
//   ✖  outside the range        a margin of 90% leaves no icon; there is nothing to generate
//   !  inside it but unusual    `--margin 0` fills the mask exactly, which is legal and tight
//   ·  anything in the band     including values that are not the default — passing a flag is
//                               not itself something to comment on
//
// Pure: no fs, no sharp, no printing. The CLI collects the errors and warnings and renders them
// under the banner with everything else it already knew (R33).
import { DEFAULT_MARGIN } from "./icon-geometry.mjs"

/**
 * Every tunable, as `[min, max]` it can be used at and `[low, high]` it is unremarkable in.
 *
 * The two ranges are doing different jobs. The outer one is arithmetic — past it the command
 * cannot produce an icon set. The inner one is judgement, and being outside it is a `!`, never
 * a refusal: someone deliberately typing `--margin 0` has a reason, and adaptv's job is to make
 * sure they meant it, not to overrule them.
 */
export const TUNING = {
  margin: {
    min: 0,
    max: 50,
    band: [DEFAULT_MARGIN, 30],
    fallback: DEFAULT_MARGIN,
    what: "room left inside every slot's limit",
  },
  padding: {
    min: 0,
    max: 40,
    band: [0, 25],
    fallback: 0,
    what: "extra inset on every icon",
  },
}

/**
 * Read the numeric flags — `{ values, errors, warnings }`.
 *
 * All of them at once rather than one per call, because a run with two bad numbers should say
 * both under the banner instead of making the dev fix them one command at a time (R33).
 */
export function parseTuning(flags) {
  const values = {}
  const errors = []
  const warnings = []

  for (const [name, spec] of Object.entries(TUNING)) {
    const raw = flags[name]
    if (raw === undefined || raw === true) {
      values[name] = spec.fallback
      continue
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < spec.min || n > spec.max) {
      errors.push(
        `'--${name}' must be a percentage between ${spec.min} and ${spec.max}, got ${JSON.stringify(String(raw))}`,
      )
      values[name] = spec.fallback
      continue
    }
    values[name] = n
    const [low, high] = spec.band
    if (n < low) warnings.push(tighter(n, low))
    else if (n > high) warnings.push(looser(name, n, spec))
  }

  return { values, errors, warnings }
}

/**
 * Below the band: the dev has asked for less room than adaptv leaves, which is the direction
 * that can actually cost them pixels. Named as the consequence, not as "you disagreed with us".
 *
 * Only `--margin` can get here: padding's band starts at its own minimum, and a value under
 * the minimum is an error above, never a warning.
 */
function tighter(n, low) {
  return n === 0
    ? `--margin 0 leaves no room, so art sits flush to every edge`
    : `--margin ${n} leaves less room than the ${low}% default`
}

/** Above the band: legal, and the mark starts getting small. */
function looser(name, n, spec) {
  const [, high] = spec.band
  if (name === "margin")
    return `--margin ${n} shrinks the mark a long way in (${high}% is a lot)`
  return `--padding ${n} is a lot on top of the fit adaptv already computes`
}
