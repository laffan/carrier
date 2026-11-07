/**
 * Thin wrapper over the host. Inside Tauri we use native plugins (HTTP without
 * CORS, Keychain, file system, system browser). In a plain browser the app runs
 * in demo mode with the in-memory backend, so the UI can be developed without
 * a Google account.
 */
import { invoke } from "@tauri-apps/api/core";

export const isTauri: boolean =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const isApple: boolean =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

export async function httpFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isTauri) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    return fetch(input, init);
  }
  return fetch(input, init);
}

// ---- secrets (Keychain on Apple platforms) -------------------------------

export async function secretGet(key: string): Promise<string | null> {
  if (isTauri) return (await invoke<string | null>("secret_get", { key })) ?? null;
  return localStorage.getItem(`secret:${key}`);
}

export async function secretSet(key: string, value: string): Promise<void> {
  if (isTauri) return invoke("secret_set", { key, value });
  localStorage.setItem(`secret:${key}`, value);
}

export async function secretDelete(key: string): Promise<void> {
  if (isTauri) return invoke("secret_delete", { key });
  localStorage.removeItem(`secret:${key}`);
}

// ---- persistent key/value -------------------------------------------------

type StoreLike = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  save(): Promise<void>;
};

let storePromise: Promise<StoreLike> | null = null;

function store(): Promise<StoreLike> {
  if (!storePromise) {
    storePromise = (async () => {
      if (isTauri) {
        const { load } = await import("@tauri-apps/plugin-store");
        return (await load("carrier.json", { autoSave: 200, defaults: {} })) as unknown as StoreLike;
      }
      return {
        async get<T>(key: string) {
          const v = localStorage.getItem(`kv:${key}`);
          return v == null ? undefined : (JSON.parse(v) as T);
        },
        async set(key: string, value: unknown) {
          localStorage.setItem(`kv:${key}`, JSON.stringify(value));
        },
        async delete(key: string) {
          localStorage.removeItem(`kv:${key}`);
          return true;
        },
        async save() {},
      };
    })();
  }
  return storePromise;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await store()).get<T>(key);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await store()).set(key, value);
}

export async function kvDelete(key: string): Promise<void> {
  await (await store()).delete(key);
}

// ---- small, best-effort cache (may be evicted by the OS) -----------------

export function cacheGet<T>(key: string): T | undefined {
  try {
    const v = localStorage.getItem(`cache:${key}`);
    return v == null ? undefined : (JSON.parse(v) as T);
  } catch {
    return undefined;
  }
}

export function cacheSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(`cache:${key}`, JSON.stringify(value));
  } catch {
    /* quota or private mode: ignore */
  }
}

// ---- system integration ---------------------------------------------------

export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

/** Saves base64 data to Downloads (desktop) or the app's Files folder (iOS). Returns the path. */
export async function saveFile(name: string, base64: string, mimeType: string): Promise<string> {
  if (isTauri) {
    const path = await invoke<string>("save_file", { name, base64 });
    return path;
  }
  const blob = new Blob([base64ToBytes(base64) as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

export async function revealFile(path: string): Promise<void> {
  if (!isTauri) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

export const isIOS: boolean =
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1));

// ---- encoding helpers -----------------------------------------------------

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, ""));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function utf8ToBase64(s: string): string {
  return bytesToBase64(new TextEncoder().encode(s));
}
