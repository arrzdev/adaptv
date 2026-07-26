import { deepEqual } from "#synq/core/deep-equal"
import { compareHlc, maxHlc } from "#synq/core/hlc"
import type { AtomicGroups } from "#synq/types/schema.types"
import type {
  DocMeta,
  FieldConflict,
  Hlc,
  StoredDocument,
} from "#synq/types/synq.types"
import { CAUSAL_FIELD, ID_FIELD } from "#synq/types/synq.types"

//---- Field-level last-write-wins merge -----------------------------
//two versions of the same document converge here. each field carries its
//own HLC, so non-overlapping edits from different nodes all survive and
//only genuine same-field collisions are decided by the clock. the merge is
//a join over a product of semilattices — LWW-register per scalar field,
//observed-remove set per array field, max-register per tombstone, and an
//absorbing top for row deletion — so it is commutative, associative and
//idempotent: devices reach byte-identical state no matter the order or
//grouping they reconcile in.
//
//metadata key shapes:
//  "title"          scalar field stamp
//  "tags::urgent"   one element of an array-valued (set) field
//  tombstones use the same keys: "title" / "tags::urgent"

type PlainRow = Record<string, unknown>

const SEP = "::"

export interface MergeOptions {
  //field groups that resolve as one unit, preventing semantic splits
  //like keeping a new room number but an old price
  atomicGroups?: AtomicGroups
  //the last-synced common ancestor. when present, a scalar field that BOTH
  //sides changed relative to it is a genuine concurrent conflict: the LWW
  //loser is preserved in $meta.conflicts instead of silently vanishing. the
  //two-way merge (no base) only propagates existing conflicts, never captures.
  base?: StoredDocument<unknown>
}

export function mergeDocuments<T>(
  a: StoredDocument<T>,
  b: StoredDocument<T>,
  opts: MergeOptions = {},
): StoredDocument<T> {
  const aMeta = a[CAUSAL_FIELD]
  const bMeta = b[CAUSAL_FIELD]
  const id = ((a as PlainRow)[ID_FIELD] ??
    (b as PlainRow)[ID_FIELD]) as string

  //---- delete wins permanently --------------------------------------
  //a row delete is a terminal, absorbing fact: once either side deleted the
  //row, no concurrent or later field write can resurrect it (re-creating a
  //deleted id is unsupported — use a fresh id). this is where every shipped
  //field-LWW system converged; it makes deletes safe against a stale offline
  //edit and keeps the merged tombstone trivially bounded (no orphan stamps).
  const deletedAt = greater(aMeta.deletedAt, bMeta.deletedAt)
  if (deletedAt) {
    return {
      [ID_FIELD]: id,
      [CAUSAL_FIELD]: { fields: {}, tombstones: {}, deletedAt },
    } as StoredDocument<T>
  }

  const aRow = a as unknown as PlainRow
  const bRow = b as unknown as PlainRow
  const baseMeta = opts.base?.[CAUSAL_FIELD]
  const result: PlainRow = {}
  const fields: Record<string, Hlc> = {}
  const tombstones: Record<string, Hlc> = {}

  //carry forward both sides' preserved conflicts (a semilattice: union now,
  //garbage-collect superseded entries once the winners are known)
  const conflicts: Record<string, FieldConflict[]> = {}
  unionConflicts(conflicts, aMeta.conflicts)
  unionConflicts(conflicts, bMeta.conflicts)

  //union every tombstone, keeping the newest stamp per key (max-register)
  for (const meta of [aMeta, bMeta]) {
    for (const [key, stamp] of Object.entries(meta.tombstones)) {
      tombstones[key] = tombstones[key]
        ? maxHlc(tombstones[key], stamp)
        : stamp
    }
  }

  const setFields = collectSetFields(aMeta, bMeta)
  const grouped = new Set<string>()

  //---- atomic groups (resolve the whole block to one side) ----
  for (const group of opts.atomicGroups ?? []) {
    for (const f of group) grouped.add(f)
    const aStamp = groupStamp(aMeta, group)
    const bStamp = groupStamp(bMeta, group)
    if (!aStamp && !bStamp) continue
    const winnerIsA = pickGroup(aStamp, bStamp, aRow, bRow, group)
    const winnerRow = winnerIsA ? aRow : bRow
    const winnerStamp = (winnerIsA ? aStamp : bStamp) as Hlc
    for (const f of group) {
      if (Object.hasOwn(winnerRow, f)) {
        result[f] = winnerRow[f]
        fields[f] = winnerStamp
      }
    }
  }

  //---- per-field merge ----
  const keys = new Set<string>([
    ...Object.keys(aRow),
    ...Object.keys(bRow),
  ])
  keys.delete(ID_FIELD)
  keys.delete(CAUSAL_FIELD)
  for (const f of setFields) keys.add(f)

  for (const f of keys) {
    if (grouped.has(f)) continue
    if (setFields.has(f)) {
      mergeSetField(f, aMeta, bMeta, result, fields, tombstones)
      continue
    }
    mergeScalarField(
      f,
      aRow,
      bRow,
      aMeta,
      bMeta,
      baseMeta,
      result,
      fields,
      tombstones,
      conflicts,
    )
  }

  const liveConflicts = finalizeConflicts(conflicts, fields)
  const meta: DocMeta = liveConflicts
    ? { fields, tombstones, conflicts: liveConflicts }
    : { fields, tombstones }
  return {
    ...(result as T),
    [ID_FIELD]: id,
    [CAUSAL_FIELD]: meta,
  } as StoredDocument<T>
}

