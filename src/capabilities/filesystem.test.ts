import { Filesystem } from "@capacitor/filesystem"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  deleteFile,
  getFilesystemSupport,
  getFileUri,
  listFiles,
  readFile,
  readTextFile,
  statFile,
  writeFile,
} from "#adaptv/capabilities/filesystem"

/*
 * The native plugin, as a map of `directory/path` → base64, with the rejection
 * message the real one uses for a missing entry. Every method is a spy so a
 * test can also assert what the module asked the bridge for.
 */
const nativeFiles = new Map<string, { data: string; mtime: number }>()
const nativeDirs = new Set<string>()

function key(directory: string | undefined, path: string): string {
  return `${directory ?? "DATA"}/${path}`
}

vi.mock("@capacitor/filesystem", () => {
  const Directory = { Data: "DATA", Cache: "CACHE" }
  const Encoding = { UTF8: "utf8" }
  const missing = () => new Error("File does not exist.")
  const Filesystem = {
    writeFile: vi.fn(
      async (o: {
        path: string
        data: string
        directory?: string
        encoding?: string
      }) => {
        //`recursive: true` creates every ancestor, as the real plugin does
        const dirs = o.path.split("/").slice(0, -1)
        for (let i = 1; i <= dirs.length; i++) {
          nativeDirs.add(key(o.directory, dirs.slice(0, i).join("/")))
        }
        nativeFiles.set(key(o.directory, o.path), {
          data:
            o.encoding === "utf8"
              ? btoa(
                  Array.from(new TextEncoder().encode(o.data), (b) =>
                    String.fromCharCode(b),
                  ).join(""),
                )
              : o.data,
          mtime: 1_700_000_000_000,
        })
        return { uri: `file:///${o.path}` }
      },
    ),
    readFile: vi.fn(async (o: { path: string; directory?: string }) => {
      const hit = nativeFiles.get(key(o.directory, o.path))
      if (!hit) throw missing()
      return { data: hit.data }
    }),
    readdir: vi.fn(async (o: { path: string; directory?: string }) => {
      const prefix = o.path
        ? `${key(o.directory, o.path)}/`
        : `${o.directory ?? "DATA"}/`
      if (o.path && !nativeDirs.has(key(o.directory, o.path)))
        throw missing()
      const files = []
      for (const [k, v] of nativeFiles) {
        if (!k.startsWith(prefix)) continue
        const rest = k.slice(prefix.length)
        if (rest.includes("/")) continue
        files.push({
          name: rest,
          type: "file",
          size: atob(v.data).length,
          mtime: v.mtime,
          uri: `file:///${k}`,
        })
      }
      for (const d of nativeDirs) {
        if (!d.startsWith(prefix)) continue
        const rest = d.slice(prefix.length)
        if (rest.includes("/")) continue
        files.push({
          name: rest,
          type: "directory",
          size: 0,
          mtime: 0,
          uri: "",
        })
      }
      return { files }
    }),
    stat: vi.fn(async (o: { path: string; directory?: string }) => {
      const hit = nativeFiles.get(key(o.directory, o.path))
      if (hit) {
        return {
          type: "file",
          size: atob(hit.data).length,
          mtime: hit.mtime,
          uri: "",
        }
      }
      if (nativeDirs.has(key(o.directory, o.path))) {
        return { type: "directory", size: 0, mtime: 0, uri: "" }
      }
      throw missing()
    }),
    deleteFile: vi.fn(async (o: { path: string; directory?: string }) => {
      if (!nativeFiles.delete(key(o.directory, o.path))) throw missing()
    }),
    getUri: vi.fn(async (o: { path: string; directory?: string }) => ({
      uri: `file:///container/${o.directory ?? "DATA"}/${o.path}`,
    })),
  }
  return { Directory, Encoding, Filesystem }
})

/*
 * OPFS, in memory: a directory is a Map of name → node, a file holds bytes and
 * the time of its last close. The three DOMException names the module keys on
 * are the ones the real API throws.
 */
