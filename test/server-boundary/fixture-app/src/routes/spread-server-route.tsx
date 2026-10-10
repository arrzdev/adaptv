//A server route whose options are a same-file `const` with another object literal
//ahead of it, so the first `{` after `createFileRoute` is not the options object.
import { createFileRoute } from "@tanstack/react-router"

const base = { ssr: false }

const options = {
  ...base,
  server: {
    handlers: {
      GET: () => new Response("from the server"),
    },
  },
}

export const Route = createFileRoute("/spread-server-route")(options)
