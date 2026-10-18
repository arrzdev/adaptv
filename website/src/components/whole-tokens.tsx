/**
 * Keeps each hyphenated token (`theme-color`, `0.1.0-alpha.0`) on one line: browsers
 * break after a hyphen, and `text-balance` made a title end a line on "theme-".
 */
export function WholeTokens({ text }: { text: string }) {
  return text.split(/(\S+-\S+)/).map((part, index) =>
    index % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts never reorder
      <span key={index} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  )
}
