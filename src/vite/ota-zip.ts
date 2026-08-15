import { crc32, deflateRawSync } from "node:zlib"

/**
 * A deterministic ZIP writer — the container an OTA bundle travels in.
 *
 * ## Why adaptv writes this itself
 *
 * The obvious alternatives are both worse. Shelling out to `zip` (what the lab
 * bench did while this was being proven) needs a binary that does not exist on
 * Windows and cannot be relied on in a CI image, and it needs a `find -exec
 * touch` pass first to flatten mtimes. A library would be a dependency in the
 * build path of every consumer for ~120 lines of a format that has not changed
 * since 1993 — and none of them make determinism the default.
 *
 * ## Determinism, and what it is actually for
 *
 * Same input bytes → same output bytes: entries are sorted, every timestamp is
 * the DOS epoch, and no host/attribute fields carry anything from this machine.
 * That is what makes a rebuild of unchanged sources reuse the *same* published
 * bundle instead of announcing a new one to every installed app.
 *
 * 🔴 But identity is the **buildTag** (a hash of the directory's contents), not
 * a hash of this file. `deflateRawSync` is deterministic within a zlib version
 * and is not contractually so across them, so a bundle rebuilt on a different
 * Node could compress to different bytes while describing the same app. The
 * manifest's `sha256` is a transport integrity check on one published artifact,
 * and the tag is what decides whether anything is new. Do not swap the two.
 *
 * ## What is deliberately not here
 *
 * No zip64, no encryption, no directory entries. The bundle proven end to end on
 * device carried none (a `zip -X -@` file list emits only files), and every
 * extractor that matters creates parent directories from the entry path. The
 * size guards below turn the zip64 gap into an error rather than a corrupt file.
 */

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const LOCAL_HEADER_BYTES = 30
const CENTRAL_HEADER_BYTES = 46
const EOCD_BYTES = 22
/** 2.0 — the floor that understands DEFLATE. */
const VERSION = 20
const METHOD_STORE = 0
const METHOD_DEFLATE = 8
/** General-purpose bit 11: the name is UTF-8 rather than CP437. */
const UTF8_NAME_FLAG = 0x0800
/** 1980-01-01 00:00:00, the earliest a DOS timestamp can express. */
const DOS_EPOCH_TIME = 0
const DOS_EPOCH_DATE = 0x0021
const MAX_ENTRIES = 0xffff
const MAX_BYTES = 0xffffffff

export type ZipEntry = {
  /** Forward-slashed, relative path inside the archive. */
  name: string
  data: Buffer
}

/** Build the archive. Entries are sorted here, so callers cannot make it vary. */
export function createZip(entries: ZipEntry[]): Buffer {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(
      `ota: ${entries.length} files exceeds the ${MAX_ENTRIES} a non-zip64 archive can index`,
    )
  }

  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of sorted) {
    const name = Buffer.from(assertSafeName(entry.name), "utf8")
    //bit 11 only when it is needed: an ASCII name is byte-identical in CP437, and
    //leaving the flag off keeps the archive readable by the oldest extractors.
    const flags = isAscii(entry.name) ? 0 : UTF8_NAME_FLAG
    const sum = crc32(entry.data)

    //DEFLATE unless it made the file bigger — which it does for anything already
    //compressed (png, woff2, jpg), and a client bundle is full of those.
    const packed = deflateRawSync(entry.data, { level: 9 })
    const deflated = packed.length < entry.data.length
    const body = deflated ? packed : entry.data
    const method = deflated ? METHOD_DEFLATE : METHOD_STORE

    if (entry.data.length > MAX_BYTES || body.length > MAX_BYTES) {
      throw new Error(
        `ota: ${entry.name} is larger than a non-zip64 archive can address`,
      )
    }

    const local = Buffer.alloc(LOCAL_HEADER_BYTES)
    local.writeUInt32LE(LOCAL_SIG, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_EPOCH_TIME, 10)
    local.writeUInt16LE(DOS_EPOCH_DATE, 12)
    local.writeUInt32LE(sum, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) //extra field
    locals.push(local, name, body)

    const central = Buffer.alloc(CENTRAL_HEADER_BYTES)
    central.writeUInt32LE(CENTRAL_SIG, 0)
    //"version made by": MS-DOS host, so no unix mode bits travel — the extractor
    //applies its own umask and the archive says nothing about this machine.
    central.writeUInt16LE(VERSION, 4)
    central.writeUInt16LE(VERSION, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(DOS_EPOCH_TIME, 12)
    central.writeUInt16LE(DOS_EPOCH_DATE, 14)
    central.writeUInt32LE(sum, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    //🔴 From here the central header is NOT the local one: "version made by" adds
    //two bytes at the front, so every field below sits 2 further along than its
    //local twin. Writing the local layout here produces an archive whose sizes and
    //offsets are read out of the wrong bytes — which an extractor reports as a
    //corrupt CRC, nowhere near the mistake.
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) //extra
    central.writeUInt16LE(0, 32) //comment
    central.writeUInt16LE(0, 34) //disk number
    central.writeUInt16LE(0, 36) //internal attributes
    central.writeUInt32LE(0, 38) //external attributes
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += LOCAL_HEADER_BYTES + name.length + body.length
  }

  const directory = Buffer.concat(centrals)
  const eocd = Buffer.alloc(EOCD_BYTES)
  eocd.writeUInt32LE(EOCD_SIG, 0)
  eocd.writeUInt16LE(0, 4) //this disk
  eocd.writeUInt16LE(0, 6) //disk holding the directory
  eocd.writeUInt16LE(sorted.length, 8)
  eocd.writeUInt16LE(sorted.length, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20) //comment

  return Buffer.concat([...locals, directory, eocd])
}

/**
 * Reject a name that would escape the extraction directory.
 *
 * This archive is unpacked by native code into the app's data container, so a
 * `../` inside it is a write outside the sandbox's bundle directory. The names
 * come from a directory adaptv just built, which is exactly the reasoning that
 * makes such a check get skipped — and exactly why it is cheap to keep.
 */
function assertSafeName(name: string): string {
  const bad =
    name === "" ||
    name.startsWith("/") ||
    name.includes("\\") ||
    /(^|\/)\.\.(\/|$)/.test(name) ||
    /^[a-zA-Z]:/.test(name)
  if (bad)
    throw new Error(`ota: unsafe archive path ${JSON.stringify(name)}`)
  return name
}

function isAscii(value: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the point is the byte range
  return /^[\x00-\x7f]*$/.test(value)
}
