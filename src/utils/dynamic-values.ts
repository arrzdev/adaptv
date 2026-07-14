//tailwind spacing: unit n → n * 0.25rem (e.g. 8 → 2rem)
export const TAILWIND_UNIT_REM = 0.25

export type DynamicValuesContext = {
  size: number
  /**size * unitRem; use as the main rem edge when size is a tailwind spacing index*/
  edgeRem: number
}

export function dynamicValues<T>(input: {
  size: number
  /**rem per tailwind spacing unit; default matches tailwind default theme*/
  unitRem?: number
  derive: (ctx: DynamicValuesContext) => T
}): T {
  const unitRem = input.unitRem ?? TAILWIND_UNIT_REM
  const edgeRem = input.size * unitRem
  return input.derive({ size: input.size, edgeRem })
}
