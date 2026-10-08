import type {
  DrawerContentProps,
  DrawerDescriptionProps,
  DrawerFooterProps,
  DrawerHandle,
  DrawerOverlayProps,
  DrawerRootProps,
  DrawerShellProps,
  DrawerTitleProps,
} from "adaptv/components"
import { Drawer as BaseDrawer, useDrawer } from "adaptv/components"
import type { ComponentPropsWithRef } from "react"
import { forwardRef } from "react"
import { cn } from "@/utils/cn"

const DRAWER_OVERLAY_CLASSNAME = cn("bg-overlay")

const DRAWER_CONTENT_CLASSNAME = cn(
  "rounded-t-3xl border-t border-border-subtle bg-surface text-foreground",
)

const DRAWER_HANDLE_CLASSNAME = cn("mt-2 mb-1 bg-border-strong")

const DRAWER_SHELL_CLASSNAME = cn("px-safe-offset-6 pt-2")

//pinned below the scroller — owns the bottom safe-area inset when present
const DRAWER_FOOTER_CLASSNAME = cn(
  "px-safe-offset-6 pt-3 web:pb-4 app:pb-safe-offset-2",
)

const DRAWER_TITLE_CLASSNAME = cn("text-lg font-semibold text-foreground")

const DRAWER_DESCRIPTION_CLASSNAME = cn("text-sm text-muted")

function AppDrawerOverlay({ className, ...props }: DrawerOverlayProps) {
  return (
    <BaseDrawer.Overlay
      className={cn(DRAWER_OVERLAY_CLASSNAME, className)}
      {...props}
    />
  )
}
AppDrawerOverlay.displayName = "Drawer.Overlay"

type AppDrawerContentProps = DrawerContentProps & {
  /**
   * Set when a `AppDrawer.Footer` is composed inside — the footer takes over
   * the bottom safe-area inset, so the scroller keeps only a small gap.
   */
  hasFooter?: boolean
}

function AppDrawerContent({
  className,
  scrollClassName,
  hasFooter = false,
  ...props
}: AppDrawerContentProps) {
  //bottom breathing room for every drawer's content — always the larger inset so the
  //layout doesn't shift when the keyboard opens (footer drawers keep just a gap;
  //the footer, last in the scroll flow, carries the safe-area inset instead)
  return (
    <BaseDrawer.Content
      className={cn(DRAWER_CONTENT_CLASSNAME, className)}
      scrollClassName={cn(
        hasFooter ? "pb-2" : "web:pb-4 app:pb-safe-offset-2",
        scrollClassName,
      )}
      {...props}
    />
  )
}
AppDrawerContent.displayName = "Drawer.Content"

function AppDrawerHandle({
  className,
  ...props
}: ComponentPropsWithRef<typeof BaseDrawer.Handle>) {
  return (
    <BaseDrawer.Handle
      className={cn(DRAWER_HANDLE_CLASSNAME, className)}
      {...props}
    />
  )
}
AppDrawerHandle.displayName = "Drawer.Handle"

function AppDrawerShell({ className, ...props }: DrawerShellProps) {
  return (
    <BaseDrawer.Shell
      className={cn(DRAWER_SHELL_CLASSNAME, className)}
      {...props}
    />
  )
}
AppDrawerShell.displayName = "Drawer.Shell"

function AppDrawerFooter({ className, ...props }: DrawerFooterProps) {
  return (
    <BaseDrawer.Footer
      className={cn(DRAWER_FOOTER_CLASSNAME, className)}
      {...props}
    />
  )
}
AppDrawerFooter.displayName = "Drawer.Footer"

function AppDrawerTitle({ className, ...props }: DrawerTitleProps) {
  return (
    <BaseDrawer.Title
      className={cn(DRAWER_TITLE_CLASSNAME, className)}
      {...props}
    />
  )
}
AppDrawerTitle.displayName = "Drawer.Title"

function AppDrawerDescription({
  className,
  ...props
}: DrawerDescriptionProps) {
  return (
    <BaseDrawer.Description
      className={cn(DRAWER_DESCRIPTION_CLASSNAME, className)}
      {...props}
    />
  )
}
AppDrawerDescription.displayName = "Drawer.Description"

export const AppDrawer = Object.assign(
  forwardRef<DrawerHandle, DrawerRootProps>(
    function AppDrawer(props, forwardedRef) {
      //No back wiring here any more: the base Drawer registers itself at the
      //Overlay band while open, so this wrapper is presentation only. It used to
      //hold the imperative handle purely to run that handler, and a nested
      //drawer never got one at all.
      return <BaseDrawer ref={forwardedRef} {...props} />
    },
  ),
  {
    Portal: BaseDrawer.Portal,
    Overlay: AppDrawerOverlay,
    Content: AppDrawerContent,
    Handle: AppDrawerHandle,
    Shell: AppDrawerShell,
    Footer: AppDrawerFooter,
    Title: AppDrawerTitle,
    Description: AppDrawerDescription,
    Close: BaseDrawer.Close,
    Trigger: BaseDrawer.Trigger,
  },
)

export { useDrawer }
export type { DrawerHandle }
