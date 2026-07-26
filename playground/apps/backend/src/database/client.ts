import { drizzle } from "drizzle-orm/d1"
import * as authSchema from "@/database/auth.schema"
import * as appSchema from "@/database/schema"

//the drizzle client knows both the app tables and better-auth's own tables
//so the better-auth drizzleAdapter can query/write its schema through it
const schema = { ...appSchema, ...authSchema }

export type Db = ReturnType<typeof createDb>

const cache = new Map<D1Database, Db>()

//cache the drizzle client per binding: a D1 binding is stable within an isolate,
//so build the client once and reuse it across requests. multi-binding ready.
export function getDb(binding: D1Database): Db {
  const cached = cache.get(binding)
  if (cached) return cached
  const db = createDb(binding)
  cache.set(binding, db)
  return db
}

function createDb(binding: D1Database) {
  return drizzle(binding, { schema })
}
