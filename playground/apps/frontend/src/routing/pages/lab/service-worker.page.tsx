import { useServiceWorkerUpdate } from "adaptv/hooks"
import { createFileRoute } from "adaptv/router"
import { useCallback, useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabCaveat,
  LabRow,
  LabSection,
  LabSupport,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/service-worker")({
  component: LabServiceWorkerPage,
})

/**
 * Everything the browser will tell a PAGE about the worker serving it.
 *
 * Read from the page rather than from the worker on purpose: this is the only
 * view available on a real device, where there is no debugger attached and the
 * automated suite (`playground/e2e-sw/`) cannot run. iOS Safari is the primary
 * PWA target and the one engine Playwright models least faithfully, so a page
 * that states the worker's condition in plain text is the instrument for it.
 */
type WorkerReport = {
  /** `false` on a plain-http origin, in dev, and on native — all by design. */
  available: boolean
  registered: boolean
  controlled: boolean
  state: string | null
  /** `null` where the browser has no navigationPreload at all (Safari < 15.4). */
  preloadEnabled: boolean | null
  waiting: boolean
  cacheNames: string[]
  precachedCount: number | null
}

const EMPTY: WorkerReport = {
  available: false,
  registered: false,
  controlled: false,
  state: null,
  preloadEnabled: null,
  waiting: false,
  cacheNames: [],
  precachedCount: null,
}

async function readWorker(): Promise<WorkerReport> {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return EMPTY
  }
  const registration = await navigator.serviceWorker.getRegistration()
  const preload = registration?.navigationPreload
    ? await registration.navigationPreload.getState().catch(() => null)
    : null

  let cacheNames: string[] = []
  let precachedCount: number | null = null
  if (typeof caches !== "undefined") {
    cacheNames = await caches.keys().catch(() => [])
    const precacheName = cacheNames.find((name) =>
      name.includes("precache"),
    )
    if (precacheName) {
      const entries = await caches
        .open(precacheName)
        .then((cache) => cache.keys())
        .catch(() => [])
      precachedCount = entries.length
    }
  }

  return {
    available: true,
    registered: !!registration,
    controlled: !!navigator.serviceWorker.controller,
    state: registration?.active?.state ?? null,
    preloadEnabled: preload?.enabled ?? null,
    waiting: !!registration?.waiting,
    cacheNames,
    precachedCount,
  }
}

