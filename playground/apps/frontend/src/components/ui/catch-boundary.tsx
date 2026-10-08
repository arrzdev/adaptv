import { ScrollView, Text, View } from "adaptv/components"
import { AlertCircle, Check, Copy } from "lucide-react"
import type { ErrorInfo } from "react"
import { Component, useState } from "react"
import { IconButton } from "@/components/ui/icon-button"
import { SecondaryButton } from "@/components/ui/secondary-button"
import { copyToClipboard } from "@/utils/copy-to-clipboard"

const isDev = import.meta.env.DEV

export interface CatchBoundaryErrorComponentProps {
  error: unknown
  errorInfo?: ErrorInfo | null
  reset: () => void
}

export type CatchBoundaryErrorComponent = (
  props: CatchBoundaryErrorComponentProps,
) => React.ReactNode

function getTraceText(
  error: unknown,
  errorInfo?: ErrorInfo | null,
): string {
  const parts: string[] = []
  const message = error instanceof Error ? error.message : String(error)
  parts.push("Error: ", message)
  if (error instanceof Error && error.stack) {
    parts.push("\n\n", error.stack)
  }
  if (errorInfo?.componentStack) {
    parts.push("\n\nComponent stack:\n", errorInfo.componentStack)
  }
  return parts.join("")
}

const DefaultErrorComponent = ({
  error,
  errorInfo,
  reset,
}: CatchBoundaryErrorComponentProps) => {
  const [copied, setCopied] = useState(false)

  const showTrace = isDev
  const traceText = showTrace ? getTraceText(error, errorInfo) : ""
  //raw error text can leak technical strings (e.g. "NetworkError when
  //attempting to fetch resource."), so only surface it in dev. prod gets a
  //generic next-step line.
  const message =
    isDev && error instanceof Error && error.message
      ? error.message
      : "Please try again in a moment."

  const handleCopy = async () => {
    if (!traceText) return
    const ok = await copyToClipboard(traceText)
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 2000)
  }

  return (
    <View className="z-1000 flex min-h-0 w-full flex-1 flex-col items-center justify-center overflow-hidden bg-background px-safe-offset-6 py-safe-offset-6">
      <View className="mx-auto flex w-full max-w-sm shrink-0 flex-col gap-4 sm:max-w-md">
        <View className="flex shrink-0 flex-col items-center gap-3 text-center md:gap-4">
          <AlertCircle className="h-10 w-10 shrink-0 text-muted sm:h-12 sm:w-12 md:h-14 md:w-14" />
          <Text
            // biome-ignore lint/a11y/useHeadingContent: the heading text flows through Text's render prop into the h1 at runtime (cloneElement), which the static check can't see
            render={<h1 />}
            className="font-sans text-base font-bold tracking-tight text-foreground sm:text-lg md:text-xl"
          >
            Something went wrong
          </Text>
          <Text
            render={<p />}
            className="max-w-prose text-sm wrap-break-word text-muted sm:text-[15px]"
          >
            {message}
          </Text>
          <SecondaryButton onClick={reset}>Retry</SecondaryButton>
        </View>

        {showTrace && traceText && (
          <View className="relative w-full shrink-0">
            {/* the max-height caps the block; ScrollView is what makes the
                overflow reachable rather than clipped, and it contains the
                overscroll so a fling at the end of a long stack does not drag
                the screen behind it */}
            <ScrollView
              data-trace-logs
              className="max-h-[min(36dvh,18rem)] rounded-lg border border-border bg-surface p-3 pr-10 sm:max-h-[min(40dvh,20rem)] sm:p-4 sm:pr-11"
            >
              <Text
                render={<pre />}
                className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap wrap-break-word text-muted sm:text-xs"
              >
                {traceText}
              </Text>
            </ScrollView>
            <IconButton
              onClick={handleCopy}
              className="absolute top-2 right-2 size-7 text-muted sm:size-8"
              aria-label={copied ? "Copied" : "Copy trace"}
              title={copied ? "Copied" : "Copy trace"}
            >
              {copied && (
                <Check className="h-3.5 w-3.5 text-primary sm:h-4 sm:w-4" />
              )}
              {!copied && <Copy className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
            </IconButton>
          </View>
        )}
      </View>
    </View>
  )
}

export interface CatchBoundaryProps {
  getResetKey: () => string
  children: React.ReactNode
  errorComponent?: CatchBoundaryErrorComponent
  onCatch?: (error: unknown) => void
}

interface ErrorBoundaryInnerState {
  error: unknown
  errorInfo: ErrorInfo | null
}

class ErrorBoundaryInner extends Component<
  {
    resetKey: string
    errorComponent: CatchBoundaryErrorComponent
    onCatch?: (error: unknown) => void
    children: React.ReactNode
  },
  ErrorBoundaryInnerState
> {
  state: ErrorBoundaryInnerState = { error: null, errorInfo: null }

  static getDerivedStateFromError(
    error: unknown,
  ): Partial<ErrorBoundaryInnerState> {
    return { error }
  }

  componentDidCatch(_error: unknown, errorInfo: ErrorInfo) {
    this.props.onCatch?.(_error)
    this.setState({ errorInfo })
  }

  componentDidUpdate(prev: { resetKey: string }) {
    //clear error state when reset key changes (e.g. route change) so we don't remount the tree
    if (prev.resetKey !== this.props.resetKey) this.reset()
  }

  reset = () => {
    this.setState({ error: null, errorInfo: null })
  }

  render() {
    const { error, errorInfo } = this.state
    const { errorComponent, children } = this.props

    if (error !== null) {
      return errorComponent({
        error,
        errorInfo: errorInfo ?? undefined,
        reset: this.reset,
      })
    }

    return children
  }
}

export const CatchBoundary = ({
  getResetKey,
  children,
  errorComponent = (props) => <DefaultErrorComponent {...props} />,
  onCatch,
}: CatchBoundaryProps) => {
  const resetKey = getResetKey()
  return (
    <ErrorBoundaryInner
      resetKey={resetKey}
      errorComponent={errorComponent}
      onCatch={onCatch}
    >
      {children}
    </ErrorBoundaryInner>
  )
}
