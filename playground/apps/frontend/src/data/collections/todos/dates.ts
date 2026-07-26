//local-time date helpers for grouping/labeling todos. no date library in the
//repo, so these stay small and dependency-free.

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime()
}

//whole-day difference (a - b); positive when a is later than b
export function diffInDays(a: Date, b: Date): number {
  return Math.round(
    (startOfDay(a).getTime() - startOfDay(b).getTime()) / MS_PER_DAY,
  )
}

//stable per-day key for grouping, e.g. "2026-06-21"
export function dayKey(date: Date): string {
  const day = startOfDay(date)
  const month = `${day.getMonth() + 1}`.padStart(2, "0")
  const dom = `${day.getDate()}`.padStart(2, "0")
  return `${day.getFullYear()}-${month}-${dom}`
}

//"19/01" — appends the year only when it differs from now. built by hand (not
//toLocaleDateString) so the prerender/Worker runtime can't reformat it
function formatMonthDay(date: Date, now: Date): string {
  const dd = `${date.getDate()}`.padStart(2, "0")
  const mm = `${date.getMonth() + 1}`.padStart(2, "0")
  if (date.getFullYear() === now.getFullYear()) return `${dd}/${mm}`
  return `${dd}/${mm}/${date.getFullYear()}`
}

export function dueDateLabel(
  dueAt?: Date,
  now: Date = new Date(),
): string {
  if (!dueAt) return "No due date"

  const days = diffInDays(dueAt, now)
  if (days < 0) return "Overdue"
  if (days === 0) return "Due today"
  if (days === 1) return "Due tomorrow"
  return `Due ${formatMonthDay(dueAt, now)}`
}

//section title for the created sort — the "Added" prefix makes the view obvious
export function createdGroupLabel(
  createdAt: Date,
  now: Date = new Date(),
): string {
  const days = diffInDays(createdAt, now)
  if (days === 0) return "Added today"
  if (days === -1) return "Added yesterday"
  return `Added ${formatMonthDay(createdAt, now)}`
}

//section title for the updated sort — mirrors createdGroupLabel with "Updated"
export function updatedGroupLabel(
  updatedAt: Date,
  now: Date = new Date(),
): string {
  const days = diffInDays(updatedAt, now)
  if (days === 0) return "Updated today"
  if (days === -1) return "Updated yesterday"
  return `Updated ${formatMonthDay(updatedAt, now)}`
}

export function isOverdue(dueAt: Date, now: Date = new Date()): boolean {
  return diffInDays(dueAt, now) < 0
}

export type DueTone = "overdue" | "soon" | "default"

//color urgency for the due label — amber as the date approaches, red on the due
//day and after. far-off and completed todos stay neutral (caller passes
//"default" for those)
export function dueTone(dueAt: Date, now: Date = new Date()): DueTone {
  const days = diffInDays(dueAt, now)
  if (days <= 0) return "overdue"
  if (days <= 3) return "soon"
  return "default"
}

//inline due label for cards — a day counter for the near window, where "in 5
//days" reads faster than a date, and an absolute date once that stops helping
export function dueRelativeLabel(
  dueAt: Date,
  now: Date = new Date(),
): string {
  const days = diffInDays(dueAt, now)
  if (days < 0) {
    const overdue = Math.abs(days)
    return overdue === 1 ? "1 day overdue" : `${overdue} days overdue`
  }
  if (days === 0) return "Due today"
  if (days === 1) return "Due tomorrow"
  if (days < 7) return `Due in ${days} days`
  return `Due ${formatMonthDay(dueAt, now)}`
}

//casual relative age, e.g. "today", "3d ago", "2 wk ago", "5 mo ago"
export function relativeFromNow(
  date: Date,
  now: Date = new Date(),
): string {
  const days = Math.abs(diffInDays(date, now))
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.round(days / 7)} wk ago`
  if (days < 365) return `${Math.round(days / 30)} mo ago`
  return `${Math.round(days / 365)} yr ago`
}
