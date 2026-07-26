//"3 tasks" / "1 task" — pick singular or plural by count. shared by the delete
//drawers so their destructive-copy pluralization stays identical.
export function formatCount(
  count: number,
  singular: string,
  plural: string,
) {
  return `${count} ${count === 1 ? singular : plural}`
}
