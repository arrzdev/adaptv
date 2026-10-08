import type { UiThemePreference } from "adaptv/hooks"
import {
  adaptvBack,
  createBootstrapGate,
  useMediaQuery,
  useReducedMotion,
  useStatusBar,
  useTheme,
  useVibrate,
} from "adaptv/hooks"
import { createFileRoute } from "adaptv/router"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabRow,
  LabSection,
  useClientValue,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/hooks")({
  component: LabHooksPage,
})

const QUERIES = [
  "(display-mode: standalone)",
  "(pointer: coarse)",
  "(orientation: portrait)",
  "(prefers-color-scheme: dark)",
  "(min-width: 768px)",
]

const PREFERENCES: UiThemePreference[] = ["light", "dark", "system"]

//a gate is a plain object, not a hook — created once at module scope, the same
//way an app creates its real one
const DEMO_GATE = createBootstrapGate()

function LabHooksPage() {
  const theme = useTheme()
  const reduceMotion = useReducedMotion()
  const vibrate = useVibrate()
  //the raw answer is what this row is for, so it is read after hydration, not
  //during it — see useClientValue
  const canVibrate = useClientValue(vibrate.canVibrate, false)
  const gateReady = DEMO_GATE.useBootstrapReady()

  //useStatusBar is wiring, not a value: it syncs the native bars to the theme
  //and returns nothing. Mounted here so the page exercises it.
  useStatusBar(theme.resolved)

  return (
    <LabPage
      title="Standalone hooks"
      subtitle="The exported hooks with no capability of their own — media queries, motion preference, theme, vibration, the bootstrap gate."
    >
      <LabBrief
        what="The hooks with no capability behind them: media queries, motion preference, theme, vibration, and the bootstrap gate that holds the app at boot."
        steps={[
          "Pick Dark, then Light, and confirm the whole app changes appearance, not just this page. Pick System and flip the OS appearance: the app must follow live.",
          "Read the media-query rows and compare them with the target badge at the top. (display-mode: standalone) reading FALSE inside a native build is correct and is why isInstalledApp() exists.",
          "Turn on Reduce Motion in the OS accessibility settings, come back, and check the useReducedMotion row — it must flip live, with no reload.",
          "Press each vibrate button on a real device.",
          "Press setBootstrapReady() then resetBootstrapReady() and watch the row flip. In the real app this gate is what holds the splash up.",
          "Press adaptvBack() — it must pop history, or on native with nothing to pop, exit the app.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Everything except vibration on desktop. Reduced motion follows the OS immediately in every modern browser.",
          },
          pwa: {
            verdict: "works",
            note: "Same, and (display-mode: standalone) is the one row that should differ from the browser tab — it must read true here.",
          },
          ios: {
            verdict: "partial",
            note: "Everything, and the interesting row is (display-mode: standalone): it reads FALSE inside a Capacitor WebView even though the app is obviously installed. Nothing in adaptv keys off it for that reason.",
          },
          android: {
            verdict: "partial",
            note: "Everything. Same standalone caveat.",
          },
        }}
        wrong="The theme changes this page but not the rest of the app, or System stops following the OS. A media query row that never updates when the condition changes — that is a dead subscription, and every layout keyed on it will be stale. Or adaptvBack() exiting the app when there was history left to pop."
      />

      <LabSection title="useTheme()">
        <LabRow
          label="preference"
          value={<LabBadge tone="muted">{theme.preference}</LabBadge>}
        />
        <LabRow
          label="resolved"
          value={<LabBadge tone="muted">{theme.resolved}</LabBadge>}
        />
        <LabActions>
          {PREFERENCES.map((preference) => (
            <LabButton
              key={preference}
              onClick={() => theme.setPreference(preference)}
            >
              {preference}
            </LabButton>
          ))}
        </LabActions>
        <p className="text-xs text-muted">
          <code>useStatusBar(theme.resolved)</code> is mounted on this page
          — on a native build the system bar icons follow it.
        </p>
      </LabSection>

      <LabSection title="useMediaQuery(query)">
        {QUERIES.map((query) => (
          <MediaQueryRow key={query} query={query} />
        ))}
        <p className="text-xs text-muted">
          Note <code>(display-mode: standalone)</code> reads false inside a
          Capacitor WebView — that is exactly why{" "}
          <code>isInstalledApp()</code> exists and why nothing in adaptv
          keys off the media query directly.
        </p>
      </LabSection>

      <LabSection title="useReducedMotion()">
        <LabRow
          label="prefers-reduced-motion"
          value={
            <LabBadge tone={reduceMotion ? "warn" : "muted"}>
              {String(reduceMotion)}
            </LabBadge>
          }
        />
      </LabSection>

      <LabSection
        title="useVibrate()"
        description="The semantic layer over the haptics capability — the same iOS-web no-op applies."
      >
        <LabRow
          label="canVibrate()"
          value={
            <LabBadge tone={canVibrate ? "ok" : "bad"}>
              {String(canVibrate)}
            </LabBadge>
          }
        />
        <LabActions>
          <LabButton onClick={vibrate.vibrateOk}>ok</LabButton>
          <LabButton onClick={vibrate.vibrateSuccess}>success</LabButton>
          <LabButton onClick={vibrate.vibrateCancel}>cancel</LabButton>
          <LabButton onClick={vibrate.vibrateSelection}>
            selection
          </LabButton>
          <LabButton onClick={vibrate.vibrateImpact}>impact</LabButton>
          <LabButton onClick={vibrate.vibrateWarning}>warning</LabButton>
          <LabButton onClick={vibrate.vibrateError}>error</LabButton>
        </LabActions>
      </LabSection>

      <LabSection
        title="createBootstrapGate()"
        description="Holds the app at boot until the thing it is waiting for is ready — a store, a session. Not a hook itself; it hands one out."
      >
        <LabRow
          label="useBootstrapReady()"
          value={
            <LabBadge tone={gateReady ? "ok" : "warn"}>
              {String(gateReady)}
            </LabBadge>
          }
          hint="false during SSR and until something calls setBootstrapReady() — which is what holds the splash overlay up."
        />
        <LabActions>
          <LabButton
            disabled={gateReady}
            onClick={DEMO_GATE.setBootstrapReady}
          >
            setBootstrapReady()
          </LabButton>
          <LabButton
            disabled={!gateReady}
            onClick={DEMO_GATE.resetBootstrapReady}
          >
            resetBootstrapReady()
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection
        title="adaptvBack()"
        description="The floor of the back chain — pop history if there is any, else exit the app on native. useAndroidBackButton() installs the platform listener that calls it."
      >
        <LabActions>
          <LabButton onClick={() => adaptvBack()}>adaptvBack()</LabButton>
        </LabActions>
      </LabSection>
    </LabPage>
  )
}

function MediaQueryRow({ query }: { query: string }) {
  const matches = useMediaQuery(query)
  return (
    <LabRow
      label={query}
      value={
        <LabBadge tone={matches ? "ok" : "muted"}>
          {String(matches)}
        </LabBadge>
      }
    />
  )
}