type FakeFile = {
  kind: "file"
  name: string
  bytes: Uint8Array
  mtime: number
}
type FakeDir = {
  kind: "directory"
  name: string
  children: Map<string, FakeFile | FakeDir>
}

function domError(name: string, message = name): Error {
  const error = new Error(message)
  error.name = name
  return error
}

function fileHandle(node: FakeFile, onWrite: () => void) {
  return {
    kind: "file" as const,
    name: node.name,
    getFile: async () =>
      new File([node.bytes as BlobPart], node.name, {
        lastModified: node.mtime,
      }),
    createWritable: async () => {
      let pending = new Uint8Array(0)
      return {
        write: async (data: Uint8Array | string) => {
          const bytes =
            typeof data === "string"
              ? new TextEncoder().encode(data)
              : data
          const next = new Uint8Array(pending.length + bytes.length)
          next.set(pending)
          next.set(bytes, pending.length)
          pending = next
        },
        close: async () => {
          node.bytes = pending
          node.mtime = Date.now()
          onWrite()
        },
      }
    },
  }
}

function dirHandle(node: FakeDir, quota: { left: number }): unknown {
  return {
    kind: "directory" as const,
    name: node.name,
    getDirectoryHandle: async (name: string, o?: { create?: boolean }) => {
      let child = node.children.get(name)
      if (!child) {
        if (!o?.create) throw domError("NotFoundError")
        child = { kind: "directory", name, children: new Map() }
        node.children.set(name, child)
      }
      if (child.kind !== "directory") throw domError("TypeMismatchError")
      return dirHandle(child, quota)
    },
    getFileHandle: async (name: string, o?: { create?: boolean }) => {
      let child = node.children.get(name)
      if (!child) {
        if (!o?.create) throw domError("NotFoundError")
        child = { kind: "file", name, bytes: new Uint8Array(0), mtime: 0 }
        node.children.set(name, child)
      }
      if (child.kind !== "file") throw domError("TypeMismatchError")
      const file = child
      return fileHandle(file, () => {
        quota.left -= file.bytes.length
        if (quota.left < 0) throw domError("QuotaExceededError")
      })
    },
    removeEntry: async (name: string) => {
      if (!node.children.delete(name)) throw domError("NotFoundError")
    },
    entries: async function* () {
      for (const [name, child] of node.children) {
        yield [
          name,
          child.kind === "file"
            ? fileHandle(child, () => {})
            : dirHandle(child, quota),
        ]
      }
    },
  }
}

let opfsRootNode: FakeDir
const quota = { left: Number.POSITIVE_INFINITY }

function installOpfs(
  options: { createWritable?: boolean; refuse?: boolean } = {},
): void {
  opfsRootNode = { kind: "directory", name: "", children: new Map() }
  quota.left = Number.POSITIVE_INFINITY
  vi.stubGlobal("navigator", {
    storage: {
      getDirectory: async () => {
        if (options.refuse) {
          throw domError(
            "UnknownError",
            "The operation failed for an unknown transient reason (e.g. out of memory).",
          )
        }
        return dirHandle(opfsRootNode, quota)
      },
    },
  })
  vi.stubGlobal(
    "FileSystemFileHandle",
    options.createWritable === false
      ? { prototype: {} }
      : { prototype: { createWritable() {} } },
  )
}

function forceNative(plugins: string[] | null): void {
  vi.stubGlobal("Capacitor", {
    isNativePlatform: () => true,
    ...(plugins
      ? { PluginHeaders: plugins.map((name) => ({ name })) }
      : {}),
  })
}

beforeEach(() => {
  nativeFiles.clear()
  nativeDirs.clear()
  vi.stubGlobal("window", globalThis)
})

