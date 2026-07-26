import type { DocMeta, Hlc, StoredDocument } from "#synq/types/synq.types"
import { CAUSAL_FIELD, ID_FIELD } from "#synq/types/synq.types"

//---- Wire validation ----------------------------------------------
//structural guards for documents arriving over the network. the merge
//engine trusts $meta blindly (it reads meta.fields/tombstones/deletedAt
//without checks), so a server MUST validate every pushed document before
//merging — one malformed payload would otherwise persist and then crash
//every device that pulls it. dependency-free on purpose: the validators
//run on any runtime the core runs on.

type PlainRow = Record<string, unknown>

function isRecord(value: unknown): value is PlainRow {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  )
}

export function isHlc(value: unknown): value is Hlc {
  if (!isRecord(value)) return false
  return (
    typeof value.wall === "number" &&
    Number.isFinite(value.wall) &&
    typeof value.counter === "number" &&
    Number.isFinite(value.counter) &&
    typeof value.node === "string" &&
    value.node.length > 0
  )
}

function isHlcRecord(value: unknown): value is Record<string, Hlc> {
  if (!isRecord(value)) return false
  for (const stamp of Object.values(value)) {
    if (!isHlc(stamp)) return false
  }
  return true
}

function isConflictList(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  for (const entry of value) {
    if (!isRecord(entry)) return false
    if (!isHlc(entry.hlc) || !isHlc(entry.against)) return false
  }
  return true
}

export function isDocMeta(value: unknown): value is DocMeta {
  if (!isRecord(value)) return false
  if (!isHlcRecord(value.fields)) return false
  if (!isHlcRecord(value.tombstones)) return false
  if (value.deletedAt !== undefined && !isHlc(value.deletedAt))
    return false
  if (value.conflicts !== undefined) {
    if (!isRecord(value.conflicts)) return false
    for (const list of Object.values(value.conflicts)) {
      if (!isConflictList(list)) return false
    }
  }
  return true
}

//true when the value is a structurally sound StoredDocument: a non-null
//object with a non-empty string $id and a well-formed causal $meta. the
//developer fields stay unchecked — their shape is the app's contract.
export function isStoredDocument(
  value: unknown,
): value is StoredDocument<PlainRow> {
  if (!isRecord(value)) return false
  const id = value[ID_FIELD]
  if (typeof id !== "string" || id.length === 0) return false
  return isDocMeta(value[CAUSAL_FIELD])
}