function LabServiceWorkerPage() {
  const [report, setReport] = useState<WorkerReport>(EMPTY)
  const { updateAvailable, applyUpdate } = useServiceWorkerUpdate()

  const refresh = useCallback(() => {
    void readWorker().then(setReport)
  }, [])

  useEffect(() => {
    refresh()
    //cheap poll rather than an event: the interesting transitions (a worker
    //reaching `waiting`, the sweep finishing) fire inside the worker, and the
    //page gets no event for either
    const timer = setInterval(refresh, 1000)
    return () => clearInterval(timer)
  }, [refresh])

  //`static-<buildTag>` and friends. Naming the tag on screen is what makes a
  //deploy visible on a device: it is the one value that changes per build.
  const runtimeBuckets = report.cacheNames.filter((name) =>
    /^(static|pages|documents)-/.test(name),
  )

  return (
    <LabPage
      title="Service worker"
      subtitle="The delivery layer, stated in plain text. adaptv owns the worker end to end — precache, navigation, updates — and an app configures none of it, so this page is a read-out and not a control panel. It exists because on a real device there is no DevTools pane to open, and iOS Safari is exactly where the automated suite cannot reach."
    >
      <LabBrief
        what="That a worker is installed and controlling this page, that it precached the whole app rather than a handful of files, that navigation preload matches the render mode, and that a deploy is picked up and applied at the next launch."
        steps={[
          "Read the rows below on a normal load. `controlled` must be true and the precache count must be in the hundreds, not single digits — this is a BUILD-only feature, so in dev every row is correctly empty.",
          "Kill the server the app was served from, then pull to refresh. The app must still boot, and navigating to a route you have never opened must still work — that is the precache doing its job, not the HTTP cache.",
          "With the server back, deploy a new build over it. Reload once: `waiting` flips to true and nothing else changes — that is deliberate, a mid-session swap would pull the running build's chunks out from under this page. Reload a second time: the app applies it and reloads itself.",
          "Watch the runtime bucket row across that deploy. The old `static-<tag>` must disappear rather than accumulate.",
          "On a native build every row must read as unavailable. A worker there would serve the old bundle after an OTA update, which is why adaptv actively unregisters instead of just not registering.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Full support in a production build over https or localhost. On a plain-http origin `navigator.serviceWorker` is simply absent — the row below says so, and registerSW warns in the console.",
          },
          pwa: {
            verdict: "works",
            note: "The target this whole layer is for. Installed, the precache is what makes navigation feel native.",
          },
          ios: {
            verdict: "absent",
            note: "Native iOS gets no worker at all and cannot: capacitor://localhost is a custom scheme, and WKWebView does not support registration on one. The bundle is already on disk, so there is nothing to cache.",
          },
          android: {
            verdict: "absent",
            note: "Registration would technically succeed on http://localhost, which is worse than failing — SW fetches bypass Capacitor's asset loader, so the failure is silent inconsistency. adaptv unregisters instead.",
          },
        }}
        wrong="`controlled` stays false in a production web build, or the precache count is a handful of entries — either means offline navigation is not actually working and only looks like it because the HTTP cache is warm. Or a deploy never reaches `waiting`, which is the one failure with no remote fix: the old worker keeps serving the old build forever."
      />

      <LabSection title="This page's worker">
        <LabSupport
          supported={report.controlled}
          supportedLabel="Controlled by a worker"
          unsupportedLabel="No worker controlling this page"
          detail={
            report.available
              ? "Expected in dev and on native: adaptv registers no worker in either, and actively destroys any it finds."
              : "`navigator.serviceWorker` is absent — this origin is not a secure context, or the platform has no service workers."
          }
        />
        <LabRow
          label="registered"
          value={
            <LabBadge tone={report.registered ? "ok" : "muted"}>
              {String(report.registered)}
            </LabBadge>
          }
        />
        <LabRow label="active worker state" value={report.state} />
        <LabRow
          label="navigationPreload"
          value={
            report.preloadEnabled === null ? null : (
              <LabBadge tone={report.preloadEnabled ? "ok" : "muted"}>
                {String(report.preloadEnabled)}
              </LabBadge>
            )
          }
          hint="On under render: ssr, where the worker reads event.preloadResponse. Deliberately OFF under spa — every navigation is answered from the precache there, so an enabled preload would fetch a document per navigation and throw it away."
        />
      </LabSection>

      <LabSection
        title="What is stored"
        description="The precache is the offline story: every route CHUNK, never a route document."
      >
        <LabRow
          label="precached entries"
          value={report.precachedCount}
          hint="Hundreds is right. A handful means the manifest shrank and the app is only fast when the network is."
        />
        <LabRow
          label="runtime buckets"
          value={runtimeBuckets.length ? runtimeBuckets.join(", ") : null}
          hint="Named static-<buildTag>. Exactly one should exist at a time — the previous build's is swept on activate."
        />
        <LabRow
          label="all caches"
          value={
            report.cacheNames.length ? report.cacheNames.join(", ") : null
          }
        />
        <LabCaveat>
          No route <code>.html</code> may appear here. Cache Storage is
          keyed by URL and scoped per-origin, not per-user, so a
          server-rendered document in it is served to whoever asks next — a
          cross-user leak rather than a stale page.
        </LabCaveat>
      </LabSection>

      <LabSection
        title="Updates"
        description="A new worker installs, waits, and is applied at the next cold launch. Under the default policy this page's badge stays false forever, and that is the point: the app never has to render anything."
      >
        <LabRow
          label="a worker is waiting"
          value={
            <LabBadge tone={report.waiting ? "warn" : "muted"}>
              {String(report.waiting)}
            </LabBadge>
          }
          hint="Reads true between the reload that finds a deploy and the launch that applies it."
        />
        <LabRow
          label="useServiceWorkerUpdate().updateAvailable"
          value={
            <LabBadge tone={updateAvailable ? "warn" : "muted"}>
              {String(updateAvailable)}
            </LabBadge>
          }
          hint="Always false under serviceWorkerUpdate: 'auto' — the waiting worker is applied at launch and there is no moment to offer. Switching the config to 'prompt' flips this without touching any UI."
        />
        <LabActions>
          <LabButton onClick={applyUpdate}>applyUpdate()</LabButton>
        </LabActions>
        <LabRow
          label="applyUpdate() with nothing waiting"
          value="no-op"
          hint="Safe to wire to a button that is always mounted, which is why it needs no guard at the call site."
        />
      </LabSection>
    </LabPage>
  )
}
