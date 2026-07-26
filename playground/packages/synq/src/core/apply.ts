import type {
  DocMeta,
  Hlc,
  OutboxEntry,
  StoredDocument,
} from "#synq/types/synq.types"
import { CAUSAL_FIELD, ID_FIELD } from "#synq/types/synq.types"

//---- Apply outbox ops to canonical --------------------------------
//projects a row's chronological outbox ops onto its last-synced canonical
//state, producing the "local current" stored document the sync engine
//merges against the server. each op stamps the fields it touched with its
//hlc; a cleared field (value undefined) becomes a field tombstone; a
//DELETE records a row-level deletedAt. arrays are treated as scalar
//whole-values here — element-set semantics come from explicit op
//tombstones. ops MUST be in causal order.

type PlainRow = Record<string, unknown>

export function applyOps<T>(
  canonical: StoredDocument<T> | undefined,
  ops: OutboxEntry[],
): StoredDocument<T> {
  let data: PlainRow = canonical ? stripFramework(canonical) : {}
  let fields: Record<string, Hlc> = canonical
    ? { ...canonical[CAUSAL_FIELD].fields }
    : {}
  let tombstones: Record<string, Hlc> = canonical
    ? { ...canonical[CAUSAL_FIELD].tombstones }
    : {}
  let deletedAt = canonical?.[CAUSAL_FIELD].deletedAt
  let id = canonical?.[ID_FIELD] ?? ""

  for (const op of ops) {
    id = op.rowId

    if (op.type === "INSERT") {
      const nextData: PlainRow = {}
      const nextFields: Record<string, Hlc> = {}
      for (const [key, value] of Object.entries(op.payload as PlainRow)) {
        if (key === ID_FIELD || key === CAUSAL_FIELD) continue
        nextData[key] = value
        nextFields[key] = op.hlc
      }
      data = nextData
      fields = nextFields
      deletedAt = undefined
    } else if (op.type === "UPDATE") {
      for (const [key, value] of Object.entries(op.payload as PlainRow)) {
        if (key === ID_FIELD || key === CAUSAL_FIELD) continue
        if (value === undefined) {
          //cleared field — record a tombstone so it can't resurrect
          data = omit(data, key)
          fields = omit(fields, key)
          tombstones = { ...tombstones, [key]: op.hlc }
        } else {
          data = { ...data, [key]: value }
          fields = { ...fields, [key]: op.hlc }
          tombstones = omit(tombstones, key)
        }
      }
    } else {
      //DELETE — drop the data and field stamps, mark the row deleted
      data = {}
      fields = {}
      deletedAt = op.hlc
    }

    if (op.tombstones) {
      tombstones = { ...tombstones, ...op.tombstones }
    }
  }

  const meta: DocMeta = deletedAt
    ? { fields, tombstones, deletedAt }
    : { fields, tombstones }
  return {
    ...(data as T),
    [ID_FIELD]: id,
    [CAUSAL_FIELD]: meta,
  } as StoredDocument<T>
}

function stripFramework<T>(doc: StoredDocument<T>): PlainRow {
  const out: PlainRow = {}
  for (const key of Object.keys(doc as PlainRow)) {
    if (key === ID_FIELD || key === CAUSAL_FIELD) continue
    out[key] = (doc as PlainRow)[key]
  }
  return out
}

function omit<T extends Record<string, unknown>>(obj: T, key: string): T {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj)) {
    if (k !== key) out[k] = obj[k]
  }
  return out as T
}
