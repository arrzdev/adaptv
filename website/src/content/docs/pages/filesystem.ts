import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "filesystem",
  title: "Filesystem",
  summary:
    "Write, read, list and delete files the app owns. One path-based API on every target.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { getFilesystemSupport, writeFile, readFile, readTextFile, listFiles, statFile, getFileUri, deleteFile } from "adaptv/capabilities"',
  source: "src/capabilities/filesystem.ts",
  blocks: [
    {
      type: "p",
      text: "These functions store files that belong to the app. On native they live in the app's own container. On the web they live in the browser's origin-private file system (OPFS). The user cannot see them and other apps cannot read them. There is no hook for it. Call the functions from an event handler or an effect. For small values and settings, use [storage](/docs/storage). To hand a file to the share sheet, pass `{ path, scope }` in `storedFiles` to `share()` from [useShare](/docs/hooks-data).",
    },
    {
      type: "p",
      text: "Nothing here rejects. A write returns an outcome. A read returns a status and the value, or `null`. A missing file is a status, not an error.",
    },

    { type: "h2", text: "Paths and scopes" },
    {
      type: "p",
      text: 'Paths are relative and use `/`, such as `"notes/today.txt"`. A write creates the directories. A leading `/` is dropped. A path with `.` or `..` in it gives `"failed"`. Every path resolves under `adaptv/<scope>/`.',
    },
    { type: "h3", text: "FileOptions" },
    {
      type: "props",
      rows: [
        {
          name: "scope",
          type: '"data" | "cache"',
          default: '"data"',
          description:
            '`"data"`: on native it stays until the app is uninstalled or its data is cleared. On the web it lasts until the site data is cleared, but the browser may evict it under storage pressure, because adaptv never asks for persistent storage. `"cache"`: the OS may evict it on native. On the web it is a second directory under the same quota. A listing of one scope never shows the other.',
        },
      ],
    },
    { type: "h3", text: "Statuses and outcomes" },
    {
      type: "table",
      head: ["Value", "Meaning"],
      rows: [
        ['Status `"ok"`', "The value is in the result."],
        [
          'Status `"missing"`',
          'No such file. A directory that was never written is missing. The scope\'s root (`""`) is always listable and starts empty.',
        ],
        [
          'Status `"unsupported"`',
          "This target cannot hold files. See `getFilesystemSupport`.",
        ],
        ['Status `"failed"`', "Anything else, a bad path included."],
        ['Write `"written"`', "The file is stored."],
        ['Write `"quota"`', "The storage limit was reached."],
        ['Delete `"deleted"`', "The file is gone."],
        [
          'Delete `"missing"`',
          "There was nothing to delete. This is not a failure.",
        ],
      ],
    },

    { type: "h2", text: "getFilesystemSupport" },
    {
      type: "api",
      name: "getFilesystemSupport()",
      signature: "function getFilesystemSupport(): Promise<FilesystemSupport>",
      description:
        "Whether this target can hold files. It is async, because a browser can have the API and still refuse to open it. After the first success the answer is kept. The other functions call it themselves, so you need it only to show or hide a control.",
      returns: "`{ supported, backend, caveat }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "supported",
          type: "boolean",
          description: "`true` if files can be stored.",
        },
        {
          name: "backend",
          type: '"native" | "opfs" | null',
          description: "Which implementation answers. `null` when none can.",
        },
        {
          name: "caveat",
          type: "string | null",
          description:
            "What to know before relying on this target. On the web it says where the files live. When unsupported it says what is missing.",
        },
      ],
    },

    { type: "h2", text: "Write and read" },
    {
      type: "api",
      name: "writeFile()",
      signature:
        "function writeFile(path: string, data: string | Uint8Array, options?: FileOptions): Promise<FileWriteOutcome>",
      description:
        "Write a whole file, replacing what was there. A string is stored as UTF-8. Bytes are stored as given.",
      returns: '`"written"`, `"quota"`, `"unsupported"` or `"failed"`.',
    },
    {
      type: "api",
      name: "readFile()",
      signature:
        "function readFile(path: string, options?: FileOptions): Promise<FileRead>",
      description: "Read a whole file as bytes.",
      returns:
        '`{ status, bytes }`. `bytes` is a `Uint8Array`, or `null` unless `status` is `"ok"`.',
    },
    {
      type: "api",
      name: "readTextFile()",
      signature:
        "function readTextFile(path: string, options?: FileOptions): Promise<FileTextRead>",
      description: "Read a whole file decoded as UTF-8.",
      returns:
        '`{ status, text }`. `text` is `null` unless `status` is `"ok"`.',
    },
    {
      type: "code",
      label: "notes.ts",
      lang: "ts",
      code: `import { readTextFile, writeFile } from "adaptv/capabilities"

export async function saveNote(day: string, text: string) {
  const outcome = await writeFile(\`notes/\${day}.txt\`, text)
  if (outcome === "quota") throw new Error("Storage is full")
  return outcome === "written"
}

export async function loadNote(day: string) {
  const { status, text } = await readTextFile(\`notes/\${day}.txt\`)
  return status === "ok" ? text : null
}`,
    },

    { type: "h2", text: "List, inspect and delete" },
    {
      type: "api",
      name: "listFiles()",
      signature:
        "function listFiles(path?: string, options?: FileOptions): Promise<FileListing>",
      description:
        'The direct children of a directory, sorted by name. `""` is the scope\'s root.',
      returns:
        '`{ status, entries }`. `entries` is a `FileEntry[]`, or `null` unless `status` is `"ok"`.',
    },
    {
      type: "api",
      name: "statFile()",
      signature:
        "function statFile(path: string, options?: FileOptions): Promise<FileStat>",
      description: "One entry's kind, size and last write, without reading it.",
      returns: "`{ status, entry }`. `entry` is a `FileEntry` or `null`.",
    },
    { type: "h3", text: "FileEntry" },
    {
      type: "props",
      rows: [
        {
          name: "name",
          type: "string",
          description: "The file or directory name.",
        },
        {
          name: "kind",
          type: '"file" | "directory"',
          description: "What it is.",
        },
        {
          name: "size",
          type: "number | null",
          description:
            "Bytes. `null` for a directory and wherever the platform will not say.",
        },
        {
          name: "modifiedAt",
          type: "number | null",
          description:
            "Epoch milliseconds of the last write. `null` where the platform will not say.",
        },
      ],
    },
    {
      type: "api",
      name: "deleteFile()",
      signature:
        "function deleteFile(path: string, options?: FileOptions): Promise<FileDeleteOutcome>",
      description: "Remove one file.",
      returns: '`"deleted"`, `"missing"`, `"unsupported"` or `"failed"`.',
    },
    {
      type: "api",
      name: "getFileUri()",
      signature:
        "function getFileUri(path: string, options?: FileOptions): Promise<FileUri>",
      description:
        'Where the file lives, as a `file://` URI another native plugin can open. Native only. An origin-private file has no URI, so the web gives `"unsupported"`. Pass the bytes on instead.',
      returns: "`{ status, uri }`. `uri` is a string or `null`.",
    },

    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: 'Needs OPFS with `createWritable()`. Where the browser lacks it or refuses to open it, `getFilesystemSupport` says why and the calls give `"unsupported"`. No `getFileUri`.',
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Same as desktop.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same as desktop.",
        },
        { target: "iOS", status: "yes", note: "The app's container." },
        { target: "Android", status: "yes", note: "The app's container." },
      ],
    },
    {
      type: "note",
      tone: "warn",
      text: "On the web, files count against the browser's storage quota and the browser can evict them. Treat `data` as best-effort there. A native binary built before the filesystem plugin reports `supported: false` with a caveat. Updating the app from the store fixes it.",
    },
  ],
}
