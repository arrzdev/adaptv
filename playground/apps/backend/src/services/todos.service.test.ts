import { env } from "cloudflare:workers"
import { beforeEach, describe, expect, it } from "vitest"
import { getDb } from "@/database/client"
import type { CustomError } from "@/http/errors"
import { TodosService } from "@/services/todos.service"
import { clearTodos } from "@/test-support/clear-todos"

const firstTodoId = "550e8400-e29b-41d4-a716-446655440000"
const secondTodoId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"

describe("TodosService", () => {
  beforeEach(async () => {
    await clearTodos()
  })

  it("lists todos newest first", async () => {
    const service = new TodosService(getDb(env.DB))

    const first = await service.create(firstTodoId, "First")
    const second = await service.create(secondTodoId, "Second")

    const items = await service.list()
    expect(items).toHaveLength(2)
    expect(items[0]?.id).toBe(second.id)
    expect(items[1]?.id).toBe(first.id)
  })

  it("creates a todo with the client id", async () => {
    const service = new TodosService(getDb(env.DB))

    const todo = await service.create(firstTodoId, "Buy milk")

    expect(todo.id).toBe(firstTodoId)
    expect(todo.title).toBe("Buy milk")
    expect(todo.checked).toBe(false)
  })

  it("returns the existing todo when the client id is reused", async () => {
    const service = new TodosService(getDb(env.DB))

    const created = await service.create(firstTodoId, "Buy milk")
    const replayed = await service.create(firstTodoId, "Buy milk")

    expect(replayed.id).toBe(created.id)
    expect(await service.list()).toHaveLength(1)
  })

  it("updates a todo title and checked state", async () => {
    const service = new TodosService(getDb(env.DB))
    const created = await service.create(firstTodoId, "Draft")

    const updated = await service.update(created.id, {
      title: "Published",
      checked: true,
    })

    expect(updated.title).toBe("Published")
    expect(updated.checked).toBe(true)
  })

  it("throws todo_not_found when updating a missing todo", async () => {
    const service = new TodosService(getDb(env.DB))

    await expect(
      service.update("missing-id", { title: "Nope" }),
    ).rejects.toMatchObject({
      errorCode: "todo_not_found",
    } satisfies Partial<CustomError>)
  })

  it("deletes an existing todo", async () => {
    const service = new TodosService(getDb(env.DB))
    const created = await service.create(firstTodoId, "Remove me")

    await service.delete(created.id)

    expect(await service.list()).toHaveLength(0)
  })

  it("throws todo_not_found when deleting a missing todo", async () => {
    const service = new TodosService(getDb(env.DB))

    await expect(service.delete("missing-id")).rejects.toMatchObject({
      errorCode: "todo_not_found",
    } satisfies Partial<CustomError>)
  })
})