//the shadowed (losing) values preserved for each scalar field of a document.
//empty when the row has no recorded conflicts. the live value stays in the row
//data; these are the alternatives a UI can surface / let the user pick.
export function getConflicts<T>(
  doc: StoredDocument<T>,
): Record<string, FieldConflict[]> {
  const c = doc[CAUSAL_FIELD].conflicts
  if (!c) return {}
  const out: Record<string, FieldConflict[]> = {}
  for (const [f, list] of Object.entries(c)) out[f] = [...list]
  return out
}

//true when the document carries any unresolved concurrent-write conflict
export function hasConflicts<T>(doc: StoredDocument<T>): boolean {
  const c = doc[CAUSAL_FIELD].conflicts
  return !!c && Object.keys(c).length > 0
}

//a row is gone once it carries a deletion stamp — deletes are permanent
export function isDeleted<T>(doc: StoredDocument<T>): boolean {
  return !!doc[CAUSAL_FIELD].deletedAt
}

//structural equality of the developer-visible data (ignores causal $meta).
//used by the push-skip guard: if our merge already equals the server row,
//there is nothing to send.
export function documentsEqual<T>(
  a: StoredDocument<T>,
  b: StoredDocument<T>,
): boolean {
  return deepEqual(stripMeta(a), stripMeta(b))
}

//---- helpers ------------------------------------------------------

function stripMeta<T>(doc: StoredDocument<T>): PlainRow {
  const out: PlainRow = {}
  for (const key of Object.keys(doc as PlainRow)) {
    if (key === CAUSAL_FIELD) continue
    out[key] = (doc as PlainRow)[key]
  }
  return out
}

function collectSetFields(...metas: DocMeta[]): Set<string> {
  const names = new Set<string>()
  for (const meta of metas) {
    for (const key of Object.keys(meta.fields)) addSetName(key, names)
    for (const key of Object.keys(meta.tombstones)) addSetName(key, names)
  }
  return names
}

function addSetName(key: string, into: Set<string>): void {
  const i = key.indexOf(SEP)
  if (i >= 0) into.add(key.slice(0, i))
}

function groupStamp(
  meta: DocMeta,
  group: readonly string[],
): Hlc | undefined {
  let stamp: Hlc | undefined
  for (const f of group) {
    const s = meta.fields[f]
    if (s) stamp = stamp ? maxHlc(stamp, s) : s
  }
  return stamp
}

