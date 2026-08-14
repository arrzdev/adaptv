//Over-the-air updates. Policy is pure and testable (`ota/policy`); the download
//and pointer-flip are rented from @capawesome/capacitor-live-update.
export * from "../ota/policy"
//The `StoreReleaseRequired` type, so an app can hold the value `useStoreRelease`
//hands it. The mutators are adaptv's — the updater is the only thing that knows
//when either is true, and an app calling them would be lying to its own UI.
export type { StoreReleaseRequired } from "../ota/store-release"
export * from "../ota/updater"
