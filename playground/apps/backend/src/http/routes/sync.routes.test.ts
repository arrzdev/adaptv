import { beforeEach, describe, expect, it } from "vitest"
import { resetRateLimitBuckets } from "@/http/middlewares/rate-limit"
import { clearSync } from "@/test-support/clear-sync"
import { readJson } from "@/test-support/read-json"
import { workerRequest } from "@/test-support/worker-request"

type Hlc = { wall: number; counter: number; node: string }
const H = (wall: number, node: string): Hlc => ({ wall, counter: 0, node })

type StoredDoc = Record<string, unknown> & {
  $id: string
  $meta: {
    fields: Record<string, Hlc>
    tombstones: Record<string, Hlc>
    deletedAt?: Hlc
  }
}

type SuccessBody<T> = { status: "success"; data: T }
type PullData = { changes: StoredDoc[]; nextCursor: number }

function doc(
  id: string,
  fields: Record<string, unknown>,
  stamps: Record<string, Hlc>,
  extra: Partial<StoredDoc["$meta"]> = {},
): StoredDoc {
  return {
    ...fields,
    $id: id,
    $meta: { fields: stamps, tombstones: {}, ...extra },
  }
}

//sync is user-scoped: sign up once through the real better-auth handler to get
//a bearer token (this also creates the user row the documents FK needs). cached
//across tests in the run; clearSync only wipes documents, not the user/session.
let authToken: string | null = null

async function authHeaders(): Promise<Record<string, string>> {
  if (!authToken) {
    const res = await workerRequest("/api/v1/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "sync-test@example.com",
        password: "password1234",
        name: "Sync Test",
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

async function push(
  collection: string,
  items: { id: string; doc: StoredDoc }[],
) {
  return workerRequest(`/api/v1/sync/${collection}/push`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ items }),
  })
}

async function pull(collection: string, since = 0) {
  const res = await workerRequest(`/api/v1/sync/${collection}/pull`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ since }),
  })
  return readJson<SuccessBody<PullData>>(res)
}

describe("sync routes", () => {
  beforeEach(async () => {
    resetRateLimitBuckets()
    await clearSync()
  })

  it("pull is empty before anything is pushed", async () => {
    const body = await pull("todos")
    expect(body.data.changes).toEqual([])
  })

  it("pushes a document and pulls it back", async () => {
    const res = await push("todos", [
      {
        id: "t1",
        doc: doc(
          "t1",
          { title: "shared", checked: false },
          { title: H(1, "a"), checked: H(1, "a") },
        ),
      },
    ])
    expect(res.status).toBe(200)

    const body = await pull("todos")
    expect(body.data.changes).toHaveLength(1)
    expect(body.data.changes[0]).toMatchObject({
      $id: "t1",
      title: "shared",
    })
    expect(body.data.nextCursor).toBeGreaterThan(0)
  })

  it("only returns rows changed after the cursor", async () => {
    await push("todos", [
      { id: "t1", doc: doc("t1", { title: "one" }, { title: H(1, "a") }) },
    ])
    const first = await pull("todos", 0)
    await push("todos", [
      { id: "t2", doc: doc("t2", { title: "two" }, { title: H(2, "a") }) },
    ])
    const second = await pull("todos", first.data.nextCursor)
    expect(second.data.changes).toHaveLength(1)
    expect(second.data.changes[0].$id).toBe("t2")
  })

  it("merges concurrent device pushes field-by-field (server-side LWW)", async () => {
    //device A: title "Apple" newer, checked older
    await push("todos", [
      {
        id: "x",
        doc: doc(
          "x",
          { title: "Apple", checked: false },
          { title: H(5, "a"), checked: H(1, "base") },
        ),
      },
    ])
    //device B: title "Banana" older, checked true newer
    await push("todos", [
      {
        id: "x",
        doc: doc(
          "x",
          { title: "Banana", checked: true },
          { title: H(3, "b"), checked: H(9, "b") },
        ),
      },
    ])

    const body = await pull("todos")
    expect(body.data.changes).toHaveLength(1)
    //both winning fields survive the merge
    expect(body.data.changes[0]).toMatchObject({
      $id: "x",
      title: "Apple",
      checked: true,
    })
  })

  it("answers 'invalid' for a malformed document without persisting it", async () => {
    //a doc with no $meta used to be stored as-is and then crash every
    //client that pulled it — the sync server must reject it per item
    const broken = { $id: "bad", title: "no meta" } as unknown as StoredDoc
    const res = await push("todos", [{ id: "bad", doc: broken }])
    expect(res.status).toBe(200)
    const body =
      await readJson<SuccessBody<{ results: Record<string, string> }>>(res)
    expect(body.data.results).toEqual({ bad: "invalid" })

    const pulled = await pull("todos")
    expect(pulled.data.changes).toEqual([])
  })

  it("propagates a deletion as a tombstone", async () => {
    await push("todos", [
      {
        id: "d1",
        doc: doc("d1", { title: "doomed" }, { title: H(1, "a") }),
      },
    ])
    //a delete push: empty fields + deletedAt stamp
    await push("todos", [
      { id: "d1", doc: doc("d1", {}, {}, { deletedAt: H(5, "a") }) },
    ])

    const body = await pull("todos")
    const row = body.data.changes.find((c) => c.$id === "d1")
    expect(row?.$meta.deletedAt).toBeTruthy()
  })

  it("rejects sync without a bearer token", async () => {
    const res = await workerRequest("/api/v1/sync/todos/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ since: 0 }),
    })
    const body = await readJson<{ status: string; error_code: string }>(
      res,
    )
    expect(res.status).toBe(401)
    expect(body.error_code).toBe("unauthorized")
  })
})
