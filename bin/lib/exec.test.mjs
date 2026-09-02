import { describe, expect, it } from "vitest"
import { capture, exec, lineReader } from "./exec.mjs"

describe("capture's timeout", () => {
  /*
   * R59. The case this exists for is a platform daemon that has stopped answering — macOS's
   * `simdiskimaged` wedged, so every `simctl` sat forever inside one synchronous XPC call.
   * Without a ceiling the CLI waits exactly as long as the dev is willing to, with no row and
   * no reason, which is what `adaptv dev ios` did.
   */
  it("kills a child that outlives its ceiling and says so", async () => {
    const started = Date.now()
    const r = await capture("sleep", ["30"], { timeoutMs: 250 })
    expect(r.timedOut).toBe(true)
    //the point is that it came back at all, and quickly
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it("leaves a child that finishes in time completely alone", async () => {
    const r = await capture("printf", ["hello"], { timeoutMs: 5000 })
    expect(r.timedOut).toBe(false)
    expect(r.code).toBe(0)
    expect(r.stdout).toBe("hello")
  })

  it("has no ceiling at all unless one is asked for", async () => {
    const r = await capture("printf", ["hi"])
    expect(r.timedOut).toBe(false)
    expect(r.stdout).toBe("hi")
  })
})

/**
 * A chunk boundary is not a line boundary.
 *
 * Every phase label and every `--verbose` row the CLI prints comes off this reader, and so
 * does the one line a failed step quotes as its reason. It used to split each chunk on its
 * own, so wherever the kernel happened to cut the pipe, one line became two — and the line
 * it cut in half in the report that started this was `The sandbox is not in sync with the
 * Podfile.lock`, the example R30 uses for what a good failure reason looks like.
 */
describe("lines are assembled across chunks, not per chunk", () => {
  const collect = () => {
    const lines = []
    return { lines, reader: lineReader((l) => lines.push(l)) }
  }
  const feed = (reader, ...chunks) => {
    for (const c of chunks) reader.push(Buffer.from(c, "utf8"))
  }

  it("joins a line the stream cut in half", () => {
    const { lines, reader } = collect()
    feed(reader, "The sandbox is not in ", "sync with the Podfile.lock\n")
    reader.end()
    expect(lines).toEqual([
      "The sandbox is not in sync with the Podfile.lock",
    ])
  })

  it("keeps a character the stream cut in half", () => {
    //`─` is three bytes, and a build tool's own box drawing is full of them. Decoding each
    //chunk alone turned one into two replacement characters.
    const bytes = Buffer.from("── héllo ──\n", "utf8")
    const { lines, reader } = collect()
    reader.push(bytes.subarray(0, 2))
    reader.push(bytes.subarray(2))
    reader.end()
    expect(lines).toEqual(["── héllo ──"])
  })

  it("still delivers the last line when nothing terminates it", () => {
    //The line that says why a tool died is regularly the one it wrote without a newline.
    const { lines, reader } = collect()
    feed(reader, "compiling\nlinker command failed")
    reader.end()
    expect(lines).toEqual(["compiling", "linker command failed"])
  })

  it("treats a progress redraw as a line rather than hoarding it", () => {
    //`\r` always disappeared; the point is that it BREAKS. Without that, a tool that
    //redraws one row and never writes a newline would hold its whole run in memory and
    //report none of it.
    const { lines, reader } = collect()
    feed(reader, "10%\r20%\r", "30%\r")
    expect(lines).toEqual(["10%", "20%", "30%"])
    reader.end()
    expect(lines).toEqual(["10%", "20%", "30%"])
  })

  it("drops the blank lines it always dropped", () => {
    const { lines, reader } = collect()
    feed(reader, "\n   \nreal\n\n")
    reader.end()
    expect(lines).toEqual(["real"])
  })
})

describe("exec streams whole lines out of a real child", () => {
  /** A child that writes each string as its own flushed chunk. */
  const chunked = (...chunks) => [
    process.execPath,
    [
      "-e",
      `const w=(s)=>new Promise(r=>process.stdout.write(s,()=>setTimeout(r,30)));` +
        `(async()=>{for (const s of ${JSON.stringify(chunks)}) await w(s)})()`,
    ],
  ]

  it("reports a split line once, whole", async () => {
    const lines = []
    const [cmd, args] = chunked(
      "The sandbox is not in ",
      "sync with the Podfile.lock\n",
      "no trailing newline here",
    )
    await exec(cmd, args, { onLine: (l) => lines.push(l) })
    expect(lines).toEqual([
      "The sandbox is not in sync with the Podfile.lock",
      "no trailing newline here",
    ])
  })

  it("never splices stdout's half-line onto stderr's", async () => {
    //One buffer shared between the two streams would have produced `outerr`.
    const lines = []
    await exec(
      process.execPath,
      [
        "-e",
        `const w=(s,t)=>new Promise(r=>t.write(s,()=>setTimeout(r,30)));` +
          `(async()=>{await w("out",process.stdout);await w("err\\n",process.stderr);` +
          `await w("side\\n",process.stdout)})()`,
      ],
      { onLine: (l) => lines.push(l) },
    )
    expect(lines).toContain("err")
    expect(lines).toContain("outside")
    expect(lines.join(" ")).not.toContain("outerr")
  })
})
