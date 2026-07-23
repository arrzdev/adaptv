import type { NotFoundRouteComponent } from "@tanstack/react-router"
import {
  createRootRoute as createTanStackRootRoute,
  Outlet,
} from "@tanstack/react-router"
import type { ComponentType, ReactNode } from "react"
import { UiNotFound } from "#adaptv/components/not-found"
import type { OfflineProps } from "#adaptv/components/offline"
import type { AdaptvPatches } from "#adaptv/config/app-config"
import type {
  OrientationGuardProps,
  PwaServiceWorkerRuntimeConfig,
  SplashScreenProps,
} from "#adaptv/config/types"
import type { UiThemePreference } from "#adaptv/hooks/use-theme"
import { getUiThemeInitScript } from "#adaptv/hooks/use-theme"
import { getCriticalShellCss } from "#adaptv/shell/critical-css"
import type { PwaHeadConfig } from "#adaptv/shell/head"
import { pwaHead } from "#adaptv/shell/head"
import { getLaunchViewportInitScript } from "#adaptv/shell/launch-viewport"
import type { RootDocumentProps } from "#adaptv/shell/shell-layout"
import {
  createRootDocument,
  RoutingShell,
} from "#adaptv/shell/shell-layout"
import { getPlatformInitScript } from "#adaptv/utils/platform"
export type RootHeadScript = {
  id: string
  children: string
}

export type CreateRootRouteConfig = PwaHeadConfig & {
  themeColorLight: string
  themeColorDark: string
  lang?: string
  htmlClassName?: string
  htmlAttrs?: Record<string, string>
  defaultThemePreference?: UiThemePreference
  notFoundHomeTo?: string
  shellClassName?: string
  /**
   * Override the document shell. A custom document is responsible for its own
   * pre-paint theme init + critical CSS (the defaults injected before
   * `<HeadContent/>` only apply to the built-in document).
   */
  RootDocument?: ComponentType<RootDocumentProps>
  notFoundComponent?: NotFoundRouteComponent
  /**
   * The app's offline UI. Rendered by adaptv when the app cannot boot far enough
   * for a route to exist — a route chunk fails to load (`vite:preloadError` with
   * the reload guard already spent), or the route tree itself cannot resolve.
   *
   * The **same** component is what the consumer renders from a route whose data
   * is unavailable; every prop is optional so one component serves both call
   * sites. Defaults to adaptv's `Offline`. → `RENDERING.md §3.1.2`
   */
  offlineComponent?: ComponentType<OfflineProps>
  /** Built app stylesheet URL (`import appCss from "…/main.css?url"`). */
  stylesEntryPoint?: string
  /** Extra inline scripts rendered by `<Scripts/>`. */
  headScripts?: RootHeadScript[]
  /** App-owned splash; self-dismisses by returning `null` when ready (no props). */
  splashScreenComponent?: ComponentType<SplashScreenProps>
  /** Show the splash in a browser tab too. Default `false` (installed-only). */
  splashScreenInBrowser?: boolean
  /**
   * Full-screen component rendered when a touch device is rotated away from the
   * orientation declared in the web app manifest (`orientation` field — the
   * single source of truth). Receives the required orientation. Falls back to a
   * built-in rotate prompt when omitted. iOS ignores the manifest lock and has
   * no working JS orientation lock, so this runtime guard is the only reliable
   * hold there; Android enforces the manifest natively. Desktop (fine pointer)
   * is never affected. To turn the guard off, drop `orientation` from the manifest.
   */
  orientationGuardComponent?: ComponentType<OrientationGuardProps>
  /**
   * Service worker registration. When set, the shell registers on mount with
   * `register: "autoUpdate"`.
   */
  serviceWorker?: PwaServiceWorkerRuntimeConfig
  /** Native-feel WebKit fixes; each defaults to `true`. See {@link AdaptvPatches}. */
  patches?: AdaptvPatches
}

function buildRootRouteHead({
  themeColorLight,
  headScripts,
  headConfig,
  headLinks,
}: {
  themeColorLight: string
  headScripts: RootHeadScript[]
  headConfig: Omit<PwaHeadConfig, "themeColorLight" | "links">
  headLinks: Array<Record<string, string>>
}) {
  const head = pwaHead({
    ...headConfig,
    themeColorLight,
    links: headLinks,
  })

  //the lone theme-color meta is owned at runtime by useSyncTheme (seeded pre-paint by
  //the head init script). deliberately no static prefers-color-scheme metas — an
  //OS-driven theme-color outranks the class override, so the in-app theme toggle
  //would never move the browser chrome (only OS appearance changes would).
  return {
    ...head,
    scripts: headScripts,
  }
}

export function createRootRoute(
  config: CreateRootRouteConfig,
  shellChildren?: (outlet: ReactNode) => ReactNode,
) {
  const {
    RootDocument: RootDocumentOverride,
    notFoundComponent,
    offlineComponent,
    stylesEntryPoint,
    splashScreenComponent,
    splashScreenInBrowser = false,
    orientationGuardComponent,
    themeColorLight,
    themeColorDark,
    lang = "en",
    htmlClassName,
    htmlAttrs,
    defaultThemePreference = "system",
    notFoundHomeTo = "/",
    shellClassName,
    headScripts = [],
    serviceWorker,
    patches,
    ...headConfig
  } = config

  // Single source of truth for the orientation lock — same path linked in the
  // head and read at runtime by the rotate guard.
  const manifestPath = config.manifestPath ?? "/manifest.json"

  const RootDocument =
    RootDocumentOverride ??
    createRootDocument({
      lang,
      htmlClassName,
      htmlAttrs,
      criticalCss: getCriticalShellCss(
        themeColorLight,
        themeColorDark,
        splashScreenInBrowser,
      ),
      headInitScript:
        //platform stamp first — the app:/web: variants and attribute-scoped
        //critical CSS below resolve from the very first frame.
        getPlatformInitScript() +
        getUiThemeInitScript({
          themeColorLight,
          themeColorDark,
          defaultThemePreference,
        }) +
        (splashScreenComponent ? getLaunchViewportInitScript() : ""),
    })

  const NotFound: NotFoundRouteComponent =
    notFoundComponent ??
    function DefaultNotFound() {
      return <UiNotFound homeTo={notFoundHomeTo} />
    }

  const headLinks = [
    ...(headConfig.links ?? []),
    ...(stylesEntryPoint
      ? [
          {
            rel: "stylesheet",
            href: stylesEntryPoint,
            "data-ui-styles-entry": "true",
          },
        ]
      : []),
  ]

  function RootComponent() {
    const outlet = <Outlet />
    return (
      <RootDocument>
        <RoutingShell
          themeColorLight={themeColorLight}
          themeColorDark={themeColorDark}
          splashScreenComponent={splashScreenComponent}
          manifestPath={manifestPath}
          orientationGuardComponent={orientationGuardComponent}
          serviceWorker={serviceWorker}
          offlineComponent={offlineComponent}
          shellClassName={shellClassName}
          patches={patches}
        >
          {shellChildren ? shellChildren(outlet) : outlet}
        </RoutingShell>
      </RootDocument>
    )
  }

  return createTanStackRootRoute({
    head: () =>
      buildRootRouteHead({
        themeColorLight,
        headScripts,
        headConfig,
        headLinks,
      }),
    notFoundComponent: NotFound,
    component: RootComponent,
  })
}
