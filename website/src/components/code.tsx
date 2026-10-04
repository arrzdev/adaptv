import { View } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import { Check, Copy } from "lucide-react"
import { type ReactNode, useState } from "react"

/*
 * A deliberately small highlighter. It knows comments, strings, a keyword list, JSX
 * tags and call sites — enough for the snippets on this site, and it renders on the
 * server with no async step, so the code is in the HTML a crawler reads. When the docs
 * grow a real content pipeline this is the piece a proper grammar replaces.
 */
const KEYWORDS =
  /^(import|export|from|default|const|let|function|return|type|interface|if|else|async|await|new|true|false|null|undefined)$/

const TOKEN =
  /(\/\/[^\n]*|#[^\n]*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(<\/?[A-Za-z][\w.]*|\/?>)|([A-Za-z_$][\w$]*)(?=\()|([A-Za-z_$][\w$]*)/gm

function highlight(source: string, lang: CodeLang): ReactNode[] {
  if (lang === "text") return [source]
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of source.matchAll(TOKEN)) {
    const [text, comment, string, tag, fn, word] = match
    const at = match.index
    if (at > last) out.push(source.slice(last, at))
    last = at + text.length
    //`#` opens a comment in a shell snippet and nothing at all in TypeScript
    const isComment = comment && (lang === "bash" || comment.startsWith("//"))
    const cls = isComment
      ? "tok-c"
      : string
        ? "tok-s"
        : tag && lang === "tsx"
          ? "tok-t"
          : fn
            ? "tok-f"
            : word && KEYWORDS.test(word)
              ? "tok-k"
              : null
    out.push(
      cls ? (
        <span key={key++} className={cls}>
          {text}
        </span>
      ) : (
        text
      ),
    )
  }
  if (last < source.length) out.push(source.slice(last))
  return out
}

export type CodeLang = "tsx" | "ts" | "bash" | "text"

export type CodeSample = {
  /** Shown in the tab / title bar — a filename, or "Terminal". */
  label: string
  lang: CodeLang
  code: string
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label="Copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        })
      }}
      className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-code-muted hover:bg-white/5 hover:text-code-fg"
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </button>
  )
}

/** One or more samples in a single dark panel; more than one becomes tabs. */
export function CodePanel({
  samples,
  className,
}: {
  samples: CodeSample[]
  className?: string
}) {
  const [active, setActive] = useState(0)
  const sample = samples[active] ?? samples[0]
  if (!sample) return null
  return (
    <View
      className={cn(
        "selectable overflow-hidden rounded-2xl border border-white/10 bg-code-bg shadow-2xl shadow-black/20",
        className,
      )}
    >
      <View
        row
        className="items-center justify-between border-white/10 border-b pr-2 pl-3"
      >
        <View row className="min-w-0 overflow-x-auto">
          {samples.map((item, index) => (
            <button
              key={item.label}
              type="button"
              onClick={() => setActive(index)}
              className={cn(
                "cursor-pointer whitespace-nowrap border-b-2 px-3 py-3 font-mono text-[12.5px]",
                index === active
                  ? "border-(--code-keyword) text-code-fg"
                  : "border-transparent text-code-muted hover:text-code-fg",
              )}
            >
              {item.label}
            </button>
          ))}
        </View>
        <CopyButton text={sample.code} />
      </View>
      <pre className="overflow-x-auto p-5 font-mono text-[13px] text-code-fg leading-[1.7]">
        <code>{highlight(sample.code, sample.lang)}</code>
      </pre>
    </View>
  )
}
