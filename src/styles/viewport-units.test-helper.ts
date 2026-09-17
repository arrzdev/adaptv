import { expect } from "vitest"
import { compileAdaptvStyles } from "#adaptv/styles/compile.test-helper"

/*
 * Resolve a compiled height rule the way a phone would, for the viewport-unit expressions
 * no DOM we can test in resolves like an iPhone: Playwright's Chromium and WebKit resolve
 * 100vh to the viewport even with a taller screen, and none of them starts an installed
 * app's page below the status bar. The caller hands in viewport numbers read off a
 * simulator; this picks the rule the cascade would pick on that surface and does the
 * arithmetic.
 *
 * Limits, on purpose: `--adaptv-inset-top` always resolves to `surface.insetTop`, so a
 * rule's fallback for it is never exercised (styles/safe-area.css always defines it), and
 * only the selectors adaptv writes are modelled; anything else throws.
 */

export type ViewportSurface = {
  /** What `html[data-adaptv-platform]` is stamped with. */
  platform: "web" | "standalone" | "native"
  vh: number
  dvh: number
  /** What `--adaptv-inset-top` resolves to, in px. */
  insetTop: number
  /** Other custom properties that are set, as CSS values. Unset ones take their fallback. */
  vars?: Record<string, string>
}

type Rule = { conditions: string[]; value: string }

//every `property:` declaration in compiled CSS, with the selector and at-rule headers it
//is nested under
function declarations(css: string, property: string): Rule[] {
  const rules: Rule[] = []
  const stack: string[] = []
  for (const raw of css.split("\n")) {
    const line = raw.trim()
    if (line.endsWith("{")) stack.push(line.slice(0, -1).trim())
    else if (line === "}") stack.pop()
    else if (line.startsWith(`${property}:`)) {
      rules.push({
        conditions: [...stack],
        value: line.slice(property.length + 1, -1).trim(),
      })
    }
  }
  return rules
}

//the rule the cascade picks among rules of one layer: the highest specificity, and on a
//tie the later rule
function pick(
  rules: Rule[],
  surface: ViewportSurface,
  specificityOn: (rule: Rule, surface: ViewportSurface) => number | null,
): string | null {
  let best: { specificity: number; value: string } | null = null
  for (const rule of rules) {
    const specificity = specificityOn(rule, surface)
    if (specificity === null) continue
    if (!best || specificity >= best.specificity) {
      best = { specificity, value: rule.value }
    }
  }
  return best?.value ?? null
}

//a utility: whether its variant applies on this surface, and how much the variant adds
function utilitySpecificity(
  rule: Rule,
  surface: ViewportSurface,
): number | null {
  let specificity = 0
  for (const condition of rule.conditions) {
    if (condition === "@layer utilities" || condition.startsWith("."))
      continue
    if (condition === "@media (display-mode: standalone)") {
      if (surface.platform !== "standalone") return null
      continue
    }
    const platform = condition.match(/data-adaptv-platform="?(\w+)"?/)
    if (!platform) throw new Error(`unmodelled condition: ${condition}`)
    if (platform[1] !== surface.platform) return null
    if (!condition.includes(":where(")) specificity += 1
  }
  return specificity
}

//the `@layer utilities { ... }` block alone: adaptv's own layers lose to it whatever
//their specificity, so they are not competitors
function utilitiesBlock(css: string): string {
  const start = css.indexOf("@layer utilities {")
  if (start === -1) throw new Error("no @layer utilities block")
  let depth = 0
  for (let at = start; at < css.length; at++) {
    if (css[at] === "{") depth++
    else if (css[at] === "}" && --depth === 0)
      return css.slice(start, at + 1)
  }
  throw new Error("unclosed @layer utilities block")
}

