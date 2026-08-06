import type { WheelItem } from "@arrzdev/adaptv/components"
import { WHEEL_ITEM_HEIGHT, WheelColumn } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { useMemo, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import { LabRow, LabSection } from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/wheel-column")({
  component: LabWheelColumnPage,
})

const WHEEL_ITEM_CLASS = "text-muted data-[active=true]:text-foreground"

function LabWheelColumnPage() {
  const [hour, setHour] = useState(9)
  const [minute, setMinute] = useState(30)
  const [commits, setCommits] = useState(0)

  const hours = useMemo<WheelItem[]>(
    () =>
      Array.from({ length: 24 }, (_, value) => ({
        value,
        label: String(value).padStart(2, "0"),
      })),
    [],
  )

  const minutes = useMemo<WheelItem[]>(
    () =>
      Array.from({ length: 60 }, (_, value) => ({
        value,
        label: String(value).padStart(2, "0"),
      })),
    [],
  )

  return (
    <LabPage
      title="WheelColumn"
      subtitle="The iOS picker drum, rebuilt in the browser: free momentum, a real cylindrical projection, a live value while it spins, and a settle-snap once it stops."
    >
      <LabBrief
        what="That the wheel spins freely with momentum, reports the centred row live rather than only on release, settle-snaps to a whole row, and can be driven by a tap on a row."
        steps={[
          "Flick the hour wheel hard. It must keep spinning after your finger leaves and coast to a stop, not stop dead.",
          "Watch the value row below while it coasts: it must update continuously as rows cross the centre, not once at the end.",
          "Let it settle. It must end aligned to a row, never halfway between two.",
          "Tap a row that is two or three positions off centre. It must roll smoothly to the middle, not jump.",
          "Drag slowly and stop with your finger still down, exactly between two rows. On release it must roll to the nearer one.",
          "Scroll the PAGE with a finger that starts on the wheel: a mostly-vertical drag inside the wheel belongs to the wheel, and reaching the wheel's end must not start scrolling the page.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "A mouse wheel and a drag both work, and the projection is correct — but a trackpad's momentum is the OS's, not the drum's, so the feel here says little. Verify the value updates and the snap.",
          },
          pwa: {
            verdict: "works",
            note: "Real touch momentum. This is where the tap-to-centre roll and the settle-snap should read as native.",
          },
          ios: {
            verdict: "works",
            note: "The reference. Note there is deliberately NO CSS scroll-snap: `y mandatory` on iOS truncates a fling to a crawl because the engine aims at the nearest snap point instead of letting the drum spin. If a hard flick barely moves, that is the regression.",
          },
          android: {
            verdict: "works",
            note: "Same. Chromium's fling curve is shorter than WebKit's, so the drum coasts less far — that is the platform, not a bug.",
          },
        }}
        wrong="A hard flick travels only a row or two (CSS scroll-snap has been reintroduced). The value only updates when the wheel stops, so anything reading it live shows a stale number. The wheel settles between two rows. Reaching the top or bottom of the wheel scrolls the page underneath it."
      />

      <LabSection title="Live value">
        <LabRow
          label="hour"
          value={String(hour).padStart(2, "0")}
          hint="Must update continuously while the drum is coasting, not only when it stops."
        />
        <LabRow label="minute" value={String(minute).padStart(2, "0")} />
        <LabRow
          label="onChange calls"
          value={commits}
          hint="High is correct — the wheel reports live. What matters is that it stops climbing the moment the drum stops."
        />
      </LabSection>

      <LabSection
        title="Two columns"
        description="One column per component; compose several at the call site. The centred band behind them is the app's, not the primitive's — WheelColumn ships a neutral baseline and hands you `data-active` to paint with."
      >
        <div className="relative flex items-stretch">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 z-0 -translate-y-1/2 rounded bg-secondary"
            style={{ height: WHEEL_ITEM_HEIGHT }}
          />
          <WheelColumn
            items={hours}
            value={hour}
            onChange={(next) => {
              setCommits((n) => n + 1)
              setHour(next)
            }}
            ariaLabel="Hour"
            className="relative z-10 flex-1"
            itemClassName={WHEEL_ITEM_CLASS}
          />
          <WheelColumn
            items={minutes}
            value={minute}
            onChange={(next) => {
              setCommits((n) => n + 1)
              setMinute(next)
            }}
            ariaLabel="Minute"
            className="relative z-10 flex-1"
            itemClassName={WHEEL_ITEM_CLASS}
          />
        </div>
        <LabRow
          label="WHEEL_ITEM_HEIGHT"
          value={`${WHEEL_ITEM_HEIGHT}px`}
          hint="Exported because the highlight band behind the wheel has to be exactly one row tall, and a hardcoded number would drift."
        />
      </LabSection>
    </LabPage>
  )
}
