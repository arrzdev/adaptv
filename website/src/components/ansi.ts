/*
 * A terminal small enough to replay what the adaptv CLI prints: SGR styles (bold, dim,
 * the 8 colours and their bright pair), carriage return, line feed, cursor up, cursor to
 * column, erase line and erase below. Anything else (cursor show/hide) moves nothing.
 *
 * The CLI redraws its live rows by erasing them and printing them again, so the screen
 * just before each erase is one frame. The last frame is the settled one.
 */

export type Style = { bold: boolean; dim: boolean; fg: number | null }
export type Run = Style & { text: string }
export type Frame = Run[][]

type Cell = { ch: string; style: Style }

const PLAIN: Style = { bold: false, dim: false, fg: null }
// biome-ignore lint/suspicious/noControlCharactersInRegex: an escape sequence starts with ESC
const TOKEN = /\x1b\[([0-9;?]*)([A-Za-z])|[\s\S]/gu

function sgr(style: Style, params: string): Style {
  let next = { ...style }
  for (const code of (params || "0").split(";").map(Number)) {
    if (code === 0) next = { ...PLAIN }
    else if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    else if (code === 22) next = { ...next, bold: false, dim: false }
    else if (code === 39) next.fg = null
    else if (code >= 30 && code <= 37) next.fg = code - 30
    else if (code >= 90 && code <= 97) next.fg = code - 90 + 8
  }
  return next
}

const same = (a: Style, b: Style) =>
  a.bold === b.bold && a.dim === b.dim && a.fg === b.fg

function toFrame(screen: Cell[][]): Frame {
  return screen.map((row) => {
    const runs: Run[] = []
    for (const cell of row) {
      const last = runs.at(-1)
      if (last && same(last, cell.style)) last.text += cell.ch
      else runs.push({ ...cell.style, text: cell.ch })
    }
    //trailing blanks are the erased end of a line, not output
    const tail = runs.at(-1)
    if (tail) tail.text = tail.text.trimEnd()
    return runs.filter((run) => run.text !== "")
  })
}

export const frameText = (frame: Frame) =>
  frame.map((line) => line.map((run) => run.text).join("")).join("\n")

/** Every frame the stream drew, oldest first, without the blank rows below it. */
export function parseAnsi(stream: string): Frame[] {
  const screen: Cell[][] = [[]]
  let row = 0
  let col = 0
  let style = { ...PLAIN }
  const frames: Frame[] = []
  let shown = ""

  const line = () => {
    while (screen.length <= row) screen.push([])
    return screen[row] as Cell[]
  }
  const snapshot = () => {
    const frame = toFrame(screen)
    const text = frameText(frame)
    if (text !== shown) frames.push(frame)
    shown = text
  }

  for (const [token, params, command] of stream.matchAll(TOKEN)) {
    if (command) {
      const n = Number(params) || 1
      if (command === "m") style = sgr(style, params ?? "")
      else if (command === "A") row = Math.max(0, row - n)
      else if (command === "G") col = n - 1
      else if (command === "K" || command === "J") {
        snapshot()
        line().length = Math.min(line().length, params === "2" ? 0 : col)
        if (command === "J") screen.length = row + 1
      }
    } else if (token === "\r") col = 0
    else if (token === "\n") {
      row += 1
      line()
    } else if (token >= " ") {
      const cells = line()
      while (cells.length < col) cells.push({ ch: " ", style: PLAIN })
      cells[col] = { ch: token, style }
      col += 1
    }
  }
  snapshot()

  //trailing rows are where the cursor waited, not output
  return frames.map((frame) => {
    let end = frame.length
    while (end > 0 && frame[end - 1]?.length === 0) end -= 1
    return frame.slice(0, end)
  })
}

//the braille block, where every spinner frame comes from
const SPINNER = /[\u2800-\u28ff]/gu

/**
 * The frames worth replaying: a few consecutive spinner turns of every stage the CLI
 * passed through, in order, then every settled frame. About `budget` frames in all.
 */
export function replayFrames(frames: Frame[], budget = 18): Frame[] {
  const stages: Frame[][] = []
  let key: string | null = null
  for (const frame of frames) {
    const next = frameText(frame).replace(SPINNER, "")
    if (next !== key) stages.push([])
    stages.at(-1)?.push(frame)
    key = next
  }
  const turning = stages.filter((stage) => stage.length > 1).length
  const each = Math.max(2, Math.floor(budget / Math.max(1, turning)))
  return stages.flatMap((stage) => stage.slice(0, each))
}
