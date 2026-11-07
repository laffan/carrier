import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  // Without Carrier's Google app registration the app still runs, but only
  // with sample mail; "Sign in with Google" explains what is missing.
  if (process.env.TAURI_ENV_PLATFORM && !env.VITE_GOOGLE_CLIENT_ID) {
    console.warn(
      "\n[carrier] VITE_GOOGLE_CLIENT_ID is not set: Google sign-in is disabled (sample mail only).\n" +
        "          See README › “One-time: register Carrier with Google”.\n",
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
