//treat any thenable like a Promise (Drizzle builders, Bun fs, etc. may not be `instanceof Promise`).
function isThenable(x: unknown): x is PromiseLike<unknown> {
  return (
    x != null &&
    typeof x === "object" &&
    "then" in x &&
    typeof (x as PromiseLike<unknown>).then === "function"
  )
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
        (error) => [null, error as Error] as const,
      )
    }
    return [result, null] as const
  } catch (error) {
    return [null, error as Error] as const
  }
}

export default tryCatch
