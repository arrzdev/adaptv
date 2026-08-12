import { defineConfig } from "vitest/config"

//without a config of its own, vitest walks up out of the playground and picks
//up the framework's root config, whose `setupFiles: ["./vitest.setup.ts"]`
//then resolves against this package — where no such file exists. Every other
//playground package that runs tests carries its own config for the same reason.
//
//these are plain scheduling helpers: no DOM, no setup, so node is enough
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
