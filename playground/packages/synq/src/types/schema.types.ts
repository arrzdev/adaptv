//---- Collection schema --------------------------------------------
//the schema is optional metadata that tunes storage and merging. it is
//deliberately thin: the developer's row TYPE is the source of truth for
//shape, the schema only declares the few things the engine can't infer.

//a set of field names that must merge as one indivisible unit. without
//this, field-level LWW can interleave semantically-coupled fields (the
//classic "luxury room number kept, standard room price kept" bug). an
//atomic group resolves the whole block to a single side per conflict.
export interface AtomicGroup {
  readonly kind: "atomic"
  readonly fields: readonly string[]
}

export interface CollectionSchema {
  //fields to index in the storage layer for fast where() lookups
  readonly indexes?: readonly string[]
  //groups of fields that move together under one causal stamp
  readonly atomic?: readonly AtomicGroup[]
}

//normalized form the merge engine consumes: a list of field-name groups
export type AtomicGroups = readonly (readonly string[])[]
