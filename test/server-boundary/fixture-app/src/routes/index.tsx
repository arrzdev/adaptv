//The control: a loader is isomorphic and allowed, so no candidate may report it.
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
  loader: () => ({ server: "a field named server, in loader data" }),
})