/*
 * The module memoises the root it opens per `navigator.storage`; every
 * `installOpfs` stubs a new navigator, so each test opens its own tree.
 */

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("getFilesystemSupport", () => {
  it("is unsupported with no caveat on the server", async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal("window", undefined)
    expect(await getFilesystemSupport()).toEqual({
      supported: false,
      backend: null,
      caveat: null,
    })
  })

  it("is the native plugin inside a binary that carries it", async () => {
    forceNative(["Filesystem", "Haptics"])
    expect(await getFilesystemSupport()).toEqual({
      supported: true,
      backend: "native",
      caveat: null,
    })
  })

  it("names the store update on a binary that predates the plugin", async () => {
    forceNative(["Haptics"])
    const support = await getFilesystemSupport()
    expect(support.supported).toBe(false)
    expect(support.backend).toBeNull()
    expect(support.caveat).toMatch(/predates/)
  })

  it("is OPFS on a browser with a directory and a writable, with the caveat that says where the files live", async () => {
    installOpfs()
    const support = await getFilesystemSupport()
    expect(support).toMatchObject({ supported: true, backend: "opfs" })
    expect(support.caveat).toMatch(/origin-private/)
  })

  it("names createWritable when a WebKit hands out the directory but cannot write into it", async () => {
    installOpfs({ createWritable: false })
    const support = await getFilesystemSupport()
    expect(support.supported).toBe(false)
    expect(support.caveat).toMatch(/createWritable/)
  })

  it("names the missing file system on a browser with none", async () => {
    vi.stubGlobal("navigator", {})
    expect((await getFilesystemSupport()).caveat).toMatch(
      /no origin-private/,
    )
  })

  it("is unsupported, naming the error, when the browser has the API and refuses to open the root", async () => {
    //Playwright's WebKit 26.5, measured 2026-09-02: both entry points present,
    //getDirectory() rejects before any file is touched
    installOpfs({ refuse: true })
    const support = await getFilesystemSupport()
    expect(support.supported).toBe(false)
    expect(support.backend).toBeNull()
    expect(support.caveat).toMatch(
      /refused to open it: UnknownError: The operation failed/,
    )
    expect(await writeFile("a.txt", "x")).toBe("unsupported")
  })

  it("does not remember a refusal: the next call opens the root again", async () => {
    installOpfs()
    const storage = (
      navigator as unknown as {
        storage: { getDirectory: () => Promise<unknown> }
      }
    ).storage
    const open = storage.getDirectory
    let attempts = 0
    storage.getDirectory = async () => {
      attempts++
      if (attempts === 1) throw domError("UnknownError", "transient")
      return open()
    }
    expect((await getFilesystemSupport()).supported).toBe(false)
    expect((await getFilesystemSupport()).supported).toBe(true)
    expect(await writeFile("a.txt", "x")).toBe("written")
    expect(attempts).toBe(2)
  })
})

describe("unsupported target", () => {
  it("answers every call with a status, never a rejection", async () => {
    vi.stubGlobal("navigator", {})
    expect(await writeFile("a.txt", "x")).toBe("unsupported")
    expect(await readFile("a.txt")).toEqual({
      status: "unsupported",
      bytes: null,
    })
    expect(await readTextFile("a.txt")).toEqual({
      status: "unsupported",
      text: null,
    })
    expect(await listFiles()).toEqual({
      status: "unsupported",
      entries: null,
    })
    expect(await statFile("a.txt")).toEqual({
      status: "unsupported",
      entry: null,
    })
    expect(await deleteFile("a.txt")).toBe("unsupported")
  })
})

