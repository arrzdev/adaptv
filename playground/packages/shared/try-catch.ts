//treat any thenable like a Promise (Drizzle builders, Bun fs, etc. may not be `instanceof Promise`).
function isThenable(x: unknown): x is PromiseLike<unknown> {
  return (
    x != null &&
    typeof x === "object" &&
    "then" in x &&
    typeof (x as PromiseLike<unknown>).then === "function"
  )
}

const NON_ERROR = "Non-Error value thrown or rejected"
const DESCRIBED_MAX = 200

//a string reason, or an Error-like object's message (an Error from another
//realm, which `instanceof Error` does not see, or a `{ message }` rejection), is
//the author's own text and is kept whole, as an Error's message would be. Any
//other value is described, and capped: an array joins every element and a
//function prints its source, and the message may reach the UI.
function messageOf(reason: unknown): string {
  if (typeof reason === "string" && reason !== "") return reason
  if (
    typeof reason === "object" &&
    reason !== null &&
    "message" in reason &&
    typeof reason.message === "string" &&
    reason.message !== ""
  ) {
    return reason.message
  }
  const described = reason === "" ? '""' : String(reason)
  if (described.length <= DESCRIBED_MAX) {
    return `${NON_ERROR}: ${described}`
  }
  //never cut between a surrogate pair: a lone high surrogate is not
  //well-formed text, and encodeURIComponent throws on it
  const last = described.charCodeAt(DESCRIBED_MAX - 1)
  const end =
    last >= 0xd800 && last <= 0xdbff ? DESCRIBED_MAX - 1 : DESCRIBED_MAX
  return `${NON_ERROR}: ${described.slice(0, end)}… (truncated)`
}

//callers read the error slot for truthiness, so ANY throw or rejection must fill
//it with a real Error: `throw undefined` and a bare `reject()` failed too. An
//Error passes through by identity; anything else is wrapped, the original kept
//as `cause`. tryCatch itself must never throw, so a reason that cannot even be
//inspected (a throwing getter or trap, a revoked Proxy) gets a fixed message.
function toError(reason: unknown): Error {
  try {
    if (reason instanceof Error) return reason
    return new Error(messageOf(reason), { cause: reason })
  } catch {
    return new Error(NON_ERROR, { cause: reason })
  }
}

//promise/thenable overload first so `() => Promise<...>` is not inferred as sync `T = Promise<...>`.
export function tryCatch<T>(
  fn: () => Promise<T>,
): Promise<[T, null] | [null, Error]>
export function tryCatch<T>(fn: () => T): [T, null] | [null, Error]

export function tryCatch<T>(fn: () => T | Promise<T>) {
  try {
    const result = fn()
    if (isThenable(result)) {
      return Promise.resolve(result).then(
        (data) => [data, null] as const,
        (error) => [null, toError(error)] as const,
      )
    }
    return [result, null] as const
  } catch (error) {
    return [null, toError(error)] as const
  }
}

export default tryCatch
