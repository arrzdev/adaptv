import { act, renderHook } from "@testing-library/react"
import { createElement } from "react"
import type { Root } from "react-dom/client"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { createBootstrapGate } from "#adaptv/hooks/create-bootstrap-gate"

/*
 * The gate that holds an app's splash up. A provider resets it when boot work
 * starts (and again on every retry) and sets it when that work lands; the splash
 * reads it through the hook and unmounts itself once it flips. So the store owes
 * its subscribers exactly one notification per real transition — a spurious one
 * re-renders the splash on a no-op, a missing one leaves it up forever.
 */

describe("createBootstrapGate", () => {
  it("starts closed", () => {
    expect(createBootstrapGate().getBootstrapReady()).toBe(false)
  })

  it("opens on set and tells every subscriber exactly once", () => {
    const gate = createBootstrapGate()
    const first = vi.fn()
    const second = vi.fn()
    gate.subscribeBootstrapReady(first)
    gate.subscribeBootstrapReady(second)

    gate.setBootstrapReady()

    expect(gate.getBootstrapReady()).toBe(true)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("has already flipped by the time a subscriber is told", () => {
    //useSyncExternalStore reads the snapshot inside the notification; a store
    //that notifies before it assigns hands React the old value and no re-render
    const gate = createBootstrapGate()
    const seen: boolean[] = []
    gate.subscribeBootstrapReady(() => seen.push(gate.getBootstrapReady()))

    gate.setBootstrapReady()
    gate.resetBootstrapReady()

    expect(seen).toEqual([true, false])
  })

  it("does not notify again when set while already open", () => {
    const gate = createBootstrapGate()
    const listener = vi.fn()
    gate.subscribeBootstrapReady(listener)

    gate.setBootstrapReady()
    gate.setBootstrapReady()

    expect(gate.getBootstrapReady()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("closes on reset and tells every subscriber exactly once", () => {
    const gate = createBootstrapGate()
    gate.setBootstrapReady()
    const first = vi.fn()
    const second = vi.fn()
    gate.subscribeBootstrapReady(first)
    gate.subscribeBootstrapReady(second)

    gate.resetBootstrapReady()

    expect(gate.getBootstrapReady()).toBe(false)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("does not notify when reset while already closed", () => {
    //a provider resets on its very first boot, when the gate has never opened
    const gate = createBootstrapGate()
    const listener = vi.fn()
    gate.subscribeBootstrapReady(listener)

    gate.resetBootstrapReady()
    gate.resetBootstrapReady()

    expect(gate.getBootstrapReady()).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it("opens again after a reset, so a retried boot can finish", () => {
    const gate = createBootstrapGate()
    const listener = vi.fn()
    gate.subscribeBootstrapReady(listener)

    gate.setBootstrapReady()
    gate.resetBootstrapReady()
    gate.setBootstrapReady()

    expect(gate.getBootstrapReady()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it("stops telling a subscriber once it unsubscribes, and only that one", () => {
    const gate = createBootstrapGate()
    const gone = vi.fn()
    const kept = vi.fn()
    const unsubscribe = gate.subscribeBootstrapReady(gone)
    gate.subscribeBootstrapReady(kept)

    unsubscribe()
    gate.setBootstrapReady()
    gate.resetBootstrapReady()

    expect(gone).not.toHaveBeenCalled()
    expect(kept).toHaveBeenCalledTimes(2)
  })

  it("keeps each gate's state and subscribers to itself", () => {
    const a = createBootstrapGate()
    const b = createBootstrapGate()
    const onB = vi.fn()
    b.subscribeBootstrapReady(onB)

    a.setBootstrapReady()

    expect(a.getBootstrapReady()).toBe(true)
    expect(b.getBootstrapReady()).toBe(false)
    expect(onB).not.toHaveBeenCalled()
  })
})

describe("useBootstrapReady", () => {
  it("re-renders its component when the gate opens and closes", () => {
    const gate = createBootstrapGate()
    const { result } = renderHook(() => gate.useBootstrapReady())
    expect(result.current).toBe(false)

    act(() => gate.setBootstrapReady())
    expect(result.current).toBe(true)

    act(() => gate.resetBootstrapReady())
    expect(result.current).toBe(false)
  })

  it("reads an already-open gate on mount", () => {
    const gate = createBootstrapGate()
    gate.setBootstrapReady()
    expect(renderHook(() => gate.useBootstrapReady()).result.current).toBe(
      true,
    )
  })

  it("is false in a server render even when the gate is open", () => {
    //the server's HTML always carries the splash, whatever the gate holds;
    //hydration reads this same snapshot, so even a client that has already
    //booted hydrates against `false` and only then moves to its real value
    const gate = createBootstrapGate()
    gate.setBootstrapReady()
    function Probe() {
      return createElement(
        "output",
        null,
        String(gate.useBootstrapReady()),
      )
    }
    expect(renderToString(createElement(Probe))).toBe(
      "<output>false</output>",
    )
  })

  it("hydrates an already-open gate without a mismatch, then shows true", () => {
    //a module-scope set, or a boot that finished before hydrateRoot ran: the
    //server said `false`, the client already holds `true`
    const gate = createBootstrapGate()
    function Probe() {
      return createElement(
        "output",
        null,
        String(gate.useBootstrapReady()),
      )
    }
    const container = document.createElement("div")
    container.innerHTML = renderToString(createElement(Probe))
    document.body.appendChild(container)
    gate.setBootstrapReady()

    const onRecoverableError = vi.fn()
    let root: Root | undefined
    try {
      act(() => {
        root = hydrateRoot(container, createElement(Probe), {
          onRecoverableError,
        })
      })

      expect(onRecoverableError).not.toHaveBeenCalled()
      expect(container.innerHTML).toBe("<output>true</output>")
    } finally {
      act(() => root?.unmount())
      container.remove()
    }
  })
})
