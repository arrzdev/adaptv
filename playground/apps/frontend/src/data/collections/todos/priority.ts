//priority is an optional 1-4 scale; higher = more urgent. absent = "None".
//the former "Lowest" level was removed; db migration v17 remaps the old 2-5
//scale down to 1-4 and drops legacy Lowest todos to "None".

export type PriorityLevel = {
  value: number
  label: string
  //colored dot/bar — maps to a --color-priority-* theme token
  dotClassName: string
  //matching text color for the same token
  textClassName: string
}

//ascending 1 -> 4 (Low -> Urgent). class names are literal so Tailwind keeps them
export const PRIORITY_LEVELS: readonly PriorityLevel[] = [
  {
    value: 1,
    label: "Low",
    dotClassName: "bg-priority-low",
    textClassName: "text-priority-low",
  },
  {
    value: 2,
    label: "Medium",
    dotClassName: "bg-priority-medium",
    textClassName: "text-priority-medium",
  },
  {
    value: 3,
    label: "High",
    dotClassName: "bg-priority-high",
    textClassName: "text-priority-high",
  },
  {
    value: 4,
    label: "Urgent",
    dotClassName: "bg-priority-urgent",
    textClassName: "text-priority-urgent",
  },
]

function findLevel(priority?: number): PriorityLevel | undefined {
  if (priority === undefined) return undefined
  return PRIORITY_LEVELS.find((level) => level.value === priority)
}

//coerce any legacy/stored value to a real level or undefined ("None").
//covers todos created before priority existed and out-of-range values
export function normalizePriority(priority?: unknown): number | undefined {
  if (typeof priority !== "number") return undefined
  return PRIORITY_LEVELS.some((level) => level.value === priority)
    ? priority
    : undefined
}

export function priorityLabel(priority?: number): string {
  return findLevel(priority)?.label ?? "No priority"
}

export function priorityDotClassName(
  priority?: number,
): string | undefined {
  return findLevel(priority)?.dotClassName
}

export function priorityTextClassName(
  priority?: number,
): string | undefined {
  return findLevel(priority)?.textClassName
}

//sort weight — absent priority ranks below every real level
export function priorityRank(priority?: number): number {
  return priority ?? 0
}