//a stable, total order over arbitrary JSON values — the last-resort
//tiebreak when two writes carry the EXACT same HLC (wall+counter+node) but
//differing values. a healthy clock never reuses a stamp, so this only
//fires under clock abuse/corruption; without it the merge could pick a
//different value per argument order and silently diverge replicas.
function stableKey(value: unknown): string {
  return JSON.stringify(value ?? null)
}

//true when side A should win for a single field; present beats absent, then
//compareHlc (a total order incl. node), then a stable value tiebreak.
function pickField(
  aHlc: Hlc | undefined,
  bHlc: Hlc | undefined,
  aVal: unknown,
  bVal: unknown,
): boolean {
  if (!bHlc) return true
  if (!aHlc) return false
  const c = compareHlc(aHlc, bHlc)
  if (c !== 0) return c > 0
  return stableKey(aVal) >= stableKey(bVal)
}

//same ordering for an atomic block, keyed on the group's stamp then its
//serialized values so a stamp tie can't split replicas
function pickGroup(
  aStamp: Hlc | undefined,
  bStamp: Hlc | undefined,
  aRow: PlainRow,
  bRow: PlainRow,
  group: readonly string[],
): boolean {
  if (!bStamp) return true
  if (!aStamp) return false
  const c = compareHlc(aStamp, bStamp)
  if (c !== 0) return c > 0
  const aKey = stableKey(group.map((f) => aRow[f]))
  const bKey = stableKey(group.map((f) => bRow[f]))
  return aKey >= bKey
}

function mergeScalarField(
  f: string,
  aRow: PlainRow,
  bRow: PlainRow,
  aMeta: DocMeta,
  bMeta: DocMeta,
  baseMeta: DocMeta | undefined,
  result: PlainRow,
  fields: Record<string, Hlc>,
  tombstones: Record<string, Hlc>,
  conflicts: Record<string, FieldConflict[]>,
): void {
  const aHlc = aMeta.fields[f]
  const bHlc = bMeta.fields[f]
  const wholeTomb = tombstones[f]

  if (!aHlc && !bHlc) {
    //no causal info (a never-mutated field) — keep the value, but a
    //whole-field tombstone still wins since any clear is "newer"
    if (wholeTomb) return
    if (Object.hasOwn(aRow, f)) result[f] = aRow[f]
    else if (Object.hasOwn(bRow, f)) result[f] = bRow[f]
    return
  }

  const winnerIsA = pickField(aHlc, bHlc, aRow[f], bRow[f])
  const winnerHlc = (winnerIsA ? aHlc : bHlc) as Hlc
  const winnerRow = winnerIsA ? aRow : bRow

  //a field clear newer than the latest write kills the field (LWW between
  //"latest write" and "latest clear" — both sides reduced to a max stamp)
  if (wholeTomb && compareHlc(wholeTomb, winnerHlc) > 0) return
  if (!Object.hasOwn(winnerRow, f)) return

  result[f] = winnerRow[f]
  fields[f] = winnerHlc

  captureScalarConflict(
    f,
    aRow,
    bRow,
    aHlc,
    bHlc,
    baseMeta,
    winnerIsA,
    winnerHlc,
    conflicts,
  )
}

//preserve the LWW loser when BOTH sides changed this field relative to the
//common base (a true concurrent edit) and the values differ. requires the base
//(only the client sync merge has it); a sequential edit — where only one side
//moved off the base — is no conflict and captures nothing.
function captureScalarConflict(
  f: string,
  aRow: PlainRow,
  bRow: PlainRow,
  aHlc: Hlc | undefined,
  bHlc: Hlc | undefined,
  baseMeta: DocMeta | undefined,
  winnerIsA: boolean,
  winnerHlc: Hlc,
  conflicts: Record<string, FieldConflict[]>,
): void {
  if (!baseMeta || !aHlc || !bHlc) return
  const baseHlc = baseMeta.fields[f]
  const aChanged = !baseHlc || compareHlc(aHlc, baseHlc) !== 0
  const bChanged = !baseHlc || compareHlc(bHlc, baseHlc) !== 0
  if (!aChanged || !bChanged) return
  if (stableKey(aRow[f]) === stableKey(bRow[f])) return

  const loserHlc = winnerIsA ? bHlc : aHlc
  const loserVal = winnerIsA ? bRow[f] : aRow[f]
  pushConflict(conflicts, f, {
    hlc: loserHlc,
    value: loserVal,
    against: winnerHlc,
  })
}

