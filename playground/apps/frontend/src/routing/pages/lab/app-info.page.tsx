import { useAppInfo } from "@arrzdev/adaptv/hooks"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { LabBrief } from "@/components/lab/lab-brief"
import { LabBadge, LabRow, LabSection } from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/app-info")({
  component: LabAppInfoPage,
})

function Value({
  testId,
  value,
}: {
  testId: string
  value: string | null
}) {
  if (value)
    return (
      <span data-testid={testId} className="font-mono text-xs">
        {value}
      </span>
    )
  return (
    <LabBadge tone="muted">
      <span data-testid={testId}>none</span>
    </LabBadge>
  )
}

function LabAppInfoPage() {
  const { info, caveat } = useAppInfo()

  return (
    <LabPage
      title="App info"
      subtitle="Which build of this app is running: the name, the identity, the store version and the build number — and an explicit none where a target has no such thing."
    >
      <LabBrief
        what="That a settings screen and a bug report can name the running binary on native, and that the web says so plainly instead of printing a number that means something different on every target."
        steps={[
          "Read the four rows. On native all four are real strings, and version and build come from the native project, not from the JavaScript.",
          "In a browser tab or an installed PWA, version and build must read none, and the name and identity must match the app's own manifest.",
          "Read the caveat row. It is empty on native and a sentence on the web, and it is the only place the difference is explained.",
          "Compare version with the OTA page. They answer different questions: this one is the binary, that one is the JavaScript bundle, and a bug report needs both.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Name and identity come from the manifest adaptv serves. Version and build read none: a page has no installed version, and the closest thing to a build number names the JS bundle rather than the app.",
          },
          pwa: {
            verdict: "partial",
            note: "Identical to the tab. Installing a page does not give it a store version.",
          },
          ios: {
            verdict: "works",
            note: "All four, from the binary: the display name, the bundle id, CFBundleShortVersionString and CFBundleVersion.",
          },
          android: {
            verdict: "works",
            note: "All four, from the binary: the label, the application id, versionName and versionCode.",
          },
        }}
        wrong="A version appears on the web, which would be a bundle hash wearing a store version's clothes. Or a native build reads none for all four, which means the app plugin is not registered."
      />

      <LabSection
        title="Identity"
        description="The name and the id are answered on every target; the manifest is the floor even on native."
      >
        <LabRow
          label="name"
          value={
            <Value testId="app-info-name" value={info?.name ?? null} />
          }
        />
        <LabRow
          label="id"
          value={<Value testId="app-info-id" value={info?.id ?? null} />}
        />
      </LabSection>

      <LabSection
        title="Build"
        description="What only an installed binary has. Both read none in a browser, and that is the honest answer rather than a missing one."
      >
        <LabRow
          label="version"
          value={
            <Value
              testId="app-info-version"
              value={info?.version ?? null}
            />
          }
        />
        <LabRow
          label="build"
          value={
            <Value testId="app-info-build" value={info?.build ?? null} />
          }
        />
        <LabRow
          label="caveat"
          value={
            <span
              data-testid="app-info-caveat"
              className="text-xs text-subtle"
            >
              {caveat ?? "none"}
            </span>
          }
        />
      </LabSection>
    </LabPage>
  )
}
