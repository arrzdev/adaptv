import type { OrientationGuardProps } from "@arrzdev/adaptv/config"
import { Smartphone } from "lucide-react"

/**
 * App-branded orientation guard, wired via
 * `createRootRoute({ orientationGuardComponent })`. The PWA shell only mounts
 * this when the device is rotated away from the locked orientation, so it always
 * renders visible — no media query of its own.
 */
export function RotateGuard({ orientation }: OrientationGuardProps) {
  return (
    <div
      role="alert"
      className="fixed inset-0 z-[110] flex flex-col items-center justify-center gap-y-6 bg-background px-safe-offset-6 py-safe-offset-8 text-center text-foreground"
    >
      <Smartphone
        className="size-14 text-primary"
        strokeWidth={1.5}
        aria-hidden
      />
      <p className="max-w-xs text-balance text-base font-medium text-subtle">
        Rotate your device to {orientation} to use ChopChop.
      </p>
    </div>
  )
}

export default RotateGuard
