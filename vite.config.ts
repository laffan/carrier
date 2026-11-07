import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  // Native builds (tauri dev/build, ios dev/build) need Carrier's Google app
  // registration compiled in, otherwise "Sign in with Google" can't work.
  // The browser preview (`npm run dev`) runs in demo mode and doesn't.
  if (process.env.TAURI_ENV_PLATFORM && !env.VITE_GOOGLE_CLIENT_ID) {
    throw new Error(
      "VITE_GOOGLE_CLIENT_ID is not set. Carrier's one-time Google app registration is missing; see README › “One-time: register Carrier with Google”.",
    );
  }
  return {
    plugins: [svelte()],
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || "127.0.0.1",
      hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
      watch: { ignored: ["**/src-tauri/**"] },
    },
    build: {
      target: "safari16",
    },
    test: {
      environment: "jsdom",
    },
  };
});
