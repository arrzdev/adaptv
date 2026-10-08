import { createFileRoute } from "adaptv/router"
import {
  KV_PREFIX,
  kv,
  secure,
  store,
  subscribeKv,
  subscribeStore,
  useKv,
  useStore,
} from "adaptv/storage"
import { useCallback, useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabRow,
  LabSection,
  useClientValue,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"
import { TextInput } from "@/components/ui"

export const Route = createFileRoute("/_providers/lab/storage")({
  component: LabStoragePage,
})

const COUNTER_KEY = "lab-storage.counter"
const NOTE_KEY = "lab-storage.note"
const LARGE_KEY = "lab-storage.large"
const SECRET_KEY = "lab-storage.secret"
const SECURE_PREFIX = "adaptv:secure:"
const LARGE_BYTES = 1024 * 1024

type Note = { count: number; savedAt: Date }

/** What `localStorage` itself holds under a key — `null` when absent or unreadable. */
function readLocalStorage(storageKey: string): string | null {
  try {
    return localStorage.getItem(storageKey)
  } catch {
    return null
  }
}

/**
 * Random, not repeated: a repeated byte compresses to almost nothing inside
 * the browser's IndexedDB, and the value would then never be large on disk.
 */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  //getRandomValues refuses more than 65 536 bytes per call
  for (let offset = 0; offset < length; offset += 65_536) {
    crypto.getRandomValues(bytes.subarray(offset, offset + 65_536))
  }
  return bytes
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.name : String(error)
}

function LabStoragePage() {
  //Bumped by "Clear everything": the sections remount, so every row they hold
  //in local state (a read-back, an outcome) starts over with the storage.
  const [generation, setGeneration] = useState(0)

  async function clearEverything() {
    kv.clear()
    //settled, not awaited in turn: a native build without the secure-storage
    //plugin rejects the remove, and the rest of the reset must still happen
    await Promise.allSettled([store.clear(), secure.remove(SECRET_KEY)])
    setGeneration((current) => current + 1)
  }

  return (
    <LabPage
      title="Storage"
      subtitle="Three tiers under one namespace: kv is synchronous, store is asynchronous and structured, secure is for secrets — and on the web it is only best-effort."
    >
      <LabBrief
        what="That each tier keeps what it was given across a reload, that every component on a key follows a write, that kv reaches other tabs while store does not, and that secure is honest about what the web can and cannot protect."
        steps={[
          "Press “Increment from A” a few times. Both kv components and the notification count must move together, and the localStorage row must hold the same number. Reload: the number must still be there.",
          "Open this page in a second tab of the same browser and increment there. The first tab must follow without a reload. That is the web only — an app has one window.",
          "Press “Write from A” under store. Component B must show the same count at the same time, and “Date survived” must say yes. Reload: both must come back with the count.",
          "Write to store in the second tab. The first tab must NOT follow until it is reloaded — the store tier does not observe other tabs, by design.",
          "Press “Write 1 MB of random bytes”. The read-back must be 1 048 576 bytes and persistent must stay yes.",
          "Type a secret and press Save, then Read. On the web the plain-localStorage row shows the secret in the clear — that is the point of the row, not a leak in the page.",
          "Press “Clear everything” when done. Every row must read as it did when the page first opened: kv at zero, store absent, and the large value and the secret not read yet.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "kv and store work fully and durably; kv crosses tabs, store does not. secure is plain localStorage under an adaptv:secure: prefix, readable by any script on the origin, and “hardware-backed” reads no. A write the browser refuses is not the same on each tier: kv keeps it in memory for the session, secure throws.",
          },
          pwa: {
            verdict: "partial",
            note: "Same as the browser tab. Installing does not make secure secure. On iOS the installed app has its own storage, separate from Safari's — values written in the tab are not there after Add to Home Screen.",
          },
          ios: {
            verdict: "works",
            note: "kv is an in-memory map mirrored to the platform's preferences store (plaintext), hydrated behind the splash; a write lands a tick later. store is the web view's IndexedDB. secure is the Keychain and “hardware-backed” reads yes — Save reports a missing-plugin error if the app was built without the secure-storage plugin. The second-tab steps do not apply.",
          },
          android: {
            verdict: "works",
            note: "As on iOS, with SharedPreferences behind kv and the Android Keystore behind secure. The second-tab steps do not apply.",
          },
        }}
        wrong="The two components on a key disagree after a write, a value is gone after a reload, the second tab never follows a kv write — or “hardware-backed” reads yes in a browser, which would be the framework calling a readable localStorage entry secure."
      />
      <KvSection key={`kv-${generation}`} />
      <StoreSection key={`store-${generation}`} />
      <SecureSection key={`secure-${generation}`} />
      <LabSection title="Reset">
        <LabActions>
          <LabButton tone="danger" onClick={() => void clearEverything()}>
            Clear everything
          </LabButton>
        </LabActions>
      </LabSection>
    </LabPage>
  )
}

