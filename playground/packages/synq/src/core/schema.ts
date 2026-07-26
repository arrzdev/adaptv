import type {
  AtomicGroup,
  AtomicGroups,
  CollectionSchema,
} from "#synq/types/schema.types"

//declare a group of fields that must merge as one unit. pass it to a
//collection's schema.atomic so the engine resolves the whole block to a
//single side per conflict (see the merge engine's atomic handling).
export function atomic(...fields: string[]): AtomicGroup {
  return { kind: "atomic", fields }
}

//flatten a schema's atomic groups into the plain string[][] the merge
//engine consumes; undefined when the collection declares none.
export function atomicGroupsOf(
  schema: CollectionSchema | undefined,
): AtomicGroups | undefined {
  if (!schema?.atomic || schema.atomic.length === 0) return undefined
  return schema.atomic.map((group) => group.fields)
}
