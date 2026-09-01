//The build-time route→chrome-tint table. Imported here so the pre-paint script
//can carry it: a cold launch onto a route that pins the chrome has to paint that
//colour on the FIRST frame, and by the time this route's component runs the
//frame that mattered is already on screen. → `src/shell/route-tints.ts`
import { ROUTE_TINTS } from "virtual:adaptv/route-tints"
import type { NotFoundRouteComponent } from "@tanstack/react-router"
import {
  createRootRoute as createTanStackRootRoute,
  Outlet,
} from "@tanstack/react-router"
import type { ComponentType } from "react"
import { UiNotFound } from "#adaptv/components/not-found"
import type { OfflineProps } from "#adaptv/components/offline"
import type {
  AdaptvPatches,
  AdaptvUiConfig,
} from "#adaptv/config/app-config"
import type {
  OrientationGuardProps,
  SplashScreenProps,
  UpdateRequiredProps,
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
   * sites. Defaults to adaptv's `Offline`. → `docs/design/rendering.md §3.1.2`
   */
  offlineComponent?: ComponentType<OfflineProps>
  /** Built app stylesheet URL (`import appCss from "…/main.css?url"`). */
  stylesEntryPoint?: string
  /** Extra inline scripts rendered by `<Scripts/>`. */
  headScripts?: RootHeadScript[]
  /** App-owned splash; self-dismisses by returning `null` when ready. Receives {@link SplashScreenProps} — `revealedAt`, the moment it became visible. */
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
   * Days an install may be unreachable by OTA before the screen is taken. Omitted
   * (the default) means never — see `updateRequiredAfterDays` in the app config
   * for why adaptv refuses to pick a number. → `docs/design/ota.md §5.6`
   */
  updateRequiredAfterDays?: number
  /** App-supplied screen for the above; falls back to adaptv's own. */
  updateRequiredComponent?: ComponentType<UpdateRequiredProps>
  /** Native-feel WebKit fixes; each defaults to `true`. See {@link AdaptvPatches}. */
  patches?: AdaptvPatches
  /**
   * The app-feel resets that are the app's call — text selection, scrollbar
   * visibility, and the iOS link callout. Per-option defaults (`utils/platform.ts`:
   * `UI_SCOPE_DEFAULTS`), not a uniform one. Resolved against the runtime platform
   * in the pre-paint init script and stamped on `<html>`. See {@link AdaptvUiConfig}.
   */
  ui?: AdaptvUiConfig
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

//NOTE: this used to take a second `shellChildren?: (outlet) => ReactNode` param,
//which existed only so the removed `providers` config thunk could wrap the
//outlet. Nothing has passed it since; an app-wide provider tree is a layout
//route now (see AdaptvAppConfig's note), so a wrapper callback here would just
//be a second, weaker way to express the same thing. Removed rather than left
//dead — an ejected caller still passing one now gets a loud arity error instead
//of a silently-dropped provider tree.
export function createRootRoute(config: CreateRootRouteConfig) {
  const {
    RootDocument: RootDocumentOverride,
    notFoundComponent,
    offlineComponent,
    stylesEntryPoint,
    splashScreenComponent,
    splashScreenInBrowser = false,
    orientationGuardComponent,
    updateRequiredAfterDays,
    updateRequiredComponent,
    themeColorLight,
    themeColorDark,
    lang = "en",
    htmlClassName,
    htmlAttrs,
    defaultThemePreference = "system",
    notFoundHomeTo = "/",
    shellClassName,
    headScripts = [],
    patches,
    ui,
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
        //platform stamp first — the app:/web: variants, the ui app-feel stamps
        //and the attribute-scoped critical CSS below all resolve from the very
        //first frame.
        getPlatformInitScript(ui) +
        getUiThemeInitScript({
          themeColorLight,
          themeColorDark,
          defaultThemePreference,
          routeTints: ROUTE_TINTS,
          //a subpath deploy shifts every pathname; strip the base before
          //matching or every route tint silently misses
          base: import.meta.env.BASE_URL,
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
          updateRequiredAfterDays={updateRequiredAfterDays}
          updateRequiredComponent={updateRequiredComponent}
          offlineComponent={offlineComponent}
          shellClassName={shellClassName}
          patches={patches}
          ui={ui}
        >
          {outlet}
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
