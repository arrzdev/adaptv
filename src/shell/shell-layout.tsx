import { HeadContent, Scripts } from "@tanstack/react-router"
import type { ComponentType, ReactNode } from "react"
import { useEffect } from "react"
import { initNativeKeyboard } from "#nativ/capabilities/keyboard"
import { persistNativeThemePreference } from "#nativ/capabilities/native-theme"
import { hideNativeSplash } from "#nativ/capabilities/splash"
import { OrientationGuard } from "#nativ/components/orientation-guard"
import type { NativPatches } from "#nativ/config/app-config"
import type {
  OrientationGuardProps,
  PwaServiceWorkerRuntimeConfig,
  SplashScreenProps,
} from "#nativ/config/types"
import { useAndroidBackButton } from "#nativ/hooks/use-android-back-button"
import { useCaretRepaint } from "#nativ/hooks/use-caret-repaint"
import { useFreezeViewport } from "#nativ/hooks/use-freeze-viewport"
import { useGlobalFpsSentinel } from "#nativ/hooks/use-global-fps-sentinel"
import { useRegisterPwaServiceWorker } from "#nativ/hooks/use-register-pwa-service-worker"
import { useStatusBar } from "#nativ/hooks/use-status-bar"
import { useSuppressTextMagnifier } from "#nativ/hooks/use-suppress-text-magnifier"
import { useSyncTheme } from "#nativ/hooks/use-sync-theme"
import { readPreference, useTheme } from "#nativ/hooks/use-theme"
import { cn } from "#nativ/utils/cn"

const DOCUMENT_SHELL_CLASS = "m-0 h-dvh touch-none overscroll-none"

const APP_SHELL_CLASS =
  "box-border flex min-h-0 min-w-0 w-full flex-col overflow-hidden h-dvh app:h-screen"

const APP_SCREEN_FRAME_CLASS =
  "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden hardware-boosted"

export type AppShellProps = {
  children: ReactNode
  className?: string
  frameClassName?: string
}

export function AppShell({
  children,
  className,
  frameClassName,
}: AppShellProps) {
  return (
    <div data-app-shell className={cn(APP_SHELL_CLASS, className)}>
      <div className={cn(APP_SCREEN_FRAME_CLASS, frameClassName)}>
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
  manifestPath?: string
  orientationGuardComponent?: ComponentType<OrientationGuardProps>
  serviceWorker?: PwaServiceWorkerRuntimeConfig
  shellClassName?: string
  /** Native-feel WebKit fixes; each defaults to `true`. See {@link NativPatches}. */
  patches?: NativPatches
  children: ReactNode
}

export function RoutingShell({
  themeColorLight,
  themeColorDark,
  splashScreenComponent,
  manifestPath = "/manifest.json",
  orientationGuardComponent,
  serviceWorker,
  shellClassName,
  patches,
  children,
}: RoutingShellProps) {
  //resolve each native-feel fix — all default on, opt out per fix via config.
  const caretRepaint = patches?.caretRepaint ?? true
  const textMagnifier = patches?.textMagnifier ?? true
  const viewportFreeze = patches?.viewportFreeze ?? true
  const gpuBoost = patches?.gpuBoost ?? true

  const [resolvedAppearance] = useTheme()
  useSyncTheme({ themeColorLight, themeColorDark })
  //native only — keep the OS status bar in sync with the theme + go edge-to-edge,
  //and route the Android hardware back button through the router. No-ops on web.
  useStatusBar(
    resolvedAppearance,
    resolvedAppearance === "dark" ? themeColorDark : themeColorLight,
  )
  useAndroidBackButton()
  //watch the frame rate and GPU-promote animating layers when frames drop
  useGlobalFpsSentinel({ enabled: gpuBoost })
  //app-wide iOS caret-repaint patch — mutes a focused field's caret while it moves and
  //force-repaints it on settle, so a translated input never leaves a detached ghost caret
  useCaretRepaint({ enabled: caretRepaint })
  useRegisterPwaServiceWorker(serviceWorker)
  //kill the iOS WebKit double-tap text-magnifier loupe app-wide (WebKit bug
  //231161 — not fixable in CSS; see the hook for the "safe to remove?" check)
  useSuppressTextMagnifier({ enabled: textMagnifier })
  //hold the drawer's viewport lock (scroll pin + virtualKeyboard overlay) app-wide
  //so the keyboard / url bar can't shift the layout. refcounted, so an opening
  //drawer just coexists ("double lock") and behaves exactly as before.
  useFreezeViewport(viewportFreeze)

  //hand off the native launch splash to the custom React splash after first paint
  //(native only). launchAutoHide in capacitor.config is the fallback if this misses.
  //Also attach the native keyboard listeners now — eagerly at app start — so an
  //[autofocus] drawer opened later never races the async listener registration
  //(the missed-first-event bug that left autofocus sheets stuck behind the keyboard).
  useEffect(() => {
    hideNativeSplash()
    initNativeKeyboard()
    //seed native storage with the current theme preference so the OS splash colour
    //tracks the app theme (light/dark) on the next launch, not the system setting.
    void persistNativeThemePreference(readPreference())
  }, [])
  //The splash owns its own lifecycle: it renders while the app boots and returns
  //null when ready (self-unmount) — nativ just mounts it. CSS gates it off in a
  //browser tab (see the critical-css splash policy) unless the app opts in.
  const SplashScreenComponent = splashScreenComponent

  return (
    <>
      {SplashScreenComponent && <SplashScreenComponent />}
      <AppShell className={shellClassName}>{children}</AppShell>
      <OrientationGuard
        manifestPath={manifestPath}
        component={orientationGuardComponent}
      />
    </>
  )
}
