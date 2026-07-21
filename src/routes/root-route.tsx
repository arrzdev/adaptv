/**
 * The app's root route. **A real module in the framework, not a generated file.**
 *
 * This is the file TanStack's route generator resolves as the root of the tree.
 * It used to be stamped into every consumer's repo as `.nativ/root.gen.tsx` —
 * containing `createRootRoute(<their config>)` and static imports of their
 * splash / not-found / offline components — even though almost all of it was
 * framework code.
 *
 * The app-specific half (config values, component specifiers) arrives through the
 * `virtual:nativ/root-route` module that nativ's Vite plugin serves. Nothing is
 * written into the consumer's tree, and the framework's own opinions live here,
 * where changing one does not require every app to rebuild before it takes
 * effect.
 */
export { Route } from "virtual:nativ/root-route"
