import {
  deleteFile,
  getFilesystemSupport,
  listFiles,
  readFile,
  readTextFile,
  statFile,
  writeFile,
} from "@arrzdev/adaptv/capabilities"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabCaveat,
  LabRow,
  LabSection,
  LabSupport,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/filesystem")({
  component: LabFilesystemPage,
})

const NOTE_PATH = "lab/note.txt"

/**
 * Every step of one round trip, on one line, so a device driver reading the
 * screen gets the whole verdict at once. Each field is the status the
 * capability returned — nothing here is interpreted before it is printed.
 */
async function roundTrip(): Promise<string> {
  const text = "hello adaptv"
  const bytes = new Uint8Array(256).map((_, i) => i)
  const parts: string[] = []
  parts.push(`write ${await writeFile("lab/hello.txt", text)}`)
  parts.push(`bytes-write ${await writeFile("lab/bytes.bin", bytes)}`)
  const read = await readTextFile("lab/hello.txt")
  parts.push(
    `read ${read.status}${read.text !== null ? ` ${read.text.length} chars` : ""}`,
  )
  const raw = await readFile("lab/bytes.bin")
  const matching = raw.bytes
    ? Array.from(raw.bytes).filter((b, i) => b === bytes[i]).length
    : 0
  parts.push(`bytes ${matching}/256`)
  const listing = await listFiles("lab")
  parts.push(
    `list ${listing.status}${listing.entries ? ` ${listing.entries.length}` : ""}`,
  )
  const stat = await statFile("lab/hello.txt")
  parts.push(
    `stat ${stat.status}${stat.entry ? ` ${stat.entry.size} bytes` : ""}`,
  )
  parts.push(`delete ${await deleteFile("lab/hello.txt")}`)
  parts.push(`bytes-delete ${await deleteFile("lab/bytes.bin")}`)
  parts.push(`after ${(await readFile("lab/hello.txt")).status}`)
  return parts.join(" · ")
}

function LabFilesystemPage() {
  const [support, setSupport] = useState(() => ({
    supported: false,
    backend: null as "native" | "opfs" | null,
    caveat: null as string | null,
  }))
  const [readout, setReadout] = useState("not run yet")
  const [note, setNote] = useState("not read yet")
  const [running, setRunning] = useState(false)

  //the answer depends on the runtime and needs one await (the web tier opens
  //its root to find out), so it is read after hydration
  useEffect(() => {
    let live = true
    void getFilesystemSupport().then((next) => {
      if (live) setSupport(next)
    })
    return () => {
      live = false
    }
  }, [])

  const run = async () => {
    setRunning(true)
    try {
      setReadout(await roundTrip())
    } finally {
      setRunning(false)
    }
  }

  const writeNote = async () => {
    const stamp = new Date().toISOString()
    const outcome = await writeFile(NOTE_PATH, stamp)
    setNote(`${outcome} ${stamp}`)
  }

  const readNote = async () => {
    const read = await readTextFile(NOTE_PATH)
    setNote(`${read.status}${read.text ? ` ${read.text}` : ""}`)
  }

  return (
    <LabPage
      title="Filesystem"
      subtitle="Files the app owns: the native container through the plugin, the origin-private file system on the web."
    >
      <LabBrief
        what="Whether this target can hold files at all, and whether a write, a read, a listing, a stat and a delete all answer with the status they claim."
        steps={[
          "Read the support row. The backend names which implementation answers here; unsupported comes with the reason.",
          "Run the round trip. Every field on the readout must be the good status: written, ok, 256/256, a listing of 2, deleted, and missing afterwards.",
          "Write the note, cold-launch the app (offline too, on an installed target), read the note. The stamp must come back.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "OPFS: navigator.storage.getDirectory() plus FileSystemFileHandle.createWritable(). Chromium round-trips; the WebKit row is measured, not assumed.",
          },
          pwa: {
            verdict: "works",
            note: "Same origin, same OPFS, so the note written in the tab is readable in the installed app and survives a cold launch with the origin down.",
          },
          ios: {
            verdict: "works",
            note: "@capacitor/filesystem in the app's own container. Data persists across launches; Cache may be evicted by the OS.",
          },
          android: {
            verdict: "works",
            note: "Same plugin, the app's files directory. Bytes cross the bridge as base64 both ways.",
          },
        }}
        wrong="A readout with failed in it, a byte count under 256, or a note that does not come back after a cold launch."
      />

      <LabSection title="Support">
        <LabSupport
          supported={support.supported}
          supportedLabel={`Files available · ${support.backend ?? "?"}`}
          unsupportedLabel="No file system on this target"
          detail="Native needs the plugin in the binary; the web needs an origin-private file system with a writable."
        />
        <LabRow
          label="backend"
          value={
            <LabBadge tone={support.backend ? "ok" : "muted"}>
              <span data-testid="fs-backend">
                {support.backend ?? "none"}
              </span>
            </LabBadge>
          }
        />
        {support.caveat && (
          <LabCaveat>
            <span data-testid="fs-caveat">{support.caveat}</span>
          </LabCaveat>
        )}
      </LabSection>

      <LabSection
        title="Round trip"
        description="Write text and 256 bytes, read both back, list the directory, stat, delete, and read again."
      >
        <LabActions>
          <LabButton onClick={() => void run()} disabled={running}>
            Run round trip
          </LabButton>
        </LabActions>
        <LabRow
          label="readout"
          value={
            <output
              data-testid="fs-readout"
              className="break-words font-mono text-xs"
            >
              {readout}
            </output>
          }
        />
      </LabSection>

      <LabSection
        title="Persistence"
        description="A note that should outlive the process — write it, cold-launch, read it."
      >
        <LabActions>
          <LabButton onClick={() => void writeNote()}>
            Write the note
          </LabButton>
          <LabButton onClick={() => void readNote()}>
            Read the note
          </LabButton>
        </LabActions>
        <LabRow
          label="note"
          value={
            <output
              data-testid="fs-note"
              className="break-words font-mono text-xs"
            >
              {note}
            </output>
          }
        />
      </LabSection>
    </LabPage>
  )
}