/** min(), max(), calc() and var() over px, vh and dvh. */
export function evaluateLength(
  value: string,
  surface: ViewportSurface,
): number {
  let at = 0
  const skip = () => {
    while (value[at] === " ") at++
  }
  const close = (what: string) => {
    skip()
    expect(value[at], `unclosed ${what} in ${value}`).toBe(")")
    at++
  }
  const term = (): number => {
    skip()
    const variable = value.slice(at).match(/^var\((--[\w-]+)/)
    if (variable) {
      at += variable[0].length
      const name = variable[1] as string
      skip()
      let fallback: number | null = null
      if (value[at] === ",") {
        at++
        fallback = sum()
      }
      close("var(")
      if (name === "--adaptv-inset-top") return surface.insetTop
      const set = surface.vars?.[name]
      if (set !== undefined) return evaluateLength(set, surface)
      if (fallback === null)
        throw new Error(`${name} is unset with no fallback`)
      return fallback
    }
    const fn = value.slice(at).match(/^(min|max|calc)\(/)
    if (fn) {
      at += fn[0].length
      const args = [sum()]
      skip()
      while (value[at] === ",") {
        at++
        args.push(sum())
        skip()
      }
      close(`${fn[1]}(`)
      if (fn[1] === "min") return Math.min(...args)
      if (fn[1] === "max") return Math.max(...args)
      return args[0] as number
    }
    const length = value.slice(at).match(/^(-?[\d.]+)(px|dvh|vh)/)
    if (!length)
      throw new Error(`cannot resolve "${value.slice(at)}" in ${value}`)
    at += length[0].length
    const n = Number(length[1])
    if (length[2] === "px") return n
    return (n / 100) * (length[2] === "vh" ? surface.vh : surface.dvh)
  }
  const sum = (): number => {
    let total = term()
    skip()
    while (value[at] === "+" || value[at] === "-") {
      const sign = value[at] === "+" ? 1 : -1
      at++
      total += sign * term()
      skip()
    }
    return total
  }
  const result = sum()
  skip()
  expect(at, `trailing input in ${value}`).toBe(value.length)
  return result
}

/** Compile `classes` and resolve `property` on `surface`, as the cascade would pick it. */
export async function resolveCompiledLength(
  classes: string,
  property: "height" | "max-height",
  surface: ViewportSurface,
): Promise<number> {
  const css = await compileAdaptvStyles(classes.split(/\s+/))
  const rules = declarations(utilitiesBlock(css), property)
  const value = pick(rules, surface, utilitySpecificity)
  if (value === null)
    throw new Error(`no ${property} applies on ${surface.platform}`)
  return evaluateLength(value, surface)
}

/**
 * Resolve `property` for the element `target` (an attribute selector such as
 * `[data-app-shell]`) from adaptv's own layered rules, which are written either bare or
 * under an `html[data-adaptv-platform="..."]` ancestor. They must all sit in one layer.
 */
export async function resolveLayeredLength(
  target: string,
  property: "height" | "max-height",
  surface: ViewportSurface,
): Promise<number> {
  const css = await compileAdaptvStyles([])
  const rules = declarations(css, property).filter((rule) => {
    const selector = rule.conditions.at(-1) ?? ""
    if (!selector.includes(target)) return false
    //a state or pseudo after the target could win and would go unseen
    if (!selector.endsWith(target))
      throw new Error(`unmodelled selector: ${selector}`)
    return true
  })
  const layers = new Set(
    rules.map((rule) => rule.conditions.slice(0, -1).join(" ")),
  )
  if (
    layers.size !== 1 ||
    !/^@layer adaptv\.\w+$/.test([...layers][0] ?? "")
  )
    throw new Error(
      `${target} ${property} must sit in one adaptv layer: ${[...layers].join(" | ")}`,
    )
  const value = pick(rules, surface, (rule) => {
    const ancestor = (rule.conditions.at(-1) as string)
      .slice(0, -target.length)
      .trim()
    if (ancestor === "") return 0
    const platform = ancestor.match(
      /^html\[data-adaptv-platform="(\w+)"\]$/,
    )
    if (!platform)
      throw new Error(`unmodelled selector: ${ancestor} ${target}`)
    return platform[1] === surface.platform ? 1 : null
  })
  if (value === null)
    throw new Error(
      `no ${target} ${property} applies on ${surface.platform}`,
    )
  return evaluateLength(value, surface)
}
