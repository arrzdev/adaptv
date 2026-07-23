declare module "virtual:adaptv/root-route" {
  //Served by adaptv's Vite plugin from adaptv.config.ts. Typed loosely on purpose:
  //the shape is TanStack's root-route object, and re-stating it here would mean
  //maintaining a copy of a type the router already owns.
  export const Route: unknown
}
