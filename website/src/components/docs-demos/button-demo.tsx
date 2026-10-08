import { Button, View } from "adaptv/components"
import { useEffect, useState } from "react"

function Spinner() {
  return (
    <span className="block size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
  )
}

export function ButtonDemo() {
  const [pending, setPending] = useState(false)
  const [saves, setSaves] = useState(0)

  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => {
      setPending(false)
      setSaves((count) => count + 1)
    }, 1200)
    return () => clearTimeout(timer)
  }, [pending])

  return (
    <View row className="items-center gap-4">
      <Button
        haptic
        disabled={pending}
        aria-busy={pending}
        onClick={() => setPending(true)}
        className="rounded-xl bg-brand px-4 py-2 font-medium text-[14px] text-white transition-transform active:scale-95 disabled:opacity-70"
      >
        {pending && (
          <Button.Leading className="pe-2">
            <Spinner />
          </Button.Leading>
        )}
        <Button.Text>{pending ? "Saving" : "Save"}</Button.Text>
      </Button>
      <span className="font-mono text-[13px] text-muted">saved: {saves}</span>
    </View>
  )
}
