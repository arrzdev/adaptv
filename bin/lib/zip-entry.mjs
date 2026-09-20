// One file out of a zip archive, read the way an extractor does: find the end record, walk the
// central directory to the entry, follow its pointer to the local header, inflate the body.
//
// It exists for exactly one caller — reading `assets/capacitor.config.json` out of an APK pulled
// off an Android 7/8 device, which has no `unzip` of its own (it came with ziptool in Android 9).
// Stored and deflated entries only, no zip64: an APK's manifest-sized assets are neither, and
// anything this cannot read answers `null`, which the caller already treats as "rebuild".
import { inflateRawSync } from "node:zlib"

const END = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

/**
 * The bytes of `name` inside the zip `archive`, or `null` when it is absent or unreadable.
 * @param {Buffer} archive
 * @param {string} name
 * @returns {Buffer | null}
 */
export function readZipEntry(archive, name) {
  try {
    //The end record is the last 22 bytes unless the archive carries a comment (up to 65535
    //bytes), so scan back from the tail for its signature.
    let end = -1
    for (
      let i = archive.length - 22;
      i >= Math.max(0, archive.length - 22 - 0xffff);
      i--
    ) {
      if (archive.readUInt32LE(i) === END) {
        end = i
        break
      }
    }
    if (end < 0) return null
    const count = archive.readUInt16LE(end + 10)
    let cursor = archive.readUInt32LE(end + 16)
    for (let i = 0; i < count; i++) {
      if (archive.readUInt32LE(cursor) !== CENTRAL) return null
      const method = archive.readUInt16LE(cursor + 10)
      const compressed = archive.readUInt32LE(cursor + 20)
      const nameLen = archive.readUInt16LE(cursor + 28)
      const extraLen = archive.readUInt16LE(cursor + 30)
      const commentLen = archive.readUInt16LE(cursor + 32)
      const local = archive.readUInt32LE(cursor + 42)
      const entry = archive.toString(
        "utf8",
        cursor + 46,
        cursor + 46 + nameLen,
      )
      if (entry === name) {
        if (archive.readUInt32LE(local) !== LOCAL) return null
        //the local header's own name/extra lengths, which may differ from the central copy's
        const start =
          local +
          30 +
          archive.readUInt16LE(local + 26) +
          archive.readUInt16LE(local + 28)
        const body = archive.subarray(start, start + compressed)
        if (method === 0) return Buffer.from(body)
        if (method === 8) return inflateRawSync(body)
        return null
      }
      cursor += 46 + nameLen + extraLen + commentLen
    }
    return null
  } catch {
    return null
  }
}
