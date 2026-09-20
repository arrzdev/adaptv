import {
  HeadContent,
  Scripts,
  useRouterState,
} from "@tanstack/react-router"
import type { ComponentType, ReactNode } from "react"
import { useEffect, useRef, useState } from "react"
import { initNativeKeyboard } from "#adaptv/capabilities/keyboard"
import { loadKeyboardHeightCache } from "#adaptv/capabilities/keyboard-height-cache"
import { persistNativeThemePreference } from "#adaptv/capabilities/native-theme"
import type { OfflineProps } from "#adaptv/components/offline"
import { Offline } from "#adaptv/components/offline"
import { OrientationGuard } from "#adaptv/components/orientation-guard"
import { UpdateRequired } from "#adaptv/components/update-required"
import type {
  AdaptvPatches,
  AdaptvUiConfig,
} from "#adaptv/config/app-config"
import type {
  OrientationGuardProps,
  SplashScreenProps,
  UpdateRequiredProps,
} from "#adaptv/config/types"
import { useAndroidBackButton } from "#adaptv/hooks/use-android-back-button"
import { useCaretRepaint } from "#adaptv/hooks/use-caret-repaint"
import { useFreezeViewport } from "#adaptv/hooks/use-freeze-viewport"
import { useIsomorphicLayoutEffect } from "#adaptv/hooks/use-isomorphic-layout-effect"
import { useRegisterPwaServiceWorker } from "#adaptv/hooks/use-register-pwa-service-worker"
import { useSplashHandoff } from "#adaptv/hooks/use-splash-handoff"
import { useStatusBar } from "#adaptv/hooks/use-status-bar"
import { useSuppressTextMagnifier } from "#adaptv/hooks/use-suppress-text-magnifier"
import { useSyncTheme } from "#adaptv/hooks/use-sync-theme"
import { readPreference, useTheme } from "#adaptv/hooks/use-theme"
import { useOtaUpdates } from "#adaptv/ota/use-ota-updates"
import { installPreloadErrorRecovery } from "#adaptv/shell/preload-error-recovery"
import { useRouteTint } from "#adaptv/shell/use-route-tint"
import { initKv } from "#adaptv/storage/kv"
import { cn } from "#adaptv/utils/cn"
import { applyPlatformStamp } from "#adaptv/utils/platform"

const DOCUMENT_SHELL_CLASS = "m-0 h-dvh touch-none overscroll-none"

//No height here: it is a per-surface rule on `[data-app-shell]` in styles/screen.css, so a
//consumer's height in `shellClassName` wins on every surface.
//Exported for app-shell-height.test.ts, which checks that nothing here sets a height.
export const APP_SHELL_CLASS =
  "box-border flex min-h-0 min-w-0 w-full flex-col overflow-hidden"

const APP_SCREEN_FRAME_CLASS =
  "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"

export type AppShellProps = {
  children: ReactNode
  className?: string
  frameClassName?: string
}

function AppShell({ children, className, frameClassName }: AppShellProps) {
  return (
    <div data-app-shell className={cn(APP_SHELL_CLASS, className)}>
      {/* `data-adaptv-screen` is what `styles/screen.css` hooks: a page's root element
          is stretched to the frame when it is the only one, so a page never has to
          remember `fill` just to be full-height. */}
      <div
        data-adaptv-screen
        className={cn(APP_SCREEN_FRAME_CLASS, frameClassName)}
      >
        {children}
      </div>
    </div>
  )
}

export type RootDocumentProps = {
  children: ReactNode
}

type RootDocumentOptions = {
  lang?: string
  htmlClassName?: string
  htmlAttrs?: Record<string, string>
  /** Inline critical CSS rendered first in `<head>` (brand background per theme). */
  criticalCss?: string
  /** Blocking theme init script rendered before `<HeadContent/>` (runs pre-paint). */
  headInitScript?: string
}

