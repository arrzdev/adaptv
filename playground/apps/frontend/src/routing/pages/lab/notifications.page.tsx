import type {
  NotifyOutcome,
  NotifyPermission,
  ScheduleOutcome,
} from "@arrzdev/adaptv/capabilities"
import {
  useNotificationOpened,
  useNotifications,
} from "@arrzdev/adaptv/hooks"
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

export const Route = createFileRoute("/_providers/lab/notifications")({
  component: LabNotificationsPage,
})

const SCHEDULE_DELAY_MS = 15_000

function PermissionBadge({ value }: { value: NotifyPermission | null }) {
  const tone =
    value === "granted"
      ? "ok"
      : value === "denied" || value === "unavailable"
        ? "warn"
        : "muted"
  return (
    <LabBadge tone={tone}>
      <span data-testid="notify-permission">{value ?? "reading"}</span>
    </LabBadge>
  )
}

function LabNotificationsPage() {
  const {
    permission,
    caveat,
    pending,
    request,
    notify,
    schedule,
    cancel,
  } = useNotifications()
  const [last, setLast] = useState<NotifyOutcome | ScheduleOutcome | null>(
    null,
  )
  const [opened, setOpened] = useState<string | null>(null)
  const [log, setLog] = useState<LabLogEntry[]>([])
  const append = (entry: string) =>
    setLog((entries) => [...entries, labLogEntry(entry)])

  useNotificationOpened(({ id, data }) => {
    const where = data.where ?? "no payload"
    setOpened(`${id} ${where}`)
    append(`opened: ${id} ${where}`)
  })

  async function ask() {
    const state = await request()
    append(`permission: ${state}`)
  }

  async function showNow() {
    const outcome = await notify({
      title: "Two items saved",
      body: "This one was posted by the app itself.",
      id: 4001,
      data: { where: "now" },
    })
    setLast(outcome)
    append(`notify: ${outcome}`)
  }

  async function later() {
    const at = new Date(Date.now() + SCHEDULE_DELAY_MS)
    const outcome = await schedule({
      title: "Fifteen seconds later",
      body: "Scheduled while the app was open; the OS fired it.",
      at,
      id: 4002,
      data: { where: "later" },
    })
    setLast(outcome)
    append(`schedule ${at.toLocaleTimeString()}: ${outcome}`)
  }

  async function drop() {
    await cancel(4002)
    append("cancel 4002")
  }

  return (
    <LabPage
      title="Notifications"
      subtitle="A banner the app asks for itself: now, or at a time the OS keeps for it. Push is a different thing and is not here."
    >
      <LabBrief
        what="That the permission is the four-state answer and not a boolean, that a notification the app shows now arrives on every target that can carry one, that scheduling says plainly where the OS keeps the alarm and where nothing does, and that tapping one hands the app back the payload it was sent with."
        steps={[
          "Press “Ask”. The first press raises the OS prompt; after an answer the row must hold it, and a second press must not raise it again.",
          "Press “Show one now”. On native, send the app to the background first: the banner arrives there.",
          "Press “Schedule in 15 s” on native, then leave the app. The banner must arrive with the app closed, and the pending row must list it until it fires.",
          "On the web, scheduling reads `unsupported`: no browser can fire one later, and a timer in the page would only run while the page is open.",
          "Tap the banner itself, from the shade or the notification centre, with the app in the background. The “last opened” row must name the notification and the payload it carried.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Ask and show work through the page's own service worker. Schedule reads unsupported. In a browser tab on iOS nothing shows at all until the page is installed to the home screen.",
          },
          pwa: {
            verdict: "partial",
            note: "Same as the tab, and on iOS this is the install that makes showing possible at all.",
          },
          ios: {
            verdict: "works",
            note: "The OS prompt, the banner, and the alarm with the app closed. A notification posted while the app is in front shows its banner over the app too, so nothing is withheld and the caveat row reads none.",
          },
          android: {
            verdict: "works",
            note: "The runtime notification permission, the banner, and the scheduled alarm — as an inexact one, so pressing a button never opens the system alarms settings screen. It can arrive a little late while the device dozes.",
          },
        }}
        wrong="A tap on the banner opens the app and the last opened row stays empty, which is a notification nobody can act on. Or a press leaves the app for a system settings screen. Or the row reads granted where nothing can carry a banner. Or schedule reads scheduled on the web, which would be a timer pretending to be an alarm. Or the pending row keeps listing one that already fired."
      />

      <LabSection
        title="Permission"
        description="Four states: granted, denied, prompt, and unavailable — which is not a permission but “asking cannot help”."
      >
        <LabRow
          label="permission"
          value={<PermissionBadge value={permission} />}
        />
        <LabRow
          label="caveat"
          value={
            <span
              data-testid="notify-caveat"
              className="text-xs text-subtle"
            >
              {caveat ?? "none"}
            </span>
          }
        />
        <LabActions>
          <LabButton data-testid="notify-ask" onClick={() => void ask()}>
            Ask
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection
        title="Send"
        description="Now, or fifteen seconds from now if the OS keeps alarms."
      >
        <LabActions>
          <LabButton
            data-testid="notify-now"
            onClick={() => void showNow()}
          >
            Show one now
          </LabButton>
          <LabButton
            data-testid="notify-later"
            onClick={() => void later()}
          >
            Schedule in 15 s
          </LabButton>
          <LabButton
            data-testid="notify-cancel"
            tone="danger"
            onClick={() => void drop()}
          >
            Cancel it
          </LabButton>
        </LabActions>
        <LabRow
          label="last outcome"
          value={
            <LabBadge
              tone={
                last === "shown" || last === "scheduled"
                  ? "ok"
                  : last === null
                    ? "muted"
                    : "warn"
              }
            >
              <span data-testid="notify-last">{last ?? "—"}</span>
            </LabBadge>
          }
        />
        <LabRow
          label="last opened"
          value={
            <LabBadge tone={opened ? "ok" : "muted"}>
              <span data-testid="notify-opened">{opened ?? "—"}</span>
            </LabBadge>
          }
          hint="Fills in when a notification is tapped, with the payload it was sent carrying. On the web this survives a tap that had to start the app."
        />
        <LabRow
          label="pending"
          value={
            <span
              data-testid="notify-pending"
              className="text-xs text-subtle"
            >
              {pending.length === 0
                ? "none"
                : pending
                    .map(
                      (n) =>
                        `${n.id} ${n.at?.toLocaleTimeString() ?? "now"}`,
                    )
                    .join(", ")}
            </span>
          }
          hint="What is still to come. Always none on the web, and never one that already fired."
        />
      </LabSection>

      <LabSection title="Log">
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}