for (const backend of ["native", "opfs"] as const) {
  describe(`${backend} round trip`, () => {
    beforeEach(() => {
      if (backend === "native") forceNative(["Filesystem"])
      else installOpfs()
    })

    it("writes text and reads it back, as text and as bytes", async () => {
      expect(await writeFile("notes/today.txt", "héllo")).toBe("written")
      expect(await readTextFile("notes/today.txt")).toEqual({
        status: "ok",
        text: "héllo",
      })
      const read = await readFile("notes/today.txt")
      expect(read.status).toBe("ok")
      expect(Array.from(read.bytes ?? [])).toEqual(
        Array.from(new TextEncoder().encode("héllo")),
      )
    })

    it("writes bytes untouched, every value 0..255", async () => {
      const bytes = new Uint8Array(256).map((_, i) => i)
      expect(await writeFile("blob.bin", bytes)).toBe("written")
      const read = await readFile("blob.bin")
      expect(read.status).toBe("ok")
      expect(Array.from(read.bytes ?? [])).toEqual(Array.from(bytes))
    })

    it("reports a file that was never written as missing, not as a failure", async () => {
      expect(await readFile("nope.txt")).toEqual({
        status: "missing",
        bytes: null,
      })
      expect(await statFile("nope.txt")).toEqual({
        status: "missing",
        entry: null,
      })
      expect(await deleteFile("nope.txt")).toBe("missing")
      expect(await listFiles("never")).toEqual({
        status: "missing",
        entries: null,
      })
    })

    it("lists a directory's direct children with kind and size", async () => {
      await writeFile("dir/a.txt", "aa")
      await writeFile("dir/b.txt", "bbb")
      await writeFile("dir/sub/c.txt", "c")
      const listing = await listFiles("dir")
      expect(listing.status).toBe("ok")
      expect(
        listing.entries?.map((e) => [e.name, e.kind, e.size]).sort(),
      ).toEqual([
        ["a.txt", "file", 2],
        ["b.txt", "file", 3],
        ["sub", "directory", null],
      ])
    })

    it("stats a file with its size and a last write", async () => {
      await writeFile("s.txt", "four")
      const stat = await statFile("s.txt")
      expect(stat.status).toBe("ok")
      expect(stat.entry).toMatchObject({
        name: "s.txt",
        kind: "file",
        size: 4,
      })
      expect(stat.entry?.modifiedAt).toBeGreaterThan(0)
    })

    it("deletes, and the file is missing afterwards", async () => {
      await writeFile("gone.txt", "x")
      expect(await deleteFile("gone.txt")).toBe("deleted")
      expect((await readFile("gone.txt")).status).toBe("missing")
    })

    it("keeps the cache scope apart from data", async () => {
      await writeFile("same.txt", "data")
      await writeFile("same.txt", "cache", { scope: "cache" })
      expect((await readTextFile("same.txt")).text).toBe("data")
      expect(
        (await readTextFile("same.txt", { scope: "cache" })).text,
      ).toBe("cache")
      expect(
        (await listFiles("", { scope: "cache" })).entries?.map(
          (e) => e.name,
        ),
      ).toEqual(["same.txt"])
    })

    it("refuses a path that escapes, as a failure rather than a write elsewhere", async () => {
      expect(await writeFile("../up.txt", "x")).toBe("failed")
      expect(await writeFile("a/./b.txt", "x")).toBe("failed")
      expect(await writeFile("", "x")).toBe("failed")
      expect((await readFile("../up.txt")).status).toBe("failed")
      expect(await writeFile("notes/../../up.txt", "x")).toBe("failed")
      expect((await listFiles("..")).status).toBe("failed")
      expect((await statFile("a/..")).status).toBe("failed")
      expect(await deleteFile("../x.txt")).toBe("failed")
    })

    it("reads an absolute path as relative to the scope, never to the device root", async () => {
      expect(await writeFile("/abs//x.txt", "rooted")).toBe("written")
      expect(await readTextFile("abs/x.txt")).toEqual({
        status: "ok",
        text: "rooted",
      })
    })

    it("lists a scope that was never written as an empty root, not as missing", async () => {
      expect(await listFiles("")).toEqual({ status: "ok", entries: [] })
    })
  })
}

