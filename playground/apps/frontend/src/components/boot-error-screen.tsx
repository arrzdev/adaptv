import type { BootErrorProps } from "@arrzdev/adaptv/components"
import { View } from "@arrzdev/adaptv/components"

/**
 * The app's own boot failure screen, replacing adaptv's default.
 *
 * Rendered at BUILD time, once per boot code, and embedded in the document — so
 * it is the one screen in the app that survives its own bundle being broken.
 * That is also the whole constraint list: no hooks, no state, no browser, and
 * `code` is the only prop that arrives, because it is the only one whose values
 * can be enumerated ahead of time.
 *
 * Branching on it is the point. adaptv's default deliberately shows nothing —
 * what a user is told about a failure is the app's call, so it is made here.
 */
export function BootErrorScreen({ code }: BootErrorProps) {
  const copy = {
    "BOOT-LOAD": {
      title: "We can't reach ChopChop",
      body: "The app files aren't being served. This is usually a deploy still rolling out — try again in a moment.",
    },
    "BOOT-THROW": {
      title: "ChopChop hit a bad update",
      body: "The app downloaded but couldn't start. Reloading picks up a fresh copy.",
    },
    "BOOT-REJECT": {
      title: "ChopChop hit a bad update",
      body: "The app downloaded but couldn't start. Reloading picks up a fresh copy.",
    },
    "BOOT-STALL": {
      title: "ChopChop is stuck starting up",
      body: "Everything downloaded, but the app never opened. A reload usually clears it.",
    },
  }[code ?? "BOOT-THROW"]

  return (
    <View
      safe="all"
      role="alert"
      aria-live="assertive"
      className="w-full flex-1 flex-col items-center justify-center gap-6 px-6 text-center text-foreground"
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold tracking-tight">
          {copy.title}
        </h1>
        <p className="max-w-sm text-sm text-muted">{copy.body}</p>
      </div>

      {/* the watchdog reloads on any button in here — `onClick` is what runs if
          the app ever renders this component itself, live */}
      <button
        type="button"
        onClick={() => location.reload()}
        className="rounded-xl bg-primary/20 px-4 py-2.5 text-sm font-semibold text-primary ring-1 ring-inset ring-primary/30"
      >
        Reload
      </button>

      {/* a support reference is exactly the kind of thing the code is FOR */}
      <span className="text-xs uppercase tracking-[0.14em] text-muted/70">
        Error {code}
      </span>
    </View>
  )
}

export default BootErrorScreen
