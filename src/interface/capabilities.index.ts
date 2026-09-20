//Platform-branching device capability accessors (no React). Hooks in
//`@arrzdev/adaptv/hooks` wrap these; import them directly for non-React wiring —
//e.g. feeding `getOnline`/`subscribeOnline` into TanStack Query's `onlineManager`.
//
//🔴 Four of these are named lists rather than `export *` for one shared reason —
//clipboard, keep-awake, orientation and share (theme-color and url-open are the
//fifth and sixth named lists, and each withholds something else; their own notes
//sit beside them). The shared
//reason: a standalone `isXSupported()` predicate is a second way to ask
//clipboard, keep-awake, orientation and share (keyboard and theme-color are named
//lists too, and each withholds something else; its own note is above it). The
//shared reason: a standalone `isXSupported()` predicate is a second way to ask
//a question the surface already answers, so it stays module-internal for the hook
//to use and never reaches a consumer. Both existing answers are better than it —
//`useShare().supported` before you render, `share()` returning `"unsupported"`
//after you call — and a third one only creates the chance for two of them to
//disagree. `capabilities.barrel.test.ts` is what keeps these lists from drifting
//away from the modules the way the component barrels once did.
export * from "../capabilities/app-info"
export * from "../capabilities/app-state"
export * from "../capabilities/back-chain"
export * from "../capabilities/battery"
export * from "../capabilities/browser"
export {
  type ClipboardPermission,
  type ClipboardRead,
  type ClipboardStatus,
  checkClipboardReadPermission,
  readClipboardText,
  writeClipboardText,
} from "../capabilities/clipboard"
export * from "../capabilities/compose"
export * from "../capabilities/device"
export * from "../capabilities/filesystem"
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
//NOT `export *`: `measureKeyboardPayment` and `listenNativeKeyboard` are withheld. They complete
//the keyboard signal with the unpaid part a predicted or held height leaves and keep OS reports
//apart from resizes, and `useKeyboard` is their one owner — the public answers are `unpaidHeight`
//on `KeyboardInfo` and on `useKeyboard()`, and `subscribeNativeKeyboard`. See
//`capabilities.barrel.test.ts`.
export {
  hasNativeKeyboard,
  initNativeKeyboard,
  type KeyboardInfo,
  subscribeNativeKeyboard,
} from "../capabilities/keyboard"
export * from "../capabilities/locale"
export * from "../capabilities/motion"
export * from "../capabilities/native-theme"
export * from "../capabilities/network"
export * from "../capabilities/notifications"
export {
  getScreenOrientation,
  lockScreenOrientation,
  type OrientationLockOutcome,
  type ScreenOrientationLock,
  type ScreenOrientationType,
  subscribeScreenOrientation,
  unlockScreenOrientation,
} from "../capabilities/orientation"
export * from "../capabilities/print"
export * from "../capabilities/privacy-screen"
export * from "../capabilities/screen-reader"
export {
  canShareTarget,
  type ShareOutcome,
  type ShareTarget,
  type StoredFile,
  share,
} from "../capabilities/share"
export * from "../capabilities/speech"
export * from "../capabilities/splash"
export * from "../capabilities/status-bar"
//NOT `export *`: `setThemeColorBase` is withheld. It declares what the app's theme resolves to,
//and `useSyncTheme` is its one owner — a consumer calling it would win until the next theme flip
//and then be silently overwritten. Reading the base is public (`getChromeTintBase`), aiming it is
//not. See `capabilities.barrel.test.ts`.
export {
  type ChromeTintOptions,
  type ChromeTintTransition,
  getChromeTint,
  getChromeTintBase,
  restoreChromeTint,
  setChromeTint,
  subscribeChromeTintBase,
  transitionChromeTint,
} from "../capabilities/theme-color"
//NOT `export *`: `installUrlOpen` is withheld. The router factory attaches the one link listener
//as the router is built, and a consumer calling it would point every link at a second router.
//Hearing links is public (`onUrlOpened`), routing them is not.
export { onUrlOpened, type UrlOpened } from "../capabilities/url-open"
