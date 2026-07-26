//public surface of @repo/synq: the headless client core (merge engine +
//sync + createSynqStorage + leader + types). storage adapters are separate
//entries ("@repo/synq/adapters/indexeddb", "…/memory") so an unused one
//never enters a bundle; react bindings live behind "@repo/synq/react";
//the backend half behind "@repo/synq/server" + "@repo/synq/protocol".

export * from "./core.index"
