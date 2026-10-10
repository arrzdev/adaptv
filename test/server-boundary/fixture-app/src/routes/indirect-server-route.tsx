//A server route whose options are a same-file `const`, assembled before the call.
import { createFileRoute } from "@tanstack/react-router"

const options = {
  server: {
    handlers: {
      GET: () => new Response("from the server"),
    },
  },
}

export const Route = createFileRoute("/indirect-server-route")(options)
