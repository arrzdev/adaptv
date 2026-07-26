import { newEndpoint } from "@repo/shared/http"
import type { SyncPushItem } from "@repo/synq/protocol"
import type { JSONValue } from "hono/utils/types"
import { z } from "zod"
import { getDb } from "@/database/client"
import type { Env } from "@/env/registry"
import { ok } from "@/http/envelope"
import type { AuthedVariables } from "@/http/middlewares/auth"
import { requireAuth } from "@/http/middlewares/auth"
import { rateLimit } from "@/http/middlewares/rate-limit"
import { valid } from "@/http/middlewares/valid"
import { SyncService } from "@/services/sync.service"

const collectionParamSchema = z.object({
  collection: z.string().min(1).max(64),
})

const pullBodySchema = z.object({
  since: z.number().int().nonnegative().optional(),
})

//a pushed document is an opaque synq StoredDocument (developer fields +
//$id + $meta); zod only gates the envelope — the sync server structurally
//validates each doc (isStoredDocument) and answers "invalid" per item
const pushItemSchema = z.object({
  id: z.string().min(1),
  doc: z.record(z.string(), z.unknown()),
})

const pushBodySchema = z.object({
  items: z.array(pushItemSchema).max(500),
})

export const syncRoutes = newEndpoint<Env, AuthedVariables>()
  //rate-limit BEFORE auth so a flood is shed before paying a session lookup
  .use("*", rateLimit("sync"))
  .use("*", requireAuth())

  //---- pull ----------------
  .post(
    "/:collection/pull",
    valid("param", collectionParamSchema),
    valid("json", pullBodySchema),
    async (c) => {
      const { collection } = c.req.valid("param")
      const { since } = c.req.valid("json")
      const { id: userId } = c.get("user")
      const syncService = new SyncService(getDb(c.env.DB))
      const result = await syncService.pull(userId, collection, since ?? 0)
      //why: result carries synq StoredDocuments (interface-typed $meta), which
      //don't satisfy the JSONValue index-signature constraint though they
      //serialize fine; the client re-types them from the synq contract
      return ok(c, result as unknown as JSONValue)
    },
  )

  //---- push ----------------
  .post(
    "/:collection/push",
    valid("param", collectionParamSchema),
    valid("json", pushBodySchema),
    async (c) => {
      const { collection } = c.req.valid("param")
      const { items } = c.req.valid("json")
      const { id: userId } = c.get("user")
      const syncService = new SyncService(getDb(c.env.DB))
      //why: zod validates each doc only as an opaque object; the sync server
      //structurally validates every StoredDocument before merging
      const results = await syncService.push(
        userId,
        collection,
        items as SyncPushItem[],
      )
      return ok(c, { results })
    },
  )
