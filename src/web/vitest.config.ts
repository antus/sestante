import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/** Test del client: logica in jsdom, componenti con Testing Library. */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
