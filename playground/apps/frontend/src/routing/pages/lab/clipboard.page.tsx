import { useClipboard } from "@arrzdev/adaptv/hooks"
import { useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabRow,
  LabSection,
  LabSupport,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"
import { TextInput } from "@/components/ui"

export const Route = createFileRoute({
  component: LabClipboardPage,
})

const PERMISSION_TONE = {
  granted: "ok",
  prompt: "warn",
  denied: "bad",
  unavailable: "bad",
} as const

function LabClipboardPage() {
  const {
    canWrite,
    canRead,
    readPermission,
    copy,
    paste,
    text,
    status,
    refreshPermission,
  } = useClipboard()
  const [draft, setDraft] = useState("copied from the adaptv lab")

  return (
    <LabPage
      title="Clipboard"
      subtitle="Read and write are two capabilities, not one. Copying is ungated; pasting is a permission on Chromium and a gesture on WebKit."
    >
      <LabBrief
        what="That copying works everywhere including on an insecure origin, and that pasting reports its permission honestly instead of silently returning nothing."
        steps={[
          "Press Copy, then paste into any other app to confirm the text really left. The button reporting success is not the test — the other app is.",
          "Press “Copy an empty string”. It must not throw; an empty clipboard is a legal clipboard.",
          "Read the read-permission row, then press Paste. If it said `prompt`, the OS must ask; if it said `granted`, the text must appear below.",
          "Press “Re-read permission” after answering the prompt. The badge must change.",
          "If you are on a plain-http LAN URL (the dev server on a phone), check the write row: no navigator.clipboard exists on an insecure origin, and copy must fall through to the legacy path rather than failing.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Copy always works. Paste is a real permission on Chromium (prompt → granted/denied) and a per-gesture allowance on WebKit — Safari may show its own paste button instead of a permission dialog, which is the platform's design.",
          },
          pwa: {
            verdict: "partial",
            note: "Same as the browser it was installed from. An installed app on http (LAN dev) is the case worth checking: an insecure origin has no async clipboard at all.",
          },
          ios: {
            verdict: "works",
            note: "Both directions, through the native plugin — no permission dialog, because the OS grants pasteboard access to the foreground app. Note iOS shows a system “pasted from …” banner, which is the OS, not the app.",
          },
          android: {
            verdict: "works",
            note: "Both directions through the native plugin. Android 13+ shows its own copy confirmation chip; a second in-app toast on top of it is duplication, not a bug in this component.",
          },
        }}
        wrong="Paste resolves with an empty string when it was actually denied — that is the failure the four-state permission exists to prevent, because the app then shows “pasted” having pasted nothing. Or an unsupported target throws instead of returning `unsupported`."
      />

      <LabSection title="Write (copy)">
        <LabSupport
          supported={canWrite}
          supportedLabel="Copy available"
          unsupportedLabel="No copy path here"
          detail="An insecure origin — a plain-http LAN URL on a phone — has no navigator.clipboard at all, and falls back to the legacy execCommand path."
        />
        <TextInput
          value={draft}
          onChange={setDraft}
          aria-label="Text to copy"
        />
        <LabActions>
          <LabButton onClick={() => void copy(draft)}>Copy</LabButton>
          <LabButton onClick={() => void copy("")}>
            Copy an empty string
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection title="Read (paste)">
        <LabSupport
          supported={canRead}
          supportedLabel="Paste available"
          unsupportedLabel="No paste path here"
          detail="There is no legacy fallback for reading — execCommand('paste') was never allowed from script."
        />
        <LabRow
          label="read permission"
          value={
            <LabBadge tone={PERMISSION_TONE[readPermission]}>
              {readPermission}
            </LabBadge>
          }
          hint="Four-state, same shape as geolocation. `unavailable` means prompting is pointless — don't render a paste button at all."
        />
        <LabActions>
          <LabButton onClick={() => void paste()}>Paste</LabButton>
          <LabButton onClick={() => void refreshPermission()}>
            Re-read permission
          </LabButton>
        </LabActions>
        <LabRow label="pasted text" value={text} />
      </LabSection>

      <LabSection title="Last outcome">
        <LabRow
          label="status"
          value={
            status === null ? (
              <LabBadge tone="muted">not attempted yet</LabBadge>
            ) : (
              <LabBadge tone={status === "ok" ? "ok" : "warn"}>
                {status}
              </LabBadge>
            )
          }
          hint="`denied` is retryable from a real gesture; `unsupported` is not. Neither is ever a rejection."
        />
      </LabSection>
    </LabPage>
  )
}
