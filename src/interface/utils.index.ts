//the cubic-bezier tuple every animated adaptv API takes. Exported so a consumer can name the
//type — `ChromeTintOptions["easing"]` works structurally, but a shared curve wants a name.

export * from "../utils/cn"
export type { EasingBezier } from "../utils/easing"
export * from "../utils/platform"
export * from "../utils/styles"
