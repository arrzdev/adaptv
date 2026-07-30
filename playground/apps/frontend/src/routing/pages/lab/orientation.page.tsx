import type { ScreenOrientationLock } from "@arrzdev/adaptv/capabilities"
import { useOrientation } from "@arrzdev/adaptv/hooks"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabButton,
  LabCaveat,
  LabOutcome,
  LabRow,
  LabSection,
  LabSupport,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute({
  component: LabOrientationPage,
})

const LOCKS: ScreenOrientationLock[] = [
  "portrait",
  "portrait-primary",
  "portrait-secondary",
  "landscape",
  "landscape-primary",
  "landscape-secondary",
  "natural",
  "any",
]

function LabOrientationPage() {
  const {
    orientation,
    isPortrait,
    lockSupported,
    lock,
    unlock,
    lastOutcome,
  } = useOrientation()

  return (
    <LabPage
      title="Orientation"
      subtitle="Reading works on every target. Locking works on almost none — rotate the device and watch the read update while the lock stays refused."
    >
      <LabBrief
        what="That orientation can always be READ, that locking it is refused nearly everywhere, and that a resolved lock is still not a promise the device will obey."
        steps={[
          "Rotate the device. The orientation row must change immediately, on every target.",
          "Read the lock-support badge before pressing anything — it tells you which of the two outcomes below to expect.",
          "Press `landscape`. If lock is supported, the device must actually turn; if not, the outcome must read `unsupported`, not throw.",
          "Press `portrait`, then rotate the device physically. If the lock took, the screen must refuse to rotate.",
          "Press `unlock` and rotate again — it must rotate freely.",
          "Whatever the outcome badge says, trust the READ row above it: that is the device's actual state.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Read always works. Lock: WebKit has never shipped screen.orientation.lock(), so every iOS browser reads unsupported. Chromium HAS it but refuses outside fullscreen/standalone, which comes back as `rejected` — a different answer from `unsupported`, and the distinction matters.",
          },
          pwa: {
            verdict: "partial",
            note: "On Android, standalone display mode is exactly the condition Chromium wanted, so lock starts working here and nowhere else on the web. On an installed iOS PWA it is still unsupported, and OrientationGuard is the honest fallback.",
          },
          ios: {
            verdict: "works",
            note: "The plugin locks for real. Note the app's own manifest already locks to portrait, so a successful landscape lock here is fighting the app's configuration — expect the guard to be involved.",
          },
          android: {
            verdict: "partial",
            note: "Locks for real on a phone. On Android 16+ with targetSdk 36 the OS IGNORES orientation locks on large screens: the plugin resolves `ok` and the tablet keeps rotating. That is the caveat the outcome badge cannot express.",
          },
        }}
        wrong="The orientation row does not change when you rotate — the subscription is dead, and anything driven by it (including the rotate guard) will be too. Or a refused lock throws instead of returning `rejected`/`unsupported`, which forces every caller into a try/catch for a normal answer."
      />

      <LabSection title="Read (always available)">
        <LabRow label="orientation" value={orientation} />
        <LabRow label="isPortrait" value={String(isPortrait)} />
      </LabSection>

      <LabSection title="Lock support">
        <LabSupport
          supported={lockSupported}
          supportedLabel="Lock can be attempted"
          unsupportedLabel="No lock API here"
          detail="WebKit has never shipped screen.orientation.lock(), so every iOS browser and every iOS installed PWA lands here. That gap is why OrientationGuard exists."
        />
        {!lockSupported && (
          <p className="text-xs text-muted">
            The honest fallback on this target is a rotate prompt —
            adaptv&apos;s <code>OrientationGuard</code>, driven by the web
            app manifest&apos;s <code>orientation</code> field.
          </p>
        )}
      </LabSection>

      <LabSection
        title="Try every lock value"
        description="Chromium has lock() but refuses outside fullscreen/standalone — that is `rejected`, and it is a different answer from `unsupported`."
      >
        <LabActions>
          {LOCKS.map((value) => (
            <LabButton key={value} onClick={() => void lock(value)}>
              {value}
            </LabButton>
          ))}
        </LabActions>
        <LabActions>
          <LabButton tone="danger" onClick={() => void unlock()}>
            unlock
          </LabButton>
        </LabActions>
        <LabRow
          label="last outcome"
          value={<LabOutcome outcome={lastOutcome} okValues={["ok"]} />}
        />
        <LabCaveat>
          An `ok` here is not a promise. On Android 16+ with targetSdk 36
          the OS ignores orientation locks on large screens: the plugin
          resolves and the tablet keeps rotating. Watch the read above
          rather than trusting the outcome.
        </LabCaveat>
      </LabSection>
    </LabPage>
  )
}
