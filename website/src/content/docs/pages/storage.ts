import { StorageDemo } from "@/components/docs-demos/storage-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "storage",
  title: "Storage",
  summary:
    "Three tiers behind one API: a synchronous key-value store you can read during render, an async store for large values, and secure storage for secrets.",
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
          "Synchronous, with a hook",
          "`localStorage`",
          "An in-memory copy kept in step with native preferences",
          "Flags, settings, anything read during render",
        ],
        [
          "`store`",
          "Async, with a hook",
          "IndexedDB",
          "IndexedDB, the WebView's own",
          "Large or structured values, an offline cache",
        ],
        [
          "`secure`",
          "Async, strings only, no hook",
          "`localStorage`. **Not secure.**",
          "Keychain on iOS, Keystore-backed encryption on Android",
          "Tokens and secrets",
        ],
      ],
    },
    {
      type: "p",
      text: "Pick by what the value is. A value you read while rendering goes in `kv`, because it is the only tier that answers without an `await`. A value too big or too structured for JSON goes in `store`. A value that would hurt if another app or a backup could read it goes in `secure`.",
    },
    {
      type: "p",
      text: "All three are safe to import during server rendering, and none of them touches your own data: `kv` and `secure` prefix every key they write (`adaptv:kv:`, `adaptv:secure:`), and `store` has its own IndexedDB database, `adaptv-store`. The three tiers are also available as one object, `storage.kv`, `storage.store` and `storage.secure`; importing them by name tree-shakes better.",
    },

    { type: "h2", text: "kv" },
    {
      type: "p",
      text: "Synchronous key-value storage. Reads come from memory and never wait, so a feature flag needs no loading state and the app needs no boot gate. Values are JSON-encoded: anything `JSON.stringify` handles round-trips, and a `Date` comes back as a string.",
    },
    {
      type: "props",
      rows: [
        {
          name: "kv.get(key, fallback?)",
          type: "<T>(key: string, fallback?: T) => T | undefined",
          description:
            "Read a value. The fallback applies only when the key is absent; a stored `false` or `0` is returned as it is. The same object is returned on every read until the key is written again.",
        },
        {
          name: "kv.set(key, value)",
          type: "<T>(key: string, value: T) => void",
          description:
            "Write a value and notify subscribers. It never throws: if the write cannot be persisted (quota, private mode, a native error) the value is kept in memory for the session.",
        },
        {
          name: "kv.remove(key)",
          type: "(key: string) => void",
          description: "Delete a key and notify subscribers.",
        },
        {
          name: "kv.clear()",
          type: "() => void",
          description:
            "Delete every key written through `kv`. Your own `localStorage` entries are not touched.",
        },
      ],
    },
    {
      type: "api",
      name: "useKv()",
      signature:
        "function useKv<T>(key: string, fallback: T): [T, (value: T) => void]",
      description:
        "`useState` for a persisted value. Every component watching the key re-renders on a write, from anywhere: another component, `kv.set` outside React, or another tab of the same app.",
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
          description:
            "Returned while the key is absent. It is not written to storage. Pass a stable reference when it is an object.",
        },
      ],
      returns:
        "`[value, set]`. The setter takes a value, not an updater function. During server rendering and hydration the value is the fallback; a stored value appears straight after hydration.",
    },
    {
      type: "code",
      label: "onboarding.tsx",
      lang: "tsx",
      code: `const [onboarded, setOnboarded] = useKv("onboarded", false)

if (!onboarded) return <Welcome onDone={() => setOnboarded(true)} />`,
    },
    {
      type: "code",
      label: "flags.ts",
      lang: "ts",
      code: `import { kv } from "@arrzdev/adaptv/storage"

export function isBetaEnabled() {
  return kv.get("beta", false)
}`,
    },
    {
      type: "api",
      name: "subscribeKv()",
      signature:
        "function subscribeKv(key: string, listener: () => void): () => void",
      description:
        "Be told when one key changes, outside React. The listener receives no value; read it with `kv.get`. Returns an unsubscribe.",
    },
    {
      type: "p",
      text: "Two more exports belong to the shell. `initKv()` loads the native values into memory; the shell starts it at boot, while the splash screen is still up. It is not awaited, so on native a component that renders before it finishes gets the fallback and re-renders when the values arrive. It does nothing on web, where the values load synchronously at import. `KV_PREFIX` is the `adaptv:kv:` string.",
    },
    {
      type: "note",
      tone: "warn",
      text: "`kv` is plaintext on every target. On native it is backed by `UserDefaults` on iOS and `SharedPreferences` on Android. Never put a token in it. On native a write is persisted a moment after `set` returns, so a hard crash in that instant loses the last write; on web a write is durable as soon as `set` returns.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "`localStorage`, a few megabytes per origin. Changes sync across tabs.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "Same. In a private window that blocks storage it works in memory for the session.",
        },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: "Native preferences. Survives the WebView's storage being cleared.",
        },
        { target: "Android", status: "yes", note: "Native preferences." },
      ],
    },

    { type: "h2", text: "store" },
    {
      type: "p",
      text: "An async key-value store for large values, on IndexedDB. Values are stored by structured clone, so `Date`, `Map`, `Set` and `Blob` round-trip as themselves. It is a blob store: there are no queries, indexes or migrations. A real query layer is your app's to choose.",
    },
    {
      type: "props",
      rows: [
        {
          name: "store.get(key)",
          type: "<T>(key: string) => Promise<T | undefined>",
          description: "Read a value. `undefined` when absent.",
        },
        {
          name: "store.set(key, value)",
          type: "<T>(key: string, value: T) => Promise<void>",
          description:
            "Write a value. The value is readable at once, before the database has committed. Never rejects: if the database refuses the write (a quota overrun) the value is kept in memory for the session and `isPersistent()` turns `false`.",
        },
        {
          name: "store.remove(key)",
          type: "(key: string) => Promise<void>",
          description: "Delete a key. Never rejects.",
        },
        {
          name: "store.clear()",
          type: "() => Promise<void>",
          description:
            "Delete every key in adaptv's store. Other databases are not touched.",
        },
        {
          name: "store.keys()",
          type: "() => Promise<string[]>",
          description: "Every key currently held.",
        },
        {
          name: "store.isPersistent()",
          type: "() => Promise<boolean>",
          description:
            "`false` when something is being held in memory only: there is no IndexedDB here, or the last write or clear was refused. Use it to decide whether to warn the user, not whether to call `set`.",
        },
      ],
    },
    {
      type: "api",
      name: "useStore()",
      signature:
        "function useStore<T>(key: string): { data: T | undefined; isLoading: boolean; set: (value: T) => Promise<void> }",
      description:
        "A reactive read of one key. Unlike `useKv` it has a loading state, because the backing store is asynchronous and there is a real moment before the value is known. It follows writes to the key from anywhere in the page. Writes made in other tabs are not observed.",
      params: [
        {
          name: "key",
          type: "string",
          required: true,
          description:
            "The key. Changing it reloads, with `isLoading` back to `true`.",
        },
      ],
      returns:
        "`data` is `undefined` while loading and when the key is absent; check `isLoading` to tell them apart.",
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
        "Be told when a key is written, removed or cleared, outside React. The listener receives no value; call `store.get`, which already returns the new one. Returns an unsubscribe.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "IndexedDB. The quota is the browser's, usually a share of free disk.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Works. A browser may evict a site's storage under disk pressure, so treat it as a cache unless the app is installed.",
        },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: "The WebView's IndexedDB, inside the app's own container.",
        },
        { target: "Android", status: "yes", note: "The WebView's IndexedDB." },
      ],
    },

    { type: "h2", text: "secure" },
    {
      type: "p",
      text: "Storage for secrets, above all the session token. adaptv's auth model is a bearer token held by the client, because cookie-based sessions do not work reliably inside a native WebView. The token should live in the best store each platform has, and this tier is that store. It holds strings only; `JSON.stringify` anything else yourself. It has no hook, because a secret should not be render state.",
    },
    {
      type: "props",
      rows: [
        {
          name: "secure.get(key)",
          type: "(key: string) => Promise<string | undefined>",
          description: "Read a secret. `undefined` when absent.",
        },
        {
          name: "secure.set(key, value)",
          type: "(key: string, value: string) => Promise<void>",
          description:
            "Write a secret. This one **rejects** when the write fails, on every target: a token that silently failed to persist signs the user out on the next launch with no explanation.",
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
            "Whether this target can really keep a secret: `true` in a native build, `false` on web, always. Use it to set policy, such as a shorter token lifetime on web, not to decide whether to call `set`.",
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
      text: "On web this tier is not secure, and no browser API could make it so: any script running on your origin can read `localStorage`. It keeps the token in one known place; it does not protect it from XSS. Do not tell users a value is stored securely on web.",
    },
    {
      type: "note",
      tone: "info",
      text: "Native builds need the `@aparajita/capacitor-secure-storage` package. It is an optional dependency, so a web-only app never installs it. Add it to your app and rebuild the native app with `adaptv build ios` or `adaptv build android` (see the [CLI](/docs/cli)). Without it, every `secure` call in a native build rejects with an error that names the package. That error also tells you to run `adaptv sync`, a command the CLI does not have; rebuilding is what it means.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "`localStorage` under an `adaptv:secure:` prefix. Works, and is not secure.",
        },
        { target: "Mobile web", status: "partial", note: "Same." },
        { target: "Installed PWA", status: "partial", note: "Same." },
        { target: "iOS", status: "yes", note: "The Keychain." },
        {
          target: "Android",
          status: "yes",
          note: "AES-GCM with a key held in the Android Keystore.",
        },
      ],
    },
  ],
}
