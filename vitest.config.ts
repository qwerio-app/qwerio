import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "shared",
          include: ["tests/shared/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "web",
          include: ["tests/web/**/*.test.ts"],
          environment: "jsdom",
          setupFiles: ["tests/web/setup.ts"],
        },
      },
      {
        test: {
          name: "desktop",
          include: ["tests/desktop/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
