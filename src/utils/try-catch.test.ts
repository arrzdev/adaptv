// Every caller reads the error slot for truthiness (`if (error) return`), so the
// contract these tests pin is that the slot is truthy exactly when `fn` failed.
// A throw or a rejection is a failure whatever its reason: `throw undefined`,
// `Promise.reject()` and `reject(0)` all failed, and a caller that reads them
// as success goes on to use a `data` that is null.
import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"
import tryCatch from "#adaptv/utils/try-catch"

const NON_ERROR = "Non-Error value thrown or rejected"

const FALSY = [
  ["undefined", undefined],
  ["null", null],
  ["false", false],
  ["0", 0],
  ["NaN", Number.NaN],
  ['""', ""],
] as const

//a function that only throws is typed `() => never`, which the Promise overload
//would claim; a declared `unknown` return keeps the sync overload's tuple type
function throws(reason: unknown): () => unknown {
  return () => {
    throw reason
  }
}

//the same reason, thrown synchronously and rejected: both paths must agree
async function bothPaths(reason: unknown) {
  return [
    tryCatch(throws(reason)),
    await tryCatch(() => Promise.reject(reason)),
  ] as const
}

function expectFailure(
  outcome: readonly [unknown, Error | null],
  reason: unknown,
): Error {
  const [data, error] = outcome
  expect(data).toBeNull()
  expect(error).toBeInstanceOf(Error)
  expect(Boolean(error)).toBe(true)
  //the value that was thrown rides along, so nothing is lost by the wrap
  expect(error !== null && "cause" in error).toBe(true)
  expect(Object.is((error as Error).cause, reason)).toBe(true)
  return error as Error
}

describe("tryCatch — a falsy reason is still a failure", () => {
  it.each(FALSY)(
    "a sync throw of %s fills the error slot",
    (_, reason) => {
      expectFailure(tryCatch(throws(reason)), reason)
    },
  )

  it.each(FALSY)(
    "a Promise rejected with %s fills the error slot",
    async (_, reason) => {
      expectFailure(await tryCatch(() => Promise.reject(reason)), reason)
    },
  )

  it("a thenable that is not a Promise and rejects with no reason fails", async () => {
    const thenable: PromiseLike<string> = {
      // biome-ignore lint/suspicious/noThenProperty: the non-Promise thenable is the subject
      then(_onFulfilled, onRejected) {
        onRejected?.(undefined)
        return thenable as never
      },
    }
    const outcome = tryCatch(() => thenable)
    expect(outcome).toBeInstanceOf(Promise)
    expectFailure(await outcome, undefined)
  })

  it("the message says a non-Error failed, and names the value", () => {
    const [, error] = tryCatch(throws(undefined))
    expect(error?.message).toBe(`${NON_ERROR}: undefined`)
    const [, empty] = tryCatch(throws(""))
    expect(empty?.message).toBe(`${NON_ERROR}: ""`)
  })
})

describe("tryCatch — a non-Error reason is wrapped in a real Error", () => {
  it("a thrown string becomes the message", () => {
    const error = expectFailure(
      tryCatch(throws("network down")),
      "network down",
    )
    expect(error.message).toBe("network down")
  })

  it("a rejected Error-like object lends its message", async () => {
    const reason = { message: "quota exceeded", code: 22 }
    const error = expectFailure(
      await tryCatch(() => Promise.reject(reason)),
      reason,
    )
    expect(error.message).toBe("quota exceeded")
  })

  it("a message that is empty or not a string is not lent", async () => {
    const [, empty] = await tryCatch(() => Promise.reject({ message: "" }))
    expect(empty?.message).toBe(`${NON_ERROR}: [object Object]`)
    const [, numeric] = tryCatch(throws({ message: 42 }))
    expect(numeric?.message).toBe(`${NON_ERROR}: [object Object]`)
  })

  it("a truthy value with no message is named in the message", () => {
    const error = expectFailure(tryCatch(throws(42)), 42)
    expect(error.message).toBe(`${NON_ERROR}: 42`)
    //an array is described whole, not by its first element
    const [, list] = tryCatch(throws(["offline", "retry"]))
    expect(list?.message).toBe(`${NON_ERROR}: offline,retry`)
  })

  it("an Error from another realm is wrapped so `instanceof Error` holds", () => {
    const foreign = runInNewContext('new TypeError("from a frame")')
    expect(foreign instanceof Error).toBe(false)
    const error = expectFailure(tryCatch(throws(foreign)), foreign)
    expect(error.message).toBe("from a frame")
  })
})

