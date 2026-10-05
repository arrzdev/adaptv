import { useReducedMotion } from "@arrzdev/adaptv/hooks"
import { cn } from "@arrzdev/adaptv/utils"
import { Play } from "lucide-react"
import { useInView } from "motion/react"
import { useEffect, useRef, useState } from "react"
import type { Clip } from "@/content/recordings"

/**
 * A real screen recording: muted, looping, inline, and playing only while it is on
 * screen. It fills the box its frame reserves, so nothing moves when it loads. The
 * poster is what shows before the first frame, after a failed load (the source
 * errors, the poster stays) and, under reduced motion, until the play button.
 */
export function Recording({
  clip,
  label,
  className,
}: {
  clip: Clip | null
  /** What the clip shows, for assistive tech. */
  label: string
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const inView = useInView(ref, { amount: 0.3 })
  const reduced = useReducedMotion()
  const [chosen, setChosen] = useState(false)
  const playing = inView && (!reduced || chosen)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    if (playing) void video.play().catch(() => {})
    else video.pause()
  }, [playing])

  if (!clip) return <div className={cn("size-full", className)} />
  return (
    <div className={cn("relative size-full", className)}>
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="none"
        poster={clip.poster}
        aria-label={label}
        className="size-full object-cover"
      >
        <source src={clip.src} type="video/mp4" />
      </video>
      {reduced && !chosen ? (
        <button
          type="button"
          aria-label={`Play: ${label}`}
          onClick={() => setChosen(true)}
          className="absolute inset-0 grid cursor-pointer place-items-center"
        >
          <span className="grid size-14 place-items-center rounded-full bg-black/60 text-white backdrop-blur">
            <Play className="size-6 translate-x-px fill-current" />
          </span>
        </button>
      ) : null}
    </div>
  )
}
