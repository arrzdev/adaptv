import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { crc32, inflateRawSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import type { ZipEntry } from "#adaptv/vite/ota-zip.ts"
import { createZip } from "#adaptv/vite/ota-zip.ts"

/**
 * The archive is unpacked by native code on a device, so "it looked fine" is not
 * available as evidence. Every test here reads the bytes back through the format
 * itself — the central directory is walked, each entry is inflated, and its CRC
 * is recomputed — and one test hands the file to the operating system's own
 * `unzip` for a second opinion adaptv did not write.
 */

type ReadEntry = {
  name: string
  method: number
  flags: number
  data: Buffer
}

/** Walk the central directory, the way an extractor does. */
function readZip(zip: Buffer): ReadEntry[] {
  const eocd = zip.length - 22
  expect(zip.readUInt32LE(eocd)).toBe(0x06054b50)
  const count = zip.readUInt16LE(eocd + 10)
  let cursor = zip.readUInt32LE(eocd + 16)

  const out: ReadEntry[] = []
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(cursor)).toBe(0x02014b50)
    const flags = zip.readUInt16LE(cursor + 8)
    const method = zip.readUInt16LE(cursor + 10)
    const sum = zip.readUInt32LE(cursor + 16)
    const compressed = zip.readUInt32LE(cursor + 20)
    const size = zip.readUInt32LE(cursor + 24)
    const nameLen = zip.readUInt16LE(cursor + 28)
    const local = zip.readUInt32LE(cursor + 42)
    const name = zip
      .subarray(cursor + 46, cursor + 46 + nameLen)
      .toString()

    //follow the pointer into the local header, exactly as an extractor would
    expect(zip.readUInt32LE(local)).toBe(0x04034b50)
    const localNameLen = zip.readUInt16LE(local + 26)
    const extraLen = zip.readUInt16LE(local + 28)
    const start = local + 30 + localNameLen + extraLen
    const body = zip.subarray(start, start + compressed)
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body)

    expect(data.length).toBe(size)
    expect(crc32(data)).toBe(sum)
    out.push({ name, method, flags, data })
    const extra = zip.readUInt16LE(cursor + 30)
    const comment = zip.readUInt16LE(cursor + 32)
    cursor += 46 + nameLen + extra + comment
  }
  return out
}

const text = (name: string, body: string): ZipEntry => ({
  name,
  data: Buffer.from(body),
})

describe("the OTA bundle archive", () => {
  it("round-trips every entry it was given", () => {
    const entries = [
      text("index.html", "<!doctype html><p>hello</p>"),
      text("assets/index-abc.js", "console.log('x')".repeat(40)),
      text("assets/style.css", "body{color:red}"),
    ]
    const read = readZip(createZip(entries))

    expect(read.map((e) => e.name)).toEqual([
      "assets/index-abc.js",
      "assets/style.css",
      "index.html",
    ])
    for (const entry of entries) {
      const found = read.find((e) => e.name === entry.name)
      expect(found?.data.equals(entry.data)).toBe(true)
    }
  })

  it("is byte-identical regardless of the order it was handed", () => {
    const a = [text("b.txt", "two"), text("a.txt", "one")]
    const b = [text("a.txt", "one"), text("b.txt", "two")]
    expect(createZip(a).equals(createZip(b))).toBe(true)
  })

  it("carries nothing from this machine or this moment", () => {
    //a build an hour later, or on someone else's laptop, must publish the same
    //bytes — otherwise every deploy announces a "new" bundle to every install
    const first = createZip([text("index.html", "same")])
    const second = createZip([text("index.html", "same")])
    expect(first.equals(second)).toBe(true)
    //DOS epoch in both the local and the central header
    expect(first.readUInt16LE(10)).toBe(0)
    expect(first.readUInt16LE(12)).toBe(0x0021)
  })

  it("stores what deflate would only make bigger", () => {
    //stand-in for the png/woff2 an app's client dir is full of. It has to be
    //genuinely random: any arithmetic sequence deflates beautifully, which is how
    //a "look, incompressible" fixture ends up proving the opposite of its name.
    const noise = randomBytes(2048)
    const [stored] = readZip(createZip([{ name: "img.png", data: noise }]))
    expect(stored?.method).toBe(0)
    expect(stored?.data.equals(noise)).toBe(true)

    const [packed] = readZip(createZip([text("a.js", "a".repeat(4096))]))
    expect(packed?.method).toBe(8)
  })

  it("flags a UTF-8 name, and only then", () => {
    const [plain] = readZip(createZip([text("assets/logo.svg", "<svg/>")]))
    expect(plain?.flags).toBe(0)

    const [unicode] = readZip(
      createZip([text("assets/café.svg", "<svg/>")]),
    )
    expect(unicode?.flags).toBe(0x0800)
    expect(unicode?.name).toBe("assets/café.svg")
  })

  it("refuses a path that would escape the extraction directory", () => {
    //this archive is unpacked into the app's data container by native code
    for (const name of [
      "../escape.js",
      "a/../../escape.js",
      "/etc/passwd",
      "C:/windows/system32",
      "a\\b.js",
      "",
    ]) {
      expect(() => createZip([text(name, "x")])).toThrow(
        /unsafe archive path/,
      )
    }
  })

  it("is accepted by an unzip adaptv did not write", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "adaptv-zip-"))
    const file = path.join(dir, "bundle.zip")
    writeFileSync(
      file,
      createZip([
        text("index.html", "<!doctype html>"),
        text("assets/app.js", "export const x = 1".repeat(20)),
      ]),
    )

    //`-t` verifies every entry's CRC against its decompressed bytes
    const report = execFileSync("unzip", ["-t", file], {
      encoding: "utf8",
    })
    expect(report).toContain("No errors detected")
    expect(
      execFileSync("unzip", ["-Z1", file], { encoding: "utf8" }),
    ).toContain("assets/app.js")
  })
})
