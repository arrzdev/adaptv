import { useEffect, useRef } from "react"
import { cn } from "@/utils/cn"

/**
 * A short muted screen recording that loops, from `public/media/<name>.{webm,mp4,webp}`. It is
 * decoration: the text beside it carries the meaning, so it is hidden from assistive tech and
 * has no controls.
 *
 * It ships without `autoplay` and loads nothing until it plays: it plays only while it is on
 * screen, the tab is visible and the reader has not asked for reduced motion. Otherwise it
 * shows its poster, a still of the clip. Its box comes from the parent (an aspect ratio), so
 * the video arriving moves nothing.
 */
export function LoopVideo({
  name,
  className,
}: {
  /** The clip's file name in `public/media`, without extension. */
  name: string
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (!video || typeof IntersectionObserver === "undefined") return
    //the property, not only the attribute: a browser plays inline only what is muted
    video.muted = true
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)")
    let onScreen = false
    const sync = () => {
      if (onScreen && !document.hidden && !reduce.matches)
        video.play().catch(() => {})
      else video.pause()
    }
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      sync()
    })
    observer.observe(video)
    document.addEventListener("visibilitychange", sync)
    reduce.addEventListener("change", sync)
    return () => {
      observer.disconnect()
      document.removeEventListener("visibilitychange", sync)
      reduce.removeEventListener("change", sync)
    }
  }, [])
  //hidden on a wrapper: a <video> counts as focusable, so it may not carry aria-hidden itself
  return (
    <div aria-hidden="true" className="size-full">
      <video
        ref={ref}
        data-loop-video={name}
        className={cn("block size-full object-cover", className)}
        poster={`/media/${name}.webp`}
        muted
        loop
        playsInline
        preload="none"
        disablePictureInPicture
        disableRemotePlayback
      >
        <source src={`/media/${name}.webm`} type="video/webm" />
        <source src={`/media/${name}.mp4`} type="video/mp4" />
      </video>
    </div>
  )
}
