declare module "virtual:nativ/root-route" {
  //Served by nativ's Vite plugin from nativ.config.ts. Typed loosely on purpose:
  //the shape is TanStack's root-route object, and re-stating it here would mean
  //maintaining a copy of a type the router already owns.
  export const Route: unknown
}
