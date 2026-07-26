//@repo/synq/react — the React bindings: reactive collection/singleton
//hooks over the framework-agnostic live-query engine ("@repo/synq/live").
//the only entry that touches React (optional peer dependency).

export type { LiveState } from "../reactive/live-queries"
export {
  SynqProvider,
  useCollection,
  useSingleton,
} from "../reactive/use-collection"
