import { Image, View } from "@arrzdev/adaptv/components"
import { useState } from "react"
import capture from "@/assets/captures/ios-list.png?adaptv-image"

const FITS = ["cover", "contain"] as const

export function ImageDemo() {
  const [fit, setFit] = useState<(typeof FITS)[number]>("cover")
  return (
    <View className="w-full max-w-xs items-center gap-3">
      <Image
        src={capture}
        aspectRatio="4 / 3"
        fit={fit}
        position="top"
        alt="A list screen running on an iPhone"
        className="rounded-2xl border border-border bg-sunken"
      />
      <View row className="items-center gap-3 font-mono text-[13px] text-muted">
        <span>
          {capture.width} × {capture.height}
        </span>
        {FITS.map((value) => (
          <label key={value} className="flex items-center gap-1">
            <input
              type="radio"
              name="image-demo-fit"
              checked={fit === value}
              onChange={() => setFit(value)}
            />
            {value}
          </label>
        ))}
      </View>
    </View>
  )
}
