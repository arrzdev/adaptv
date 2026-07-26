import { desc, eq } from "drizzle-orm"
import type { Db } from "@/database/client"
import { todos } from "@/database/schema"
import { CustomError } from "@/http/errors"

export class TodosService {
  constructor(private db: Db) {}

  async list() {
    return this.db.select().from(todos).orderBy(desc(todos.createdAt))
  }

  async create(id: string, title: string) {
    //insert-or-return in one statement so a concurrent create with the same id
    //can't slip between a check and the insert (the old read-then-insert race,
    //which surfaced the PK collision as a 500 instead of the idempotent path).
    const now = new Date()
    const [inserted] = await this.db
      .insert(todos)
      .values({
        id,
        title,
        checked: false,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning()
    if (inserted) return inserted

    //id already existed — idempotent create returns the stored row
    const [existing] = await this.findById(id)
    if (!existing) throw new CustomError("internal_server_error")
    return existing
  }

  async update(id: string, patch: { title?: string; checked?: boolean }) {
    const [existing] = await this.findById(id)
    if (!existing) throw new CustomError("todo_not_found")

    const data = {
      updatedAt: new Date(),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.checked !== undefined ? { checked: patch.checked } : {}),
    }
    await this.db.update(todos).set(data).where(this.whereId(id))

    const [row] = await this.findById(id)
    if (!row) throw new CustomError("todo_not_found")
    return row
  }

  async delete(id: string): Promise<void> {
    const [existing] = await this.findById(id)
    if (!existing) throw new CustomError("todo_not_found")
    await this.db.delete(todos).where(this.whereId(id))
  }

  //---- queries ----------------

  private whereId(id: string) {
    return eq(todos.id, id)
  }

  private findById(id: string) {
    return this.db.select().from(todos).where(this.whereId(id))
  }
}
