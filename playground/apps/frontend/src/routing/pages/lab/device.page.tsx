import { useDevice } from "@arrzdev/adaptv/hooks"
import {
  getOS,
  isInstalledApp,
  isIOS,
  isNativePlatform,
  isOSVersionAtLeast,
  isStandaloneDisplay,
  resolvePlatformTag,
} from "@arrzdev/adaptv/utils"
import { useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import { LabBadge, LabRow, LabSection } from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute({
  component: LabDevicePage,
})

function LabDevicePage() {
  const { info, id, languageTag, loading } = useDevice()
  //utils/platform is synchronous but still browser-only, so it is read after
  //mount for the same reason the hook is: the server has no navigator
  const [platform, setPlatform] = useState<Record<string, string> | null>(
    null,
  )

  useEffect(() => {
    setPlatform({
      "resolvePlatformTag()": resolvePlatformTag(),
      "getOS()": getOS(),
      "isNativePlatform()": String(isNativePlatform()),
      "isStandaloneDisplay()": String(isStandaloneDisplay()),
      "isInstalledApp()": String(isInstalledApp()),
      "isIOS()": String(isIOS()),
      "isOSVersionAtLeast(18)": String(isOSVersionAtLeast(18)),
    })
  }, [])

  return (
    <LabPage
      title="Device"
      subtitle="Constants for what cannot change, functions for what can — and an explicit null for everything the platform will not say."
    >
      <LabBrief
        what="What each target will and will not tell you about the device — and that the gaps come back as an explicit null rather than an empty string or a guess."
        steps={[
          "Wait for the state row to read `resolved`, then read every row. Anything italic and grey is “this target cannot tell you”, which is a different fact from an empty value.",
          "Compare the platform block at the bottom with the target badge at the top of the page. They must agree.",
          "Change the device or browser language in the OS settings, come back, and reload. getLanguageTag() must follow.",
          "On native, confirm model and manufacturer are real strings — if they are null on a native build, the Device plugin is not registered.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "os, osVersion and the language tag resolve. model, manufacturer, isVirtual, webViewVersion and the device id are all null — no browser reports them, and manufacturing an id would mean fingerprinting the user.",
          },
          pwa: {
            verdict: "partial",
            note: "Identical to the browser tab: installing changes the shell, not the APIs. isStandaloneDisplay() flips to true and isNativePlatform() stays false.",
          },
          ios: {
            verdict: "works",
            note: "Everything populated, including a stable per-install device id. isVirtual reads true on the simulator — a useful sanity check that you are looking at what you think you are.",
          },
          android: {
            verdict: "works",
            note: "Everything populated, plus a real webViewVersion — which is the number that actually decides what CSS and JS this device supports, and is worth writing down.",
          },
        }}
        wrong="A field shows an empty string instead of “not reported here” — that hides the difference between “the OS said nothing” and “the OS said the empty string”, which is the whole point of this page. Or isNativePlatform() disagrees with the target badge, which means the platform stamp was lost and every app:/web: style in the app is now wrong."
      />

      <LabSection
        title="The immutable record"
        description="Memoised: one bridge hop per process, however many components ask."
      >
        <LabRow
          label="state"
          value={
            <LabBadge tone={loading ? "warn" : "ok"}>
              {loading ? "loading" : "resolved"}
            </LabBadge>
          }
        />
        <LabRow label="platform" value={info?.platform ?? null} />
        <LabRow label="os" value={info?.os ?? null} />
        <LabRow label="osVersion" value={info?.osVersion ?? null} />
        <LabRow
          label="model"
          value={info?.model ?? null}
          hint="No browser reports a device model; Chromium on Android is the one partial exception, via high-entropy client hints."
        />
        <LabRow label="manufacturer" value={info?.manufacturer ?? null} />
        <LabRow
          label="isVirtual"
          value={info ? String(info.isVirtual ?? "") : null}
          hint="null means 'this target cannot tell you', which is a different claim from false."
        />
        <LabRow
          label="webViewVersion"
          value={info?.webViewVersion ?? null}
        />
      </LabSection>

      <LabSection
        title="The mutable half"
        description="A function, not a constant — the user can change the locale in Settings and come back."
      >
        <LabRow label="getLanguageTag()" value={languageTag} />
      </LabSection>

      <LabSection title="Identifier">
        <LabRow
          label="getDeviceId()"
          value={id}
          hint="null on web on purpose: a browser has no stable per-install id, and the only way to manufacture one is to fingerprint the user."
        />
      </LabSection>

      <LabSection
        title="utils/platform (the synchronous half)"
        description="This capability delegates to these rather than re-detecting anything — they stay the render-time answer to 'which of the six targets is this'."
      >
        {platform === null ? (
          <p className="text-sm text-muted italic">resolving…</p>
        ) : (
          Object.entries(platform).map(([label, value]) => (
            <LabRow key={label} label={label} value={value} />
          ))
        )}
      </LabSection>
    </LabPage>
  )
}
