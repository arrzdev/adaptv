//An adaptv subpath that hands the app Start's server-function factory. None ships
//today; this is the shape the build must still refuse if one ever did, or if a
//library the app installs does the same (`@tanstack/react-form-start` does).
export { createServerFn } from "@tanstack/react-start"
