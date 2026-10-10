import { createMiddleware } from "@tanstack/react-start"

export const viaMiddleware = createMiddleware().server(async ({ next }) =>
  next(),
)
