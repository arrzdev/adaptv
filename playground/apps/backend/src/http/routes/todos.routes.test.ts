import { beforeEach, describe, expect, it } from "vitest"
import { resetRateLimitBuckets } from "@/http/middlewares/rate-limit"
import { clearTodos } from "@/test-support/clear-todos"
import { readJson } from "@/test-support/read-json"
import { workerRequest } from "@/test-support/worker-request"

const clientTodoId = "550e8400-e29b-41d4-a716-446655440000"

type TodoPayload = {
  id: string
  title: string
  checked: boolean
}

type SuccessBody<T> = {
  status: "success"
  data: T
}

type ErrorBody = {
  status: "error"
  error_code: string
}

//the demo todos routes require a signed-in user: sign up once through the real
//better-auth handler to get a bearer token (cached across tests in the run).
let authToken: string | null = null

async function authHeaders(): Promise<Record<string, string>> {
  if (!authToken) {
    const res = await workerRequest("/api/v1/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "todos-test@example.com",
        password: "password1234",
        name: "Todos Test",
      }),
    })
    authToken = res.headers.get("set-auth-token")
    if (!authToken) {
      throw new Error(
        `auth sign-up failed (${res.status}): ${await res.text()}`,
      )
    }
  }
  return { Authorization: `Bearer ${authToken}` }
}

async function authedRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return workerRequest(path, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(await authHeaders()) },
  })
}

describe("todos routes", () => {
  beforeEach(async () => {
    resetRateLimitBuckets()
    await clearTodos()
  })

  it("rejects an unauthenticated request", async () => {
    const response = await workerRequest("/api/v1/todos")
    const body = await readJson<ErrorBody>(response)

    expect(response.status).toBe(401)
    expect(body).toEqual({
      status: "error",
      error_code: "unauthorized",
    })
  })

  it("GET /api/v1/todos returns an empty list", async () => {
    const response = await authedRequest("/api/v1/todos")
    const body =
      await readJson<SuccessBody<{ todos: TodoPayload[] }>>(response)

    expect(response.status).toBe(200)
    expect(body).toEqual({
      status: "success",
      data: { todos: [] },
    })
  })

  it("POST /api/v1/todos creates a todo with the client id", async () => {
    const response = await authedRequest("/api/v1/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: clientTodoId, title: "Write tests" }),
    })
    const body =
      await readJson<SuccessBody<{ todo: TodoPayload }>>(response)

    expect(response.status).toBe(201)
    expect(body.status).toBe("success")
    expect(body.data.todo).toMatchObject({
      id: clientTodoId,
      title: "Write tests",
      checked: false,
    })
  })

  it("POST /api/v1/todos is idempotent for the same client id", async () => {
    const first = await authedRequest("/api/v1/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: clientTodoId, title: "Write tests" }),
    })
    const second = await authedRequest("/api/v1/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: clientTodoId, title: "Write tests" }),
    })
    const firstBody =
      await readJson<SuccessBody<{ todo: TodoPayload }>>(first)
    const secondBody =
      await readJson<SuccessBody<{ todo: TodoPayload }>>(second)

    expect(firstBody.data.todo.id).toBe(clientTodoId)
    expect(secondBody.data.todo.id).toBe(clientTodoId)

    const listResponse = await authedRequest("/api/v1/todos")
    const listBody =
      await readJson<SuccessBody<{ todos: TodoPayload[] }>>(listResponse)
    expect(listBody.data.todos).toHaveLength(1)
  })

  it("POST /api/v1/todos rejects invalid input", async () => {
    const response = await authedRequest("/api/v1/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: clientTodoId, title: "" }),
    })
    const body = await readJson<ErrorBody>(response)

    expect(response.status).toBe(400)
    expect(body).toEqual({
      status: "error",
      error_code: "invalid_input",
    })
  })

  it("PATCH /api/v1/todos/:id updates a todo", async () => {
    const createResponse = await authedRequest("/api/v1/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
        title: "Draft",
      }),
    })
    const created =
      await readJson<SuccessBody<{ todo: TodoPayload }>>(createResponse)

    const response = await authedRequest(
      `/api/v1/todos/${created.data.todo.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checked: true }),
      },
    )
    const body =
      await readJson<SuccessBody<{ todo: TodoPayload }>>(response)

    expect(response.status).toBe(200)
    expect(body.data.todo).toMatchObject({
      title: "Draft",
      checked: true,
    })
  })

  it("PATCH /api/v1/todos/:id returns todo_not_found for missing todos", async () => {
    const response = await authedRequest("/api/v1/todos/missing-id", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Nope" }),
    })
    const body = await readJson<ErrorBody>(response)

    expect(response.status).toBe(404)
    expect(body).toEqual({
      status: "error",
      error_code: "todo_not_found",
    })
  })

  it("DELETE /api/v1/todos/:id removes a todo", async () => {
    const createResponse = await authedRequest("/api/v1/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
        title: "Delete me",
      }),
    })
    const created =
      await readJson<SuccessBody<{ todo: TodoPayload }>>(createResponse)

    const deleteResponse = await authedRequest(
      `/api/v1/todos/${created.data.todo.id}`,
      { method: "DELETE" },
    )
    const listResponse = await authedRequest("/api/v1/todos")
    const listBody =
      await readJson<SuccessBody<{ todos: TodoPayload[] }>>(listResponse)

    expect(deleteResponse.status).toBe(200)
    expect(listBody.data.todos).toEqual([])
  })

  it("DELETE /api/v1/todos/:id returns todo_not_found for missing todos", async () => {
    const response = await authedRequest("/api/v1/todos/missing-id", {
      method: "DELETE",
    })
    const body = await readJson<ErrorBody>(response)

    expect(response.status).toBe(404)
    expect(body).toEqual({
      status: "error",
      error_code: "todo_not_found",
    })
  })
})
