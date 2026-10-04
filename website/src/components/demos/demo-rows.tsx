//Shared fake content for the in-phone demos: an inbox, because everyone has scrolled one.
export const DEMO_ROWS = [
  ["Inês", "Shipping the build tonight?"],
  ["Tomás", "The keyboard covers the send button again"],
  ["Build bot", "iOS · 1.4.2 (212) is ready to test"],
  ["Marta", "Looks great on the Pixel 🎉"],
  ["Rui", "Can we get the sheet to stop bouncing"],
  ["App Review", "Your submission is in review"],
  ["Sofia", "Dark mode splash is white for a frame"],
  ["Nuno", "Offline works on the train, nice"],
  ["Build bot", "Android · 1.4.2 (212) is ready to test"],
  ["Inês", "Pushing the hotfix over the air"],
  ["Tomás", "All good now 👍"],
  ["Marta", "Same code as the website? Wild."],
] as const

export function DemoAvatar({ name }: { name: string }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft font-semibold text-brand text-[12px]">
      {name.slice(0, 1)}
    </span>
  )
}

export function DemoHeader({ title }: { title: string }) {
  return (
    <div className="shrink-0 border-border border-b px-4 pt-2 pb-2.5 font-semibold text-[15px]">
      {title}
    </div>
  )
}
