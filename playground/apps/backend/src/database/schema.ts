import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core"
import { user } from "@/database/auth.schema"

//legacy demo table (kept for the existing todos.routes/service; the live app
//syncs todos through the `documents` store below)
export const todos = sqliteTable("todos", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  checked: integer("checked", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})

//---- App user profile ---------------------------------------------
//OUR user-editable data, deliberately separate from better-auth's `user`
//table (which we never extend). one row per better-auth user, keyed by its
//id; add app-facing user fields here (username, …) not in auth.schema.ts.

export const profiles = sqliteTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  username: text("username").unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})

//---- Synq sync store ----------------------------------------------
//a collection-agnostic document store for the offline-first sync layer.
//data = the developer fields, meta = the synq $meta (per-field HLCs +
//tombstones + deletedAt). seq is a per-(user, collection) monotonic cursor
//so a client pulls "everything changed since X". every row is owned by one
//user (`user_id`) — sync is user-scoped; guests never reach this store.

export const documents = sqliteTable(
  "documents",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    collection: text("collection").notNull(),
    id: text("id").notNull(),
    data: text("data", { mode: "json" }).notNull(),
    meta: text("meta", { mode: "json" }).notNull(),
    deleted: integer("deleted", { mode: "boolean" })
      .notNull()
      .default(false),
    seq: integer("seq").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.collection, table.id] }),
    index("documents_user_collection_seq_idx").on(
      table.userId,
      table.collection,
      table.seq,
    ),
  ],
)

//per-(user, collection) monotonic counter handing out the seq values above
export const syncCounters = sqliteTable(
  "sync_counters",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    collection: text("collection").notNull(),
    value: integer("value").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.collection] })],
)
