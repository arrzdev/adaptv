import { useReducedMotion } from "adaptv/hooks"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/utils/cn"

/*
 * Media for the /lab/visuals review page. Everything lives under public/lab/ and is made by
 * the scripts in website/scripts/lab/. Each asset has a WebP and an AVIF still (a video's
 * still is its poster) and, if it moves, an H.264 MP4 and a VP9 WebM.
 */

export type LabAsset = {
  /** Path under /lab/, without the extension: `footage/hero-site`. */
  src: string
  width: number
  height: number
  /** A video: MP4 + WebM next to the stills. */
  video?: boolean
  alt: string
}

/**
 * A muted loop that loads nothing until it scrolls near the screen, then plays while it is
 * on screen. Under reduced motion it never loads: the poster is the picture. Width and
 * height are on the element, so nothing moves when it loads.
 */
export function LabVideo({
  asset,
  className,
}: {
  asset: LabAsset
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const reduce = useReducedMotion()
  const [near, setNear] = useState(false)

  useEffect(() => {
    const video = ref.current
    if (!video || reduce) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (entry.isIntersecting) {
          setNear(true)
          video.play().catch(() => {})
        } else video.pause()
      },
      { rootMargin: "200px 0px" },
    )
    observer.observe(video)
    return () => observer.disconnect()
  }, [reduce])

  //the sources arrive with `near`: a <video> picks its source when it loads, so load again
  useEffect(() => {
    const video = ref.current
    if (!video || !near) return
    video.load()
    video.play().catch(() => {})
  }, [near])

  return (
    <video
      ref={ref}
      className={cn("block h-auto w-full", className)}
      width={asset.width}
      height={asset.height}
      poster={`/lab/${asset.src}.webp`}
      aria-label={asset.alt}
      muted
      playsInline
      loop
      autoPlay={near}
      preload="none"
    >
      {near ? (
        <>
          <source src={`/lab/${asset.src}.webm`} type="video/webm" />
          <source src={`/lab/${asset.src}.mp4`} type="video/mp4" />
        </>
      ) : null}
    </video>
  )
}

/** A still: AVIF where the browser takes it, WebP otherwise. */
export function LabStill({
  asset,
  className,
}: {
  asset: LabAsset
  className?: string
}) {
  return (
    <picture>
      <source srcSet={`/lab/${asset.src}.avif`} type="image/avif" />
      <img
        className={cn("block h-auto w-full", className)}
        src={`/lab/${asset.src}.webp`}
        width={asset.width}
        height={asset.height}
        alt={asset.alt}
        loading="lazy"
        decoding="async"
      />
    </picture>
  )
}

export function LabMedia({
  asset,
  className,
}: {
  asset: LabAsset
  className?: string
}) {
  return asset.video ? (
    <LabVideo asset={asset} className={className} />
  ) : (
    <LabStill asset={asset} className={className} />
  )
}
