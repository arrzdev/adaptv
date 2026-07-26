import tryCatch from "@repo/shared/try-catch"

/** Clipboard API with execCommand fallback for mobile Safari and restricted contexts. */
export function copyToClipboard(text: string): Promise<boolean> {
  //sync first — keeps iOS user-gesture window; async clipboard reject may be too late for execCommand
  if (copyViaExecCommand(text)) return Promise.resolve(true)
  if (!navigator.clipboard?.writeText) return Promise.resolve(false)
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => copyViaExecCommand(text),
  )
}

function copyViaExecCommand(text: string): boolean {
  const [ok, copyErr] = tryCatch(() => {
    const el = document.createElement("textarea")
    el.value = text
    el.setAttribute("readonly", "")
    el.style.position = "fixed"
    el.style.left = "-9999px"
    el.style.top = "0"
    document.body.appendChild(el)
    el.select()
    el.setSelectionRange(0, text.length)
    const result = document.execCommand("copy")
    document.body.removeChild(el)
    return result
  })
  if (copyErr) return false
  return ok === true
}
