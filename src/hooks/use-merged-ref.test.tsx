import { render } from "@testing-library/react"
import type { Ref } from "react"
import { createRef, useRef } from "react"
import { describe, expect, it } from "vitest"
import { AvoidKeyboard } from "#adaptv/components/avoid-keyboard/avoid-keyboard"
import { Text } from "#adaptv/components/text"
import { useMergedRef } from "#adaptv/hooks/use-merged-ref"

function Host({ refs }: { refs: Array<Ref<HTMLDivElement> | undefined> }) {
  const local = useRef<HTMLDivElement | null>(null)
  const merged = useMergedRef(local, ...refs)
  return <div ref={merged} data-testid="host" />
}

describe("useMergedRef", () => {
  it("feeds the local ref and every forwarded ref, and clears them on unmount", () => {
    const object = createRef<HTMLDivElement>()
    const seen: Array<HTMLDivElement | null> = []
    const callback: Ref<HTMLDivElement> = (node) => {
      seen.push(node)
    }
    const { getByTestId, unmount } = render(
      <Host refs={[object, callback, undefined]} />,
    )
    const node = getByTestId("host")
    expect(object.current).toBe(node)
    unmount()
    expect(object.current).toBeNull()
    expect(seen).toEqual([node, null])
  })

  it("runs a React 19 callback-ref cleanup instead of calling that ref with null", () => {
    const log: string[] = []
    const withCleanup: Ref<HTMLDivElement> = (node) => {
      log.push(node ? "attach" : "null")
      return () => {
        log.push("cleanup")
      }
    }
    const { unmount } = render(<Host refs={[withCleanup]} />)
    unmount()
    expect(log).toEqual(["attach", "cleanup"])
  })

  //The components that merge a consumer ref through this hook, mounted for real. A
  //plain <Text> forwards the ref untouched and never went through the merge.
  describe("through its callers", () => {
    const tracked =
      <T,>(log: string[]): Ref<T> =>
      (node) => {
        log.push(node ? "attach" : "null")
        return () => {
          log.push("cleanup")
        }
      }

    it("<Text scaleWithSystem> runs a consumer ref's cleanup on unmount", () => {
      const log: string[] = []
      const { unmount } = render(
        <Text scaleWithSystem ref={tracked<HTMLSpanElement>(log)}>
          hi
        </Text>,
      )
      unmount()
      expect(log).toEqual(["attach", "cleanup"])
    })

    it("<AvoidKeyboard> runs a consumer ref's cleanup on unmount", () => {
      const log: string[] = []
      const { unmount } = render(
        <AvoidKeyboard ref={tracked<HTMLDivElement>(log)}>
          hi
        </AvoidKeyboard>,
      )
      unmount()
      expect(log).toEqual(["attach", "cleanup"])
    })
  })
})
