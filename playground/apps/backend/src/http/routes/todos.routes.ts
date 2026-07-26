import { newEndpoint } from "@repo/shared/http"
import { z } from "zod"
import { getDb } from "@/database/client"
import type { Env } from "@/env/registry"
import { ok } from "@/http/envelope"
import type { AuthedVariables } from "@/http/middlewares/auth"
import { requireAuth } from "@/http/middlewares/auth"
import { rateLimit } from "@/http/middlewares/rate-limit"
import { valid } from "@/http/middlewares/valid"
import { TodosService } from "@/services/todos.service"

const MAX_TITLE_LENGTH = 2000

export const todoIdParamSchema = z.object({
  id: z.string().min(1).max(256),
})

export const createTodoBodySchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
})

export const updateTodoBodySchema = z
  .object({
    title: z.string().min(1).max(MAX_TITLE_LENGTH).optional(),
    checked: z.boolean().optional(),
  })
  .refine(
    (body) => body.title !== undefined || body.checked !== undefined,
    { message: "at least one field required" },
  )

//---- Legacy demo todos --------------------------------------------
//a reference CRUD endpoint (service + validation + auth wiring) kept as a
//template example; the live app syncs its real, user-scoped todos through
///sync and the `documents` store. gated behind requireAuth so it isn't an open
//public write endpoint — but note the `todos` table has no user column, so
//authed users still share one global list. scoping it per-user needs a schema
//migration (add a userId column) before this is treated as real user data.
export const todosRoutes = newEndpoint<Env, AuthedVariables>()
  //rate-limit BEFORE auth so a flood is shed before paying a session lookup
  .use("*", rateLimit("todos"))
  .use("*", requireAuth())

  //---- list ----------------
  .get("/", async (c) => {
    const todosService = new TodosService(getDb(c.env.DB))
    const todos = await todosService.list()
    return ok(c, { todos })
  })

  //---- create ----------------
  .post("/", valid("json", createTodoBodySchema), async (c) => {
    const body = c.req.valid("json")
    const todosService = new TodosService(getDb(c.env.DB))
    const todo = await todosService.create(body.id, body.title)
    return ok(c, { todo }, 201)
  })

  //---- update ----------------
  .patch(
    "/:id",
    valid("param", todoIdParamSchema),
    valid("json", updateTodoBodySchema),
    async (c) => {
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")
      const todosService = new TodosService(getDb(c.env.DB))
      const todo = await todosService.update(id, body)
      return ok(c, { todo })
    },
  )

  //---- delete ----------------
  .delete("/:id", valid("param", todoIdParamSchema), async (c) => {
    const { id } = c.req.valid("param")
    const todosService = new TodosService(getDb(c.env.DB))
    await todosService.delete(id)
    return ok(c)
  })