function KvSection() {
  const [notifications, setNotifications] = useState(0)
  const [raw, setRaw] = useState<string | null>(null)

  const refreshRaw = useCallback(() => {
    setRaw(readLocalStorage(KV_PREFIX + COUNTER_KEY))
  }, [])

  useEffect(() => {
    refreshRaw()
    return subscribeKv(COUNTER_KEY, () => {
      setNotifications((count) => count + 1)
      refreshRaw()
    })
  }, [refreshRaw])

  return (
    <LabSection
      title="kv — synchronous"
      description="Two components on one key, plus a bare subscribeKv listener. The value is read during render, so there is never a loading state."
    >
      <KvReader name="A" />
      <KvReader name="B" />
      <LabRow
        label="subscribeKv notifications"
        value={<span data-testid="kv-notifications">{notifications}</span>}
        hint="Counts every change to the key this page was told about — its own writes, and on the web other tabs' writes too."
      />
      <LabRow
        label="localStorage holds"
        value={
          <span data-testid="kv-raw">
            {raw === null ? "nothing" : raw}
          </span>
        }
        hint="What the browser's storage itself has under the prefixed key. When it refuses a write, the components above keep the new value for the session and this row keeps the old one."
      />
      <LabActions>
        <KvIncrementButton />
        <LabButton onClick={() => kv.set(COUNTER_KEY, 100)}>
          kv.set 100 outside React
        </LabButton>
        <LabButton tone="danger" onClick={() => kv.remove(COUNTER_KEY)}>
          Remove the key
        </LabButton>
      </LabActions>
    </LabSection>
  )
}

function KvReader({ name }: { name: string }) {
  const [count] = useKv(COUNTER_KEY, 0)
  return (
    <LabRow
      label={`useKv in ${name}`}
      value={<span data-testid={`kv-${name.toLowerCase()}`}>{count}</span>}
    />
  )
}

/** Writes through its own hook, so the readers above can only learn of it by following the key. */
function KvIncrementButton() {
  const [count, setCount] = useKv(COUNTER_KEY, 0)
  return (
    <LabButton onClick={() => setCount(count + 1)}>
      Increment from A
    </LabButton>
  )
}

function StoreSection() {
  const [persistent, setPersistent] = useState<boolean | null>(null)
  const [largeReadBack, setLargeReadBack] = useState<string | null>(null)

  const refreshPersistent = useCallback(() => {
    void store.isPersistent().then(setPersistent)
  }, [])

  useEffect(() => {
    refreshPersistent()
    return subscribeStore(NOTE_KEY, refreshPersistent)
  }, [refreshPersistent])

  async function writeLarge() {
    setLargeReadBack("writing…")
    //set resolves once the transaction has committed or been refused, so the
    //read below answers what a caller would actually get back afterwards
    await store.set(LARGE_KEY, randomBytes(LARGE_BYTES))
    const back = await store.get<Uint8Array>(LARGE_KEY)
    setLargeReadBack(back ? `${back.byteLength} bytes` : "absent")
    setPersistent(await store.isPersistent())
  }

  async function readLarge() {
    const back = await store.get<Uint8Array>(LARGE_KEY)
    setLargeReadBack(back ? `${back.byteLength} bytes` : "absent")
    setPersistent(await store.isPersistent())
  }

  return (
    <LabSection
      title="store — asynchronous, structured"
      description="Two components on one key. Values go in by structured clone, so a Date comes back a Date, not a string."
    >
      <StoreReader name="A" />
      <StoreReader name="B" />
      <LabActions>
        <StoreWriteButton />
        <LabButton
          onClick={() =>
            void store.set<Note>(NOTE_KEY, {
              count: 100,
              savedAt: new Date(),
            })
          }
        >
          store.set 100 outside React
        </LabButton>
        <LabButton
          tone="danger"
          onClick={() => void store.remove(NOTE_KEY)}
        >
          Remove the key
        </LabButton>
      </LabActions>
      <LabRow
        label="persistent"
        value={
          <span data-testid="store-persistent">
            {persistent === null ? "checking…" : persistent ? "yes" : "no"}
          </span>
        }
        hint="No means something is held only in memory: no IndexedDB here, or a write it refused. A refused value stays readable for the session and is gone after a reload."
      />
      <LabActions>
        <LabButton onClick={() => void writeLarge()}>
          Write 1 MB of random bytes
        </LabButton>
        <LabButton onClick={() => void readLarge()}>
          Read it back
        </LabButton>
      </LabActions>
      <LabRow
        label="large value read back"
        value={
          <span data-testid="store-large">
            {largeReadBack ?? "not read yet"}
          </span>
        }
      />
    </LabSection>
  )
}

