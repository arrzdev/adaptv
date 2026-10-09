import { defineConfig } from "vitest/config"

//The site's own tests, run by `pnpm --dir website test` (and website.yml), never by
//the framework's gate: they import the built framework through `adaptv` (link:..)
//and the site's `@/` paths, which only this project resolves.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
