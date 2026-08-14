//Platform-branching device capability accessors (no React). Hooks in
//`@arrzdev/adaptv/hooks` wrap these; import them directly for non-React wiring —
//e.g. feeding `getOnline`/`subscribeOnline` into TanStack Query's `onlineManager`.
//
//🔴 Four of these are named lists rather than `export *`, and the reason is the
//same in all four: a standalone `isXSupported()` predicate is a second way to ask
//a question the surface already answers, so it stays module-internal for the hook
//to use and never reaches a consumer. Both existing answers are better than it —
//`useShare().supported` before you render, `share()` returning `"unsupported"`
//after you call — and a third one only creates the chance for two of them to
//disagree. `capabilities.barrel.test.ts` is what keeps these lists from drifting
//away from the modules the way the component barrels once did.
export * from "../capabilities/app-state"
export * from "../capabilities/back-chain"
export * from "../capabilities/browser"
export {
  type ClipboardPermission,
  type ClipboardRead,
  type ClipboardStatus,
  checkClipboardReadPermission,
  readClipboardText,
  writeClipboardText,
} from "../capabilities/clipboard"
export * from "../capabilities/device"
export * from "../capabilities/geolocation"
export * from "../capabilities/gesture-controller"
export * from "../capabilities/haptic-tick"
export * from "../capabilities/haptics"
export {
  getKeepAwakeCaveat,
  isKeepAwakeActive,
  type KeepAwakeOutcome,
  releaseKeepAwake,
  requestKeepAwake,
  subscribeKeepAwake,
} from "../capabilities/keep-awake"
export * from "../capabilities/keyboard"
export * from "../capabilities/native-theme"
export * from "../capabilities/network"
export {
  getScreenOrientation,
  lockScreenOrientation,
  type OrientationLockOutcome,
  type ScreenOrientationLock,
  type ScreenOrientationType,
  subscribeScreenOrientation,
  unlockScreenOrientation,
} from "../capabilities/orientation"
export {
  canShareTarget,
  type ShareOutcome,
  type ShareTarget,
  share,
} from "../capabilities/share"
export * from "../capabilities/splash"
export * from "../capabilities/status-bar"
