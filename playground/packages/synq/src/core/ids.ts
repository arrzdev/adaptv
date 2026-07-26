//framework-generated absolute identity for documents and operations: a
//uuid v4, never an auto-increment integer, so two devices that both create
//offline can't collide.
//
//crypto.randomUUID() is the fast path but exists ONLY in secure contexts —
//a phone hitting a LAN dev server over http (not https/localhost) doesn't
//have it. so we fall back to getRandomValues (available in insecure
//contexts) and finally to Math.random, always producing a valid v4.

const HEX: string[] = []
for (let i = 0; i < 256; i++) HEX.push((i + 0x100).toString(16).slice(1))

export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID()
  }

  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  //rfc 4122 §4.4: version 4, variant 10xx
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const h = HEX
  return (
    `${h[bytes[0]]}${h[bytes[1]]}${h[bytes[2]]}${h[bytes[3]]}-` +
    `${h[bytes[4]]}${h[bytes[5]]}-` +
    `${h[bytes[6]]}${h[bytes[7]]}-` +
    `${h[bytes[8]]}${h[bytes[9]]}-` +
    `${h[bytes[10]]}${h[bytes[11]]}${h[bytes[12]]}${h[bytes[13]]}${h[bytes[14]]}${h[bytes[15]]}`
  )
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isId(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value)
}