describe("tryCatch — the described value is capped, the author's text is not", () => {
  it("a described value of 200 characters is kept whole", () => {
    const [, error] = tryCatch(throws(["a".repeat(200)]))
    expect(error?.message).toBe(`${NON_ERROR}: ${"a".repeat(200)}`)
  })

  it("a longer described value is cut at 200 characters and marked", async () => {
    const rows = Array.from({ length: 100_000 }, (_, i) => `row${i}`)
    const described = rows.join(",")
    const expected = `${NON_ERROR}: ${described.slice(0, 200)}… (truncated)`
    for (const [, error] of await bothPaths(rows)) {
      expect(error?.message).toBe(expected)
    }
  })

  it("the cut never splits a surrogate pair", () => {
    const split = [`${"a".repeat(199)}😀`]
    const [, error] = tryCatch(throws(split))
    const message = error?.message ?? ""
    expect(message).toBe(`${NON_ERROR}: ${"a".repeat(199)}… (truncated)`)
    expect(() => encodeURIComponent(message)).not.toThrow()
    //a pair that ends exactly at the cut is whole, so it stays
    const [, whole] = tryCatch(throws([`${"a".repeat(198)}😀b`]))
    expect(whole?.message).toBe(
      `${NON_ERROR}: ${"a".repeat(198)}😀… (truncated)`,
    )
  })

  it("a long string reason or lent message is the author's and kept whole", async () => {
    const text = "m".repeat(1000)
    const [, thrown] = tryCatch(throws(text))
    expect(thrown?.message).toBe(text)
    const [, lent] = await tryCatch(() =>
      Promise.reject({ message: text }),
    )
    expect(lent?.message).toBe(text)
  })
})

describe("tryCatch — a reason that cannot be inspected never escapes", () => {
  const revocable = Proxy.revocable({}, {})
  revocable.revoke()
  const hostile: Array<[string, () => unknown]> = [
    ["a value whose toString throws", () => Object.create(null)],
    [
      "an object whose message getter throws",
      () => ({
        get message(): string {
          throw new Error("getter")
        },
      }),
    ],
    [
      "a Proxy whose has trap throws",
      () =>
        new Proxy(
          {},
          {
            has() {
              throw new Error("has trap")
            },
          },
        ),
    ],
    ["a revoked Proxy", () => revocable.proxy],
  ]

  it.each(hostile)(
    "%s fails with a fixed message, sync and async",
    async (_, make) => {
      const reason = make()
      for (const outcome of await bothPaths(reason)) {
        const error = expectFailure(outcome, reason)
        expect(error.message).toBe(NON_ERROR)
      }
    },
  )
})

describe("tryCatch — an Error passes through untouched", () => {
  it("a sync throw keeps the Error's identity", () => {
    const thrown = new TypeError("bad")
    const [data, error] = tryCatch(throws(thrown))
    expect(data).toBeNull()
    expect(error).toBe(thrown)
  })

  it("a rejection keeps the Error's identity", async () => {
    const rejected = new RangeError("out")
    const [data, error] = await tryCatch(() => Promise.reject(rejected))
    expect(data).toBeNull()
    expect(error).toBe(rejected)
  })

  it("a DOMException is an Error and keeps its identity", async () => {
    const quota = new DOMException("full", "QuotaExceededError")
    const [, error] = await tryCatch(() => Promise.reject(quota))
    expect(error).toBe(quota)
  })
})

describe("tryCatch — success, including a falsy result", () => {
  it.each(FALSY)("a sync %s is data, not an error", (_, value) => {
    const [data, error] = tryCatch((): unknown => value)
    expect(Object.is(data, value)).toBe(true)
    expect(error).toBeNull()
  })

  it.each(FALSY)(
    "a resolved %s is data, not an error",
    async (_, value) => {
      const [data, error] = await tryCatch(() => Promise.resolve(value))
      expect(Object.is(data, value)).toBe(true)
      expect(error).toBeNull()
    },
  )

  it("a thenable that is not a Promise resolves to data", async () => {
    const thenable: PromiseLike<number> = {
      // biome-ignore lint/suspicious/noThenProperty: the non-Promise thenable is the subject
      then(onFulfilled) {
        onFulfilled?.(7)
        return thenable as never
      },
    }
    expect(await tryCatch(() => thenable)).toEqual([7, null])
  })
})
