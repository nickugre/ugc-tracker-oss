import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

// Ends with a slash, so "@/lib/x" → "<root>/lib/x".
const root = fileURLToPath(new URL("./", import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      // "server-only" throws when it is imported outside a React Server environment. The stub
      // lets tests import server modules.
      { find: /^server-only$/, replacement: `${root}lib/testing/server-only-stub.ts` },
      { find: /^@\//, replacement: root },
    ],
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "db/**/*.test.ts"],
  },
})
