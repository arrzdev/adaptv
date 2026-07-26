import confetti, { type CreateTypes, type Options } from "canvas-confetti"
import { useCallback, useEffect, useRef } from "react"
import { useAppReducedMotion } from "@/hooks/use-app-reduced-motion"

type ConfettiFire = CreateTypes | typeof confetti

export type ConfettiFireConfig = Options & {
  delay?: number
}

let viewportConfetti: ConfettiFire | null = null
let viewportConfettiCanvas: HTMLCanvasElement | null = null

function getAppViewport(): HTMLElement | null {
  const element = document.querySelector("[data-app-shell]")
  return element instanceof HTMLElement ? element : null
}

function getViewportConfetti(): ConfettiFire {
  //the cached instance binds to a canvas appended to the shell; if that shell
  //was replaced/remounted the canvas is detached and draws nowhere, so reset
  //and rebuild against the current shell element
  if (viewportConfetti && viewportConfettiCanvas?.isConnected) {
    return viewportConfetti
  }

  if (viewportConfettiCanvas) {
    viewportConfettiCanvas.remove()
    viewportConfettiCanvas = null
  }
  viewportConfetti = null

  const viewport = getAppViewport()
  if (!viewport) return confetti

  const canvas = document.createElement("canvas")
  canvas.setAttribute("aria-hidden", "true")
  canvas.style.position = "absolute"
  canvas.style.inset = "0"
  canvas.style.width = "100%"
  canvas.style.height = "100%"
  canvas.style.pointerEvents = "none"
  canvas.style.zIndex = "100"

  if (getComputedStyle(viewport).position === "static") {
    viewport.style.position = "relative"
  }

  viewport.appendChild(canvas)
  viewportConfettiCanvas = canvas
  viewportConfetti = confetti.create(canvas, {
    resize: true,
    useWorker: false,
  })

  return viewportConfetti
}

function launchConfetti(config: Options) {
  const viewport = getAppViewport()
  const height =
    viewport?.getBoundingClientRect().height ?? window.innerHeight

  getViewportConfetti()({
    particleCount: 220,
    angle: 90,
    spread: 80,
    startVelocity: height * 0.065,
    decay: 0.93,
    gravity: 1,
    ticks: 350,
    origin: { x: 0.5, y: 1.08 },
    ...config,
  })
}

export function useConfetti() {
  const reducedMotion = useAppReducedMotion()
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancel = useCallback(() => {
    if (!timeoutRef.current) return
    clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }, [])

  const fire = useCallback(
    (config?: ConfettiFireConfig) => {
      if (typeof window === "undefined" || reducedMotion) return

      cancel()

      const { delay = 0, ...confettiOptions } = config ?? {}

      if (delay > 0) {
        timeoutRef.current = setTimeout(() => {
          timeoutRef.current = null
          launchConfetti(confettiOptions)
        }, delay)
        return
      }

      launchConfetti(confettiOptions)
    },
    [cancel, reducedMotion],
  )

  useEffect(() => () => cancel(), [cancel])

  return { fire, cancel }
}