function DefaultRootDocument({
  children,
  lang = "en",
  htmlClassName,
  htmlAttrs,
  criticalCss,
  headInitScript,
}: RootDocumentProps & RootDocumentOptions) {
  return (
    <html
      lang={lang}
      className={cn(DOCUMENT_SHELL_CLASS, htmlClassName)}
      suppressHydrationWarning
      {...htmlAttrs}
    >
      <head>
        {/* theme init first so the html class/background resolve before paint */}
        {headInitScript && (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted inline shell init script
          <script dangerouslySetInnerHTML={{ __html: headInitScript }} />
        )}
        {criticalCss && (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted inline shell critical CSS
          <style dangerouslySetInnerHTML={{ __html: criticalCss }} />
        )}
        <HeadContent />
      </head>
      <body className={DOCUMENT_SHELL_CLASS} suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

export function createRootDocument(
  options: RootDocumentOptions,
): ComponentType<RootDocumentProps> {
  return function RootDocument({ children }) {
    return (
      <DefaultRootDocument {...options}>{children}</DefaultRootDocument>
    )
  }
}

type RoutingShellProps = {
  themeColorLight: string
  themeColorDark: string
  splashScreenComponent?: ComponentType<SplashScreenProps>
  /** Manifest path; its `orientation` field drives the touch-device rotate guard. */
  manifestPath: string
  orientationGuardComponent?: ComponentType<OrientationGuardProps>
  /** Days unreachable by OTA before the screen is taken. Omitted means never. */
  updateRequiredAfterDays?: number
  updateRequiredComponent?: ComponentType<UpdateRequiredProps>
  /** Rendered in place of the app when a route chunk is unrecoverably missing. */
  offlineComponent?: ComponentType<OfflineProps>
  shellClassName?: string
  /** Native-feel WebKit fixes; each defaults to `true`. See {@link AdaptvPatches}. */
  patches?: AdaptvPatches
  /** App-feel resets that are the app's call; per-option defaults (`UI_SCOPE_DEFAULTS`). See {@link AdaptvUiConfig}. */
  ui?: AdaptvUiConfig
  children: ReactNode
}

/**
 * `true` when the router is rendering a not-found through a match boundary
 * instead of the app's own route tree.
 *
 * A not-found boundary short-circuits the `<Outlet/>` at that match: the router
 * renders the boundary's `notFoundComponent` there and **never descends**, so no
 * route below it mounts. adaptv sets `notFoundMode: "root"`, which makes root
 * that boundary for every not-found — a URL that matches nothing (the matcher
 * returns root alone, so no layout route is even in the match chain) *and* a
 * `notFound()` thrown from a loader mid-boot. Either way the app's layout routes
 * do not run, which is the whole reason this flag has to exist here.
 */
function useNotFoundBoundary() {
  return useRouterState({
    //`globalNotFound` marks the boundary that renders the not-found; `notFound`
    //status is the nested (`notFoundMode: "fuzzy"`) form of the same thing. Both
    //cut the tree off below that point.
    select: (state) =>
      state.matches.some(
        (match) => match.globalNotFound || match.status === "notFound",
      ),
  })
}

export function RoutingShell({
  themeColorLight,
  themeColorDark,
  splashScreenComponent,
  manifestPath,
  orientationGuardComponent,
  updateRequiredAfterDays,
  updateRequiredComponent,
  offlineComponent,
  shellClassName,
  patches,
  ui,
  children,
}: RoutingShellProps) {
  //resolve each native-feel fix — all default on, opt out per fix via config.
  const caretRepaint = patches?.caretRepaint ?? true
  const textMagnifier = patches?.textMagnifier ?? true
  const viewportFreeze = patches?.viewportFreeze ?? true

  //Restore the `<html>` platform/OS stamp that React strips when it reconciles the
  //document on the SPA/native client path. Without it every `app:` variant is inert —
  //most visibly safe-area padding, so content slides under the status bar. Layout
  //effect (pre-paint) and behind the splash, so there is no visible reflow.
  //The ui app-feel stamps ride along for the same reason: React would otherwise drop
  //`data-adaptv-no-select` too, and text selection would silently come back.
  useIsomorphicLayoutEffect(() => {
    applyPlatformStamp(ui)
  }, [ui])

  const [resolvedAppearance] = useTheme()
  //A route may pin the browser chrome to a colour of its own. The pre-paint
  //script already painted it for the launch URL; this keeps it right across
  //navigations — and falls back to the theme colours, never to a parent route's
  //tint. → `shell/route-tints.ts`
  const chromeTint = useRouteTint()
  useSyncTheme({ themeColorLight, themeColorDark, chromeTint })
  //native only — keep the OS system bars' icons in sync with the theme + go
  //edge-to-edge, and route the Android hardware back button through the router. No-ops
  //on web. The bar background is CSS-driven (html/body colour under the inset), so this
  //takes no colour — see capabilities/status-bar.ts.
  useStatusBar(resolvedAppearance)
  useAndroidBackButton()
  //app-wide iOS caret-repaint patch — mutes a focused field's caret while it moves and
  //force-repaints it on settle, so a translated input never leaves a detached ghost caret
  useCaretRepaint({ enabled: caretRepaint })
  useRegisterPwaServiceWorker()
  //native only, and a no-op unless the app declares `origin`: check the app's
  //own deploy for a newer JS bundle, and tell the watchdog THIS one booted
  useOtaUpdates()
  //kill the iOS WebKit double-tap text-magnifier loupe app-wide (WebKit bug
  //231161 — not fixable in CSS; see the hook for the "safe to remove?" check)
  useSuppressTextMagnifier({ enabled: textMagnifier })
  //hold the drawer's viewport lock (scroll pin + virtualKeyboard overlay) app-wide
  //so the keyboard / url bar can't shift the layout. refcounted, so an opening
  //drawer just coexists ("double lock") and behaves exactly as before.
  useFreezeViewport(viewportFreeze)

  //Hand the OS launch splash over to the app's own splash, and report the instant that
  //happens — the splash is mounted underneath the OS one, so mount time is not view
  //time, and `revealedAt` is the only honest clock a splash can time itself against.
  //launchAutoHide in capacitor.config is the fallback if the handoff misses.
  //→ `#adaptv/hooks/use-splash-handoff`
  const splashRevealedAt = useSplashHandoff()

  //Attach the native keyboard listeners now — eagerly at app start — so an
  //[autofocus] drawer opened later never races the async listener registration
  //(the missed-first-event bug that left autofocus sheets stuck behind the keyboard).
  useEffect(() => {
    //Native KV hydration is async, so it runs HERE — eagerly at boot, behind the
    //splash — rather than lazily at first read. A component reading a flag during
    //render must never see an empty map and then flip. (Web already hydrated
    //synchronously at module load, so this is a no-op there.)
    void initKv()
    initNativeKeyboard()
    //hydrate the learned keyboard-height cache before any drawer can open, so the first focus of a
    //same-shape field already has a prediction to lift from (see keyboard-height-cache)
    void loadKeyboardHeightCache()
    //seed native storage with the current theme preference so the OS splash colour
    //tracks the app theme (light/dark) on the next launch, not the system setting.
    void persistNativeThemePreference(readPreference())
  }, [])
  //The splash owns its own lifecycle: it renders while the app boots and returns
  //null when ready (self-unmount) — adaptv just mounts it. CSS gates it off in a
  //browser tab (see the critical-css splash policy) unless the app opts in.
  const SplashScreenComponent = splashScreenComponent

  //…except on a not-found, where self-unmount CANNOT happen: the ready signal is
  //the app's own boot work, which lives in a layout route (see the playground's
  //providers layout) that the boundary skips. The signal never fires, the splash
  //never returns null, and a cold start into a 404 is left under a full-viewport
  //overlay for good — installed/native only, since on web the critical-CSS policy
  //renders the leftover `display: none`. → docs/decisions/register.md B28
  //
  //adaptv mounts the splash, so adaptv retires it — there is no boot left to cover
  //when the app tree is never going to mount. During render, not in an effect, so
  //the SSR pass and hydration agree (`globalNotFound` is dehydrated) and a native
  //cold start never paints the splash even for a frame. Latched, because retiring
  //is one-way: re-mounting on the navigation *out* of a 404 would hand a fresh
  //splash an already-set ready gate and replay it over a booted app.
  const notFound = useNotFoundBoundary()
  const splashRetired = useRef(false)
  if (notFound) splashRetired.current = true

  //Adaptv's own offline call site: a route chunk 404'd moments after a recovery
  //reload already tried, so reloading again cannot help and there is no route
  //left to render its own offline UI. Without this the user gets a blank screen.
  //docs/design/rendering.md §3.1.2
  //
  //This is the ONE stale-chunk net. It is armed here, unconditionally, because
  //the failure is a deploy artifact and not a service-worker one — and only here,
  //because a second installation sharing the same stamp reads the first one's
  //reload as "a reload already failed" and draws the offline screen over it.
  //Armed in an effect, so a document that imports a missing chunk while it boots
  //fails before it is listening: that one gets the router's error screen.
  const OfflineComponent = offlineComponent ?? Offline
  const [bootFailed, setBootFailed] = useState(false)
  useEffect(
    () => installPreloadErrorRecovery(() => setBootFailed(true)),
    [],
  )

  if (bootFailed) {
    return (
      <AppShell className={shellClassName}>
        <OfflineComponent />
      </AppShell>
    )
  }

  return (
    <>
      {SplashScreenComponent && !splashRetired.current && (
        <SplashScreenComponent revealedAt={splashRevealedAt} />
      )}
      <AppShell className={shellClassName}>{children}</AppShell>
      <OrientationGuard
        manifestPath={manifestPath}
        component={orientationGuardComponent}
      />
      {/* Last, so it sits above the rotate guard: an install that cannot be
          updated is a harder stop than one that is held the wrong way round. */}
      <UpdateRequired
        afterDays={updateRequiredAfterDays}
        component={updateRequiredComponent}
      />
    </>
  )
}
