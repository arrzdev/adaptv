import type { PrintOutcome } from "@arrzdev/adaptv/capabilities"
import { usePrint } from "@arrzdev/adaptv/hooks"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import type { LabLogEntry } from "@/components/lab/lab-kit"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabLog,
  LabRow,
  LabSection,
  labLogEntry,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/print")({
  component: LabPrintPage,
})

/**
 * What the printer gets. The lab chrome — header, brief, rows, log — is noise
 * on paper, so under `@media print` everything is hidden and the one block
 * marked `data-print-sheet` is pinned to the page. `visibility` rather than
 * `display`, because a hidden ancestor with `display: none` takes the sheet
 * down with it, while a hidden ancestor with `visibility: hidden` lets a
 * visible descendant show through.
 */
const PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  [data-print-sheet], [data-print-sheet] * { visibility: visible; }
  [data-print-sheet] { position: fixed; inset: 0; padding: 2rem; }
}
`

const OUTCOME_TONE: Record<PrintOutcome, "ok" | "warn" | "bad"> = {
  opened: "ok",
  silent: "warn",
  unsupported: "bad",
  failed: "bad",
}

function LabPrintPage() {
  const { status, printing, last, print } = usePrint()
  const [log, setLog] = useState<LabLogEntry[]>([])

  const append = (text: string) =>
    setLog((entries) => [labLogEntry(text), ...entries].slice(0, 40))

  async function handlePrint() {
    append("print() called")
    const outcome = await print()
    append(`outcome → ${outcome}`)
  }

  //The measurement behind the native verdicts: call the engine's own
  //window.print() with nothing in between and log what followed within 1.5 s.
  function handleRaw() {
    const seen: string[] = []
    const t0 = performance.now()
    const mark = (name: string) => () =>
      seen.push(`${name} @${Math.round(performance.now() - t0)}ms`)
    const onBefore = mark("beforeprint")
    const onAfter = mark("afterprint")
    window.addEventListener("beforeprint", onBefore)
    window.addEventListener("afterprint", onAfter)
    append(`raw window.print() called (typeof ${typeof window.print})`)
    try {
      window.print()
    } catch (error) {
      seen.push(`threw ${String(error)}`)
    }
    setTimeout(() => {
      window.removeEventListener("beforeprint", onBefore)
      window.removeEventListener("afterprint", onAfter)
      append(
        `raw → ${seen.length ? seen.join(", ") : "nothing within 1500ms"}`,
      )
    }, 1500)
  }

  return (
    <LabPage
      title="Print"
      subtitle="One mechanism on every target — window.print() — and an outcome that says whether anything answered it."
    >
      <style>{PRINT_CSS}</style>

      <LabBrief
        what="Whether window.print() opens a print dialog here, and that the outcome names the silence where it does not — a print button that does nothing is the failure this capability exists to surface."
        steps={[
          "Read the status row. `available` means window.print exists and this is an engine that answers it; `unsupported` is the native WebView answer and nothing else on this page can pass there.",
          "Press “Print this page”. `printing` must read true while the call is in flight.",
          "Where a dialog opens, cancel it. The last outcome must read `opened` — the web cannot tell a print from a dismissal, and the page does not pretend to.",
          "Press it again and actually print (to PDF is fine). The preview must show only the printable block below, not the lab chrome.",
          "Where nothing opens, wait 1.5 s. The outcome must read `silent`, and the log must carry one line for the call and one for the outcome.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Every desktop and mobile browser opens its print dialog; beforeprint fires as it opens, afterprint as it closes, so the outcome is `opened` whether you printed or cancelled. Headless Chromium fires both synchronously with no dialog; headless WebKit fires nothing and reads `silent`.",
          },
          pwa: {
            verdict: "works",
            note: "Same call as the browser it was installed from. Measured on the iOS 26 simulator: Safari standalone opens the OS print sheet, and its preview shows only the printable block.",
          },
          ios: {
            verdict: "absent",
            note: "WKWebView swallows window.print: the call returns, no dialog, no event. The status row reads `unsupported` up front and the button is not called.",
          },
          android: {
            verdict: "absent",
            note: "Measured on the API 36 WebView: window.print is a function, the call returns at once, nothing follows and no print activity comes to the front. There is no PrintManager wiring unless the host app adds one. Reads `unsupported` up front.",
          },
        }}
        wrong="The status reads `available`, the button is pressed, and the outcome reads `silent` on a browser that plainly has a print dialog — the events are not being heard. Or `printing` stays true after the outcome is in, which means the in-flight promise never settled and a second press is now a no-op."
      />

      <LabSection title="Status">
        <LabRow
          label="status"
          testId="print-status"
          value={
            <LabBadge tone={status === "available" ? "ok" : "bad"}>
              {status}
            </LabBadge>
          }
          hint="Read on the client; the server always says unsupported, so a button can hide itself where nothing would answer it."
        />
      </LabSection>

      <LabSection
        title="Open the dialog"
        description="The outcome is what the engine actually did: `opened` when afterprint came back, `silent` when the call returned and nothing followed within 1.5 s."
      >
        <LabActions>
          <LabButton
            testId="print-open"
            disabled={printing}
            onClick={() => void handlePrint()}
          >
            Print this page
          </LabButton>
          <LabButton testId="print-raw" onClick={handleRaw}>
            Raw window.print()
          </LabButton>
        </LabActions>
        <LabRow
          label="printing"
          testId="print-printing"
          value={String(printing)}
        />
        <LabRow
          label="last outcome"
          testId="print-last"
          value={
            last === null ? (
              "—"
            ) : (
              <LabBadge tone={OUTCOME_TONE[last]}>{last}</LabBadge>
            )
          }
          hint="`silent` and `unsupported` are ordinary values — the accessor never rejects for either."
        />
      </LabSection>

      <LabSection
        title="What the printer gets"
        description="Only this block survives the print stylesheet, so a real preview shows something meaningful rather than the lab."
      >
        <div
          data-print-sheet=""
          className="flex flex-col gap-y-1 rounded-md bg-secondary px-3 py-2"
        >
          <h3 className="text-base font-semibold text-foreground">
            adaptv print sheet
          </h3>
          <p className="text-sm text-foreground">
            One codebase, six targets, one window.print().
          </p>
          <p className="text-sm text-muted">
            If you are reading this on paper, the dialog opened.
          </p>
        </div>
      </LabSection>

      <LabSection title="Events">
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}
