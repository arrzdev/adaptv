import { StorageDemo } from "@/components/docs-demos/storage-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "storage",
  title: "Storage",
  summary:
    "Three tiers, one API: a synchronous store, an async store for large values, and secure storage for secrets.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { kv, store, secure, useKv, useStore } from "@arrzdev/adaptv/storage"',
  source: "src/storage",
  blocks: [
    {
      type: "demo",
      component: StorageDemo,
      code: `import { useKv } from "@arrzdev/adaptv/storage"

const [count, setCount] = useKv("count", 0)

<Button onClick={() => setCount(count + 1)}>+1</Button>
<Text>{count}</Text>`,
    },
    { type: "h2", text: "The three tiers" },
    {
      type: "table",
      head: ["Tier", "Shape", "Web and PWA", "iOS and Android", "Use it for"],
      rows: [
        [
          "`kv`",
          "Sync, with a hook",
          "`localStorage`",
          "Memory copy, saved to native preferences",
          "Flags and settings that render reads",
        ],
        [
          "`store`",
          "Async, with a hook",
          "IndexedDB",
          "IndexedDB in the WebView",
          "Large or structured values",
        ],
        [
          "`secure`",
          "Async, strings, no hook",
          "`localStorage`. **Not secure.**",
          "Keychain on iOS, Keystore on Android",
          "Tokens and secrets",
        ],
      ],
    },
    {
      type: "p",
      text: "All three are safe to import during server rendering. They never touch your own data. `kv` and `secure` prefix every key (`adaptv:kv:`, `adaptv:secure:`). `store` has its own database, `adaptv-store`.",
    },

    { type: "h2", text: "kv" },
    {
      type: "p",
      text: "Reads come from memory and never wait. Values are JSON, so a `Date` comes back as a string.",
    },
    {
      type: "props",
      rows: [
        {
          name: "kv.get(key, fallback?)",
          type: "<T>(key: string, fallback?: T) => T | undefined",
          description:
            "Read a value. The fallback applies only if the key is absent.",
        },
        {
          name: "kv.set(key, value)",
          type: "<T>(key: string, value: T) => void",
          description:
            "Write a value. It never throws. If the save fails, the value stays in memory.",
        },
        {
          name: "kv.remove(key)",
          type: "(key: string) => void",
          description: "Delete a key.",
        },
        {
          name: "kv.clear()",
          type: "() => void",
          description: "Delete every key that `kv` wrote.",
        },
      ],
    },
    {
      type: "api",
      name: "useKv()",
      signature:
        "function useKv<T>(key: string, fallback: T): [T, (value: T) => void]",
      description:
        "`useState` for a saved value. Every component that watches the key re-renders on a write, including from another tab.",
      params: [
        {
          name: "key",
          type: "string",
          required: true,
          description: "The key.",
        },
        {
          name: "fallback",
          type: "T",
          required: true,
          description: "Used while the key is absent. It is not saved.",
        },
      ],
      returns:
        "`[value, set]`. The setter takes a value, not an updater function. On the server and during hydration, the value is the fallback.",
    },
    {
      type: "code",
      label: "onboarding.tsx",
      lang: "tsx",
      code: `const [onboarded, setOnboarded] = useKv("onboarded", false)

if (!onboarded) return <Welcome onDone={() => setOnboarded(true)} />`,
    },
    {
      type: "api",
      name: "subscribeKv()",
      signature:
        "function subscribeKv(key: string, listener: () => void): () => void",
      description:
        "Hear when one key changes, outside React. The listener gets no value. Read it with `kv.get`.",
      returns: "An unsubscribe function.",
    },
    {
      type: "p",
      text: "The shell calls `initKv()` at boot to load native values. On native, a component that renders first gets the fallback, then re-renders.",
    },
    {
      type: "note",
      tone: "warn",
      text: "`kv` is plaintext on every target. Never put a token in it. On native, a write is saved a moment after `set` returns. A hard crash then loses the last write.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Changes sync across tabs.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "In a private window that blocks storage, it uses memory.",
        },
        { target: "Installed PWA", status: "yes" },
        { target: "iOS", status: "yes", note: "`UserDefaults`." },
        { target: "Android", status: "yes", note: "`SharedPreferences`." },
      ],
    },

    { type: "h2", text: "store" },
    {
      type: "p",
      text: "An async store on IndexedDB. `Date`, `Map`, `Set` and `Blob` round-trip. It has no queries or indexes.",
    },
    {
      type: "props",
      rows: [
        {
          name: "store.get(key)",
          type: "<T>(key: string) => Promise<T | undefined>",
          description: "Read a value.",
        },
        {
          name: "store.set(key, value)",
          type: "<T>(key: string, value: T) => Promise<void>",
          description:
            "Write a value. It never rejects. If the database refuses, the value stays in memory and `isPersistent()` is `false`.",
        },
        {
          name: "store.remove(key)",
          type: "(key: string) => Promise<void>",
          description: "Delete a key. It never rejects.",
        },
        {
          name: "store.clear()",
          type: "() => Promise<void>",
          description: "Delete every key in adaptv's store.",
        },
        {
          name: "store.keys()",
          type: "() => Promise<string[]>",
          description: "Every key held.",
        },
        {
          name: "store.isPersistent()",
          type: "() => Promise<boolean>",
          description: "`false` if something is held in memory only.",
        },
      ],
    },
    {
      type: "api",
      name: "useStore()",
      signature:
        "function useStore<T>(key: string): { data: T | undefined; isLoading: boolean; set: (value: T) => Promise<void> }",
      description:
        "A reactive read of one key, with a loading state. It follows writes in the page, not in other tabs.",
      params: [
        {
          name: "key",
          type: "string",
          required: true,
          description: "The key. A new key reloads.",
        },
      ],
      returns:
        "`data` is `undefined` while loading and when the key is absent. Check `isLoading`.",
    },
    {
      type: "code",
      label: "draft-editor.tsx",
      lang: "tsx",
      code: `const { data: draft, isLoading, set } = useStore<Draft>("draft:" + postId)

if (isLoading) return <Skeleton />

<Editor value={draft ?? emptyDraft} onChange={(next) => void set(next)} />`,
    },
    {
      type: "api",
      name: "subscribeStore()",
      signature:
        "function subscribeStore(key: string, listener: () => void): () => void",
      description:
        "Hear when a key is written, removed or cleared. The listener gets no value. `store.get` returns the new one.",
      returns: "An unsubscribe function.",
    },
    {
      type: "targets",
      rows: [
        { target: "Desktop web", status: "yes" },
        {
          target: "Mobile web",
          status: "partial",
          note: "A browser can delete site storage when the disk is full.",
        },
        { target: "Installed PWA", status: "yes" },
        { target: "iOS", status: "yes" },
        { target: "Android", status: "yes" },
      ],
    },

    { type: "h2", text: "secure" },
    {
      type: "p",
      text: "Storage for secrets, such as a session token. Strings only. It has no hook.",
    },
    {
      type: "props",
      rows: [
        {
          name: "secure.get(key)",
          type: "(key: string) => Promise<string | undefined>",
          description: "Read a secret.",
        },
        {
          name: "secure.set(key, value)",
          type: "(key: string, value: string) => Promise<void>",
          description:
            "Write a secret. It **rejects** if the write fails, on every target.",
        },
        {
          name: "secure.remove(key)",
          type: "(key: string) => Promise<void>",
          description: "Delete a secret.",
        },
        {
          name: "secure.isHardwareBacked()",
          type: "() => boolean",
          description:
            "`true` in a native build. `false` on web. Use it for policy, such as a shorter token life on web.",
        },
      ],
    },
    {
      type: "code",
      label: "session.ts",
      lang: "ts",
      code: `import { secure } from "@arrzdev/adaptv/storage"

export async function saveSession(token: string) {
  await secure.set("session", token)
}

export async function loadSession() {
  return secure.get("session")
}

export const sessionLifetimeDays = secure.isHardwareBacked() ? 90 : 7`,
    },
    {
      type: "note",
      tone: "warn",
      text: "On web, this tier is not secure. Any script on your origin can read `localStorage`. Do not tell users that a value is stored securely on web.",
    },
    {
      type: "note",
      tone: "info",
      text: "Native builds need the `@aparajita/capacitor-secure-storage` package. Add it, then rebuild with `adaptv build ios` or `adaptv build android` (see the [CLI](/docs/cli)). Without it, every `secure` call rejects. The error says to run `adaptv sync`. That command does not exist. Rebuild instead.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "`localStorage`. Not secure.",
        },
        { target: "Mobile web", status: "partial", note: "Same." },
        { target: "Installed PWA", status: "partial", note: "Same." },
        { target: "iOS", status: "yes", note: "The Keychain." },
        {
          target: "Android",
          status: "yes",
          note: "AES-GCM with a key in the Keystore.",
        },
      ],
    },
  ],
}