function conflictKey(c: FieldConflict): string {
  return `${c.hlc.wall}:${c.hlc.counter}:${c.hlc.node}`
}

//union a side's conflict map into the accumulator, deduped by stamp
function unionConflicts(
  into: Record<string, FieldConflict[]>,
  src: Readonly<Record<string, readonly FieldConflict[]>> | undefined,
): void {
  if (!src) return
  for (const [f, list] of Object.entries(src)) {
    const target = ensureList(into, f)
    const seen = new Set(target.map(conflictKey))
    for (const c of list) {
      const k = conflictKey(c)
      if (seen.has(k)) continue
      seen.add(k)
      target.push(c)
    }
  }
}

function ensureList(
  into: Record<string, FieldConflict[]>,
  f: string,
): FieldConflict[] {
  const existing = into[f]
  if (existing) return existing
  const created: FieldConflict[] = []
  into[f] = created
  return created
}

function pushConflict(
  into: Record<string, FieldConflict[]>,
  f: string,
  c: FieldConflict,
): void {
  const target = ensureList(into, f)
  const k = conflictKey(c)
  if (target.some((e) => conflictKey(e) === k)) return
  target.push(c)
}

//garbage-collect resolved/moot conflicts and order deterministically, so the
//map converges across merge orders: drop a field's entries once its live
//winner has moved PAST the stamp the conflict was decided against (a later
//write = the user resolved it), or when the field has no live value at all.
function finalizeConflicts(
  conflicts: Record<string, FieldConflict[]>,
  fields: Record<string, Hlc>,
): Record<string, FieldConflict[]> | undefined {
  const out: Record<string, FieldConflict[]> = {}
  for (const [f, list] of Object.entries(conflicts)) {
    const winner = fields[f]
    if (!winner) continue
    const kept = list
      .filter((c) => compareHlc(winner, c.against) <= 0)
      .sort((x, y) => (conflictKey(x) < conflictKey(y) ? -1 : 1))
    if (kept.length > 0) out[f] = kept
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function mergeSetField(
  f: string,
  aMeta: DocMeta,
  bMeta: DocMeta,
  result: PlainRow,
  fields: Record<string, Hlc>,
  tombstones: Record<string, Hlc>,
): void {
  const prefix = f + SEP
  const elements = new Set<string>()
  for (const meta of [aMeta, bMeta]) {
    for (const key of Object.keys(meta.fields)) {
      if (key.startsWith(prefix)) elements.add(key.slice(prefix.length))
    }
    for (const key of Object.keys(meta.tombstones)) {
      if (key.startsWith(prefix)) elements.add(key.slice(prefix.length))
    }
  }

  const present: string[] = []
  for (const element of elements) {
    const key = prefix + element
    const add = greater(aMeta.fields[key], bMeta.fields[key])
    const rem = greater(aMeta.tombstones[key], bMeta.tombstones[key])
    if (rem) tombstones[key] = rem
    //observed-remove: an element lives iff its add outlived its removal
    const alive = !!add && (!rem || compareHlc(add, rem) > 0)
    if (add && alive) {
      fields[key] = add
      present.push(element)
    }
  }

  //stable order so two devices materialize byte-identical arrays
  present.sort()
  result[f] = present
}

function greater(a: Hlc | undefined, b: Hlc | undefined): Hlc | undefined {
  if (!a) return b
  if (!b) return a
  return maxHlc(a, b)
}
