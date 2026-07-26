//next append slot for a position-ordered collection. max+1 (not count) so the
//new row lands after everything, surviving gaps left by earlier deletes.
export function nextPosition(
  docs: readonly { position: number }[],
): number {
  const maxPosition = docs.reduce(
    (max, doc) => Math.max(max, doc.position),
    -1,
  )
  return maxPosition + 1
}
