import { useMotion } from "adaptv/hooks"
import { createFileRoute } from "adaptv/router"
import { useEffect, useRef, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabBadge,
  LabButton,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/motion")({
  component: LabMotionPage,
})

const TONE = {
  granted: "ok",
  prompt: "warn",
  denied: "bad",
  unsupported: "bad",
} as const

function fmt(n: number | undefined | null): string {
  return n === undefined || n === null ? "—" : n.toFixed(2)
}

function LabMotionPage() {
  const { status, sample, silent, request } = useMotion({
    throttleMs: 100,
  })
  const [count, setCount] = useState(0)
  const [secure, setSecure] = useState<boolean | null>(null)
  const seen = useRef<number | null>(null)

  useEffect(() => {
    setSecure(window.isSecureContext)
  }, [])

  useEffect(() => {
    if (sample && sample.at !== seen.current) {
      seen.current = sample.at
      setCount((c) => c + 1)
    }
  }, [sample])

  return (
    <LabPage
      title="Motion"
      subtitle="The accelerometer and gyroscope through devicemotion, with the permission step and the no-sensor case named."
    >
      <LabBrief
        what="Whether this document can read motion at all, whether the engine has to ask first, and that a page with the API and no sensor says so instead of waiting forever."
        steps={[
          "Read the status row. `prompt` means the engine will ask; press Ask from this button, because the request only works from a gesture.",
          "Once granted, move the device. The gravity row must track the tilt and the count must climb.",
          "Hold the device still on a table: gravity z reads about 9.8 and the others near 0.",
          "On a desktop or a simulator the status is granted and nothing arrives; the silent badge must appear within two seconds.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Chromium has the API on a secure origin (localhost or https) and fires one all-null event on a machine with no sensor, which the page reports as silent. Safari on a Mac has no DeviceMotionEvent at all.",
          },
          pwa: {
            verdict: "works",
            note: "iOS WebKit asks through DeviceMotionEvent.requestPermission from a tap; Android Chrome is granted from the start.",
          },
          ios: {
            verdict: "works",
            note: "The WebView asks the same way the PWA does. The simulator has no accelerometer, so after granting, silent.",
          },
          android: {
            verdict: "works",
            note: "Granted from the start. On the emulator, adb emu sensor set acceleration x:y:z is the oracle for the gravity row.",
          },
        }}
        wrong="Granted with a count that never moves on a real device, a sample built from an all-null event, or a dev page on a LAN address that claims support it cannot have."
      />

      <LabSection title="Permission">
        <LabRow
          label="status"
          value={
            <LabBadge tone={TONE[status]}>
              <output data-testid="motion-status">{status}</output>
            </LabBadge>
          }
        />
        <LabRow
          label="secure context"
          value={
            <output data-testid="motion-secure">
              {secure === null ? "—" : String(secure)}
            </output>
          }
          hint="DeviceMotionEvent only exists on a secure origin: localhost, https, or a native WebView. A LAN address over http has none."
        />
        <LabButton onClick={() => void request()}>Ask</LabButton>
      </LabSection>

      <LabSection title="Samples">
        <LabRow
          label="silent"
          value={
            <output data-testid="motion-silent">{String(silent)}</output>
          }
          hint="Granted and subscribed, and no usable sample within 1.5 s."
        />
        <LabRow
          label="gravity x / y / z"
          value={
            <output data-testid="motion-gravity">
              {`${fmt(sample?.gravity?.x)} / ${fmt(sample?.gravity?.y)} / ${fmt(sample?.gravity?.z)}`}
            </output>
          }
        />
        <LabRow
          label="rotation α / β / γ"
          value={
            <output data-testid="motion-rotation">
              {`${fmt(sample?.rotation?.alpha)} / ${fmt(sample?.rotation?.beta)} / ${fmt(sample?.rotation?.gamma)}`}
            </output>
          }
        />
        <LabRow
          label="samples"
          value={<output data-testid="motion-count">{count}</output>}
        />
      </LabSection>
    </LabPage>
  )
}
