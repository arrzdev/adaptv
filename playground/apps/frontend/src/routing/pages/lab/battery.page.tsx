import type { BatteryState } from "adaptv/capabilities"
import {
  getBatteryState,
  readBattery,
  subscribeBattery,
} from "adaptv/capabilities"
import { useBattery } from "adaptv/hooks"
import { createFileRoute } from "adaptv/router"
import { useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import type { LabLogEntry } from "@/components/lab/lab-kit"
import {
  LabBadge,
  LabButton,
  LabLog,
  LabRow,
  LabSection,
  labLogEntry,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/battery")({
  component: LabBatteryPage,
})

function describe(state: BatteryState): string {
  return `${state.status} · level ${state.level === null ? "—" : `${Math.round(state.level * 100)}%`} · charging ${state.charging === null ? "—" : String(state.charging)}`
}

function LabBatteryPage() {
  const battery = useBattery()
  const [log, setLog] = useState<LabLogEntry[]>([])

  useEffect(() => {
    //the same pair the hook uses, logged so a change is visible as an event
    return subscribeBattery(() => {
      setLog((entries) =>
        [labLogEntry(describe(getBatteryState())), ...entries].slice(
          0,
          40,
        ),
      )
    })
  }, [])

  const tone =
    battery.status === "ok"
      ? "ok"
      : battery.status === "unknown"
        ? "warn"
        : "bad"

  return (
    <LabPage
      title="Battery"
      subtitle="Level and charging state, with an honest unknown for a platform that has the API and no number."
    >
      <LabBrief
        what="Whether this target can report its battery at all, what it reports, and that a change reaches the page without a reload."
        steps={[
          "Read the status row. `ok` carries a level and a charging flag; `unknown` means the platform has the API and gave no number; `unsupported` means there is no API here.",
          "Plug or unplug the device. On the web the charging row must flip on the event; on native press “Read now” or background and resume the app.",
          "On an emulator, set a fake level and confirm the number the page shows is the one you set.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Chromium ships navigator.getBattery with levelchange and chargingchange events. Safari and Firefox do not, and read unsupported rather than guessing.",
          },
          pwa: {
            verdict: "partial",
            note: "Same as the browser it was installed from: real numbers on Android Chrome, unsupported on iOS.",
          },
          ios: {
            verdict: "works",
            note: "UIDevice through the device plugin, re-read on resume and once a minute. The simulator has no battery and answers -1, which the page shows as unknown.",
          },
          android: {
            verdict: "works",
            note: "BatteryManager through the device plugin, same re-read policy. adb shell dumpsys battery set level N is the oracle.",
          },
        }}
        wrong="A level outside 0 to 1, a -1 shown as a number, or a page that never moves after a plug or unplug on Chromium."
      />

      <LabSection title="Snapshot">
        <LabRow
          label="status"
          value={
            <LabBadge tone={tone}>
              <output data-testid="battery-status">
                {battery.status}
              </output>
            </LabBadge>
          }
        />
        <LabRow
          label="level"
          value={
            <output data-testid="battery-level">
              {battery.level === null
                ? "—"
                : `${Math.round(battery.level * 100)}%`}
            </output>
          }
        />
        <LabRow
          label="charging"
          value={
            <output data-testid="battery-charging">
              {battery.charging === null ? "—" : String(battery.charging)}
            </output>
          }
        />
        <LabButton
          onClick={() => {
            void readBattery().then((state) =>
              setLog((entries) =>
                [
                  labLogEntry(`read → ${describe(state)}`),
                  ...entries,
                ].slice(0, 40),
              ),
            )
          }}
        >
          Read now
        </LabButton>
      </LabSection>

      <LabSection title="Events">
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}
