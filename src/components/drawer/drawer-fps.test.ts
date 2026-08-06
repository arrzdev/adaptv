import { describe, expect, it } from "vitest"
import { summarizeFrameGaps } from "#adaptv/components/drawer/drawer-fps"

/*
 * The fps accounting the drawer telemetry reports. A "gap" is the ms between two consecutive
 * painted frames; the verdict is what those gaps say about the run. 60fps = a 16.67ms cadence, and
 * a gap past 1.5 ideal frames (25ms) is one visible hitch.
 */
const IDEAL = 1000 / 60

describe("summarizeFrameGaps", () => {
  it("reads a clean 60fps run as 60fps with nothing dropped", () => {
    //30 frames at the ideal cadence — half a second of smooth motion
    const gaps = Array.from({ length: 30 }, () => IDEAL)
    const s = summarizeFrameGaps("open", gaps)
    expect(s.fps).toBe(60)
    expect(s.droppedFrames).toBe(0)
    expect(s.frames).toBe(30)
    expect(s.label).toBe("open")
  })

  it("counts a long gap as a dropped frame and reports it as the worst", () => {
    //nineteen clean frames and one 50ms stall (three ideal frames) — one hitch
    const gaps = [...Array.from({ length: 19 }, () => IDEAL), 50]
    const s = summarizeFrameGaps("keyboard", gaps)
    expect(s.droppedFrames).toBe(1)
    expect(s.worstFrameMs).toBe(50)
  })

  it("reads a reflow-per-frame run (the thing the FLIP avoids) as low fps", () => {
    //~33ms per frame is 30fps — the max-height-reflow regime the engine's FLIP notes describe
    const gaps = Array.from({ length: 15 }, () => 1000 / 30)
    const s = summarizeFrameGaps("keyboard", gaps)
    expect(s.fps).toBe(30)
    //every frame overran 1.5 ideal → all counted as dropped
    expect(s.droppedFrames).toBe(15)
  })

  it("is safe on an empty run — no frames, no divide-by-zero", () => {
    const s = summarizeFrameGaps("close", [])
    expect(s.fps).toBe(0)
    expect(s.frames).toBe(0)
    expect(s.worstFrameMs).toBe(0)
  })
})
