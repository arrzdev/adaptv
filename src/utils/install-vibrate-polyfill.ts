/**
 * Wraps navigator.vibrate to cancel in-flight patterns before each new call.
 * On iOS 18+ Safari without native vibrate, falls back to `<input switch>` clicks.
 */

let installed = false

function getSafariVersion(): number | null {
  if (typeof navigator === "undefined") return null

  const ua = navigator.userAgent
  if (!ua.includes("Safari") || ua.includes("Chrome")) return null

  const match = ua.match(/Version\/(\d+(?:\.\d+)?)/)
  return match?.[1] ? Number.parseFloat(match[1]) : null
}

function normalizePattern(
  pattern: VibratePattern | Iterable<number>,
): VibratePattern {
  if (typeof pattern === "number") return pattern
  if (Array.isArray(pattern)) return pattern
  return [...pattern]
}

function isCancelPattern(pattern: VibratePattern): boolean {
  if (typeof pattern === "number") return pattern === 0
  return pattern.length === 0
}

function pulseDuration(pattern: VibratePattern): number {
  if (typeof pattern === "number") return pattern
  if (pattern.length === 0) return 0
  return pattern[0] ?? 0
}

export function installVibratePolyfill(): void {
  if (installed) return
  if (typeof navigator === "undefined" || typeof document === "undefined")
    return

  const nativeVibrate =
    typeof navigator.vibrate === "function"
      ? navigator.vibrate.bind(navigator)
      : null

  const safariVersion = getSafariVersion()
  const needsSwitchPolyfill =
    !nativeVibrate && safariVersion !== null && safariVersion >= 18

  if (!nativeVibrate && !needsSwitchPolyfill) return

  installed = true

  let switchTrigger: HTMLLabelElement | null = null
  if (needsSwitchPolyfill) {
    const label = document.createElement("label")
    label.ariaHidden = "true"
    label.style.display = "none"

    const input = document.createElement("input")
    input.type = "checkbox"
    input.setAttribute("switch", "")
    label.appendChild(input)

    const mount = () => {
      document.head.appendChild(label)
    }
    if (document.head) mount()
    else queueMicrotask(mount)

    switchTrigger = label
  }

  function cancelVibration() {
    nativeVibrate?.(0)
  }

  function vibrate(pattern: VibratePattern): boolean
  function vibrate(pattern: Iterable<number>): boolean
  function vibrate(pattern: VibratePattern | Iterable<number>): boolean {
    const normalized = normalizePattern(pattern)

    if (isCancelPattern(normalized)) {
      cancelVibration()
      return true
    }

    cancelVibration()

    if (nativeVibrate) return nativeVibrate(normalized)

    if (pulseDuration(normalized) <= 0 || !switchTrigger) return false

    switchTrigger.click()
    return true
  }

  navigator.vibrate = vibrate
}