describe("native specifics", () => {
  beforeEach(() => forceNative(["Filesystem"]))

  it("asks the bridge for UTF-8 on text and base64 on bytes, and creates directories", async () => {
    await writeFile("t/x.txt", "hi")
    expect(Filesystem.writeFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "adaptv/data/t/x.txt",
        encoding: "utf8",
        recursive: true,
        directory: "DATA",
      }),
    )
    await writeFile("b.bin", new Uint8Array([0, 255]), { scope: "cache" })
    expect(Filesystem.writeFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "adaptv/cache/b.bin",
        data: btoa(String.fromCharCode(0, 255)),
        directory: "CACHE",
      }),
    )
    expect(
      (Filesystem.writeFile as ReturnType<typeof vi.fn>).mock
        .lastCall?.[0],
    ).not.toHaveProperty("encoding")
  })

  it("keeps everything under the same adaptv directory the web uses, so no path reaches what lives beside it", async () => {
    //Android's Directory.Data is the app's filesDir, which also holds the
    //live-update plugin's `_capacitor_live_update_bundles`
    const bundle = key(
      "DATA",
      "_capacitor_live_update_bundles/b1/index.html",
    )
    nativeDirs.add(key("DATA", "_capacitor_live_update_bundles"))
    nativeDirs.add(key("DATA", "_capacitor_live_update_bundles/b1"))
    nativeFiles.set(bundle, { data: btoa("<html>"), mtime: 1 })

    await writeFile("a.txt", "x")
    await writeFile("c.txt", "y", { scope: "cache" })
    expect([...nativeFiles.keys()].sort()).toEqual([
      "CACHE/adaptv/cache/c.txt",
      "DATA/_capacitor_live_update_bundles/b1/index.html",
      "DATA/adaptv/data/a.txt",
    ])
    expect((await listFiles("")).entries?.map((e) => e.name)).toEqual([
      "a.txt",
    ])
    expect(
      (await listFiles("_capacitor_live_update_bundles")).status,
    ).toBe("missing")
    expect(
      await writeFile(
        "_capacitor_live_update_bundles/b1/index.html",
        "gone",
      ),
    ).toBe("written")
    expect(
      await deleteFile("_capacitor_live_update_bundles/b1/index.html"),
    ).toBe("deleted")
    expect(nativeFiles.get(bundle)?.data).toBe(btoa("<html>"))
  })

  it("hands out a file URI for a file that exists, and missing for one that does not", async () => {
    await writeFile("export/backup.json", "{}", { scope: "cache" })
    expect(
      await getFileUri("export/backup.json", { scope: "cache" }),
    ).toEqual({
      status: "ok",
      uri: "file:///container/CACHE/adaptv/cache/export/backup.json",
    })
    expect(Filesystem.getUri).toHaveBeenCalledWith({
      path: "adaptv/cache/export/backup.json",
      directory: "CACHE",
    })
    expect(
      await getFileUri("export/nope.json", { scope: "cache" }),
    ).toEqual({
      status: "missing",
      uri: null,
    })
    expect(Filesystem.getUri).toHaveBeenCalledTimes(1)
  })

  it("maps a full disk to quota and any other rejection to failed", async () => {
    const write = Filesystem.writeFile as ReturnType<typeof vi.fn>
    write.mockRejectedValueOnce(new Error("No space left on device"))
    expect(await writeFile("q.txt", "x")).toBe("quota")
    write.mockRejectedValueOnce(new Error("Permission denied"))
    expect(await writeFile("q.txt", "x")).toBe("failed")
  })
})

describe("opfs specifics", () => {
  beforeEach(() => installOpfs())

  it("keeps everything under one adaptv directory, per scope", async () => {
    await writeFile("a.txt", "x")
    await writeFile("c.txt", "y", { scope: "cache" })
    const adaptv = opfsRootNode.children.get("adaptv") as FakeDir
    expect([...adaptv.children.keys()].sort()).toEqual(["cache", "data"])
    expect([
      ...(adaptv.children.get("data") as FakeDir).children.keys(),
    ]).toEqual(["a.txt"])
  })

  it("has no URI to give: an origin-private file is reachable only through its handle", async () => {
    await writeFile("a.txt", "x")
    expect(await getFileUri("a.txt")).toEqual({
      status: "unsupported",
      uri: null,
    })
  })

  it("reports the quota as quota", async () => {
    quota.left = 3
    expect(await writeFile("big.txt", "12345")).toBe("quota")
  })

  it("reports a file where a directory was expected as a failure", async () => {
    await writeFile("leaf", "x")
    expect(await writeFile("leaf/inside.txt", "y")).toBe("failed")
    expect((await listFiles("leaf")).status).toBe("failed")
  })
})
