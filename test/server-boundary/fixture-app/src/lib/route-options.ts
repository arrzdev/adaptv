export const serverOptions = {
  server: {
    handlers: {
      GET: () => new Response("from the server, imported"),
    },
  },
}