function StoreReader({ name }: { name: string }) {
  const { data, isLoading } = useStore<Note>(NOTE_KEY)
  const id = name.toLowerCase()
  return (
    <>
      <LabRow
        label={`useStore in ${name}`}
        value={
          <span data-testid={`store-${id}`}>
            {isLoading ? "loading…" : data ? data.count : "absent"}
          </span>
        }
      />
      <LabRow
        label={`Date survived in ${name}`}
        value={
          <span data-testid={`store-${id}-date`}>
            {data ? (data.savedAt instanceof Date ? "yes" : "no") : "—"}
          </span>
        }
      />
    </>
  )
}

/** Writes through its own hook, so the readers above can only learn of it by following the key. */
function StoreWriteButton() {
  const { data, set } = useStore<Note>(NOTE_KEY)
  return (
    <LabButton
      onClick={() =>
        void set({ count: (data?.count ?? 0) + 1, savedAt: new Date() })
      }
    >
      Write from A
    </LabButton>
  )
}

const isHardwareBackedOnServer = false

function SecureSection() {
  const hardwareBacked = useClientValue(
    () => secure.isHardwareBacked(),
    isHardwareBackedOnServer,
  )
  const [draft, setDraft] = useState("lab-token-123")
  const [readBack, setReadBack] = useState<string | null>(null)
  const [raw, setRaw] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)

  const refreshRaw = useCallback(() => {
    setRaw(readLocalStorage(SECURE_PREFIX + SECRET_KEY))
  }, [])

  useEffect(() => refreshRaw(), [refreshRaw])

  async function run(label: string, action: () => Promise<void>) {
    try {
      await action()
      setOutcome(label)
    } catch (error) {
      setOutcome(`threw ${describeError(error)}`)
    }
    refreshRaw()
  }

  return (
    <LabSection
      title="secure — secrets"
      description="Strings only, and no hook: nothing should re-render on a secret."
    >
      <LabRow
        label="hardware-backed"
        value={
          <LabBadge tone={hardwareBacked ? "ok" : "warn"}>
            <span data-testid="secure-hardware">
              {hardwareBacked ? "yes" : "no"}
            </span>
          </LabBadge>
        }
        hint="No on every browser, always: the web has no store a script on the same origin cannot read."
      />
      <TextInput value={draft} onChange={setDraft} aria-label="Secret" />
      <LabActions>
        <LabButton
          onClick={() =>
            void run("saved", () => secure.set(SECRET_KEY, draft))
          }
        >
          Save
        </LabButton>
        <LabButton
          onClick={() =>
            void run("read", async () => {
              const value = await secure.get(SECRET_KEY)
              setReadBack(value ?? "absent")
            })
          }
        >
          Read
        </LabButton>
        <LabButton
          tone="danger"
          onClick={() =>
            void run("removed", async () => {
              await secure.remove(SECRET_KEY)
              setReadBack(null)
            })
          }
        >
          Remove
        </LabButton>
      </LabActions>
      <LabRow
        label="secure.get"
        value={
          <span data-testid="secure-read">
            {readBack ?? "not read yet"}
          </span>
        }
      />
      <LabRow
        label="plain localStorage"
        value={
          <span data-testid="secure-raw">
            {raw === null ? "nothing" : raw}
          </span>
        }
        hint="Any script on this origin can read this row's value. On a native build it stays empty, because the secret never touches localStorage."
      />
      <LabRow
        label="last outcome"
        value={
          <span data-testid="secure-outcome">
            {outcome ?? "not attempted yet"}
          </span>
        }
        hint="A save the browser refuses must say so. A secret that silently failed to persist logs the user out on the next launch with no explanation."
      />
    </LabSection>
  )
}
