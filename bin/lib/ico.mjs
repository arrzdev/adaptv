// `favicon.ico`, hand-encoded.
//
// sharp writes every format adaptv's icon set needs except this one, and `.ico` is the one file
// a browser asks for WITHOUT being told to: a bare `GET /favicon.ico` is still made by crawlers,
// feed readers, and any browser rendering a page whose head it hasn't parsed yet. Dropping it
// would mean adaptv's own generator produced a set with a hole in it that every favicon
// generator on the web fills.
//
// The format is small enough to own outright. An ICO is a 6-byte directory header, one 16-byte
// entry per image, then the image payloads. Those payloads are classically BMP with an inverted
// mask, but the spec has allowed a raw PNG since Vista and every browser in use accepts it —
// so each entry is just a PNG that sharp already produced, copied in with an offset.

const HEADER_BYTES = 6
const ENTRY_BYTES = 16

/**
 * Pack `images` — `[{ size, png }]`, each a square PNG buffer — into one `.ico` buffer.
 *
 * Sizes are written smallest-first, which is the order every encoder emits and the order a
 * consumer scanning for "the 16px one" expects to find it in.
 */
export function encodeIco(images) {
  if (images.length === 0)
    throw new Error("an .ico needs at least one image")
  const entries = [...images].sort((a, b) => a.size - b.size)

  const header = Buffer.alloc(HEADER_BYTES)
  header.writeUInt16LE(0, 0) //reserved
  header.writeUInt16LE(1, 2) //1 = icon (2 would be a cursor)
  header.writeUInt16LE(entries.length, 4)

  const directory = Buffer.alloc(ENTRY_BYTES * entries.length)
  let offset = HEADER_BYTES + directory.length

  entries.forEach(({ size, png }, i) => {
    const at = i * ENTRY_BYTES
    // 0 means 256 — the field is a single byte, so 256 is the one size that cannot be written
    // literally. Anything larger has no representation at all and is a caller bug.
    if (size > 256) throw new Error(`${size}px is too large for an .ico`)
    directory[at] = size === 256 ? 0 : size //width
    directory[at + 1] = size === 256 ? 0 : size //height
    directory[at + 2] = 0 //palette size (0 = truecolour)
    directory[at + 3] = 0 //reserved
    directory.writeUInt16LE(1, at + 4) //colour planes
    directory.writeUInt16LE(32, at + 6) //bits per pixel
    directory.writeUInt32LE(png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += png.length
  })

  return Buffer.concat([header, directory, ...entries.map((e) => e.png)])
}

/**
 * Read back what {@link encodeIco} wrote — `[{ size, png }]`, in file order.
 *
 * This exists for the tests. An encoder verified only against "does the browser show it?" is
 * verified against nothing that runs in CI, and the two halves being written together is what
 * makes the byte offsets checkable rather than asserted.
 */
export function decodeIco(buf) {
  if (buf.readUInt16LE(2) !== 1) throw new Error("not an icon file")
  const count = buf.readUInt16LE(4)
  const images = []
  for (let i = 0; i < count; i++) {
    const at = HEADER_BYTES + i * ENTRY_BYTES
    const size = buf[at] === 0 ? 256 : buf[at]
    const length = buf.readUInt32LE(at + 8)
    const offset = buf.readUInt32LE(at + 12)
    images.push({ size, png: buf.subarray(offset, offset + length) })
  }
  return images
}
