/**
 * Google OAuth 2.0 for native apps: authorization code + PKCE, using an
 * "iOS" OAuth client (no client secret). The consent screen is shown with
 * ASWebAuthenticationSession (tauri-plugin-auth-session) on iOS and macOS.
 */
import { base64UrlEncode, httpFetch, isTauri, kvGet, secretDelete, secretGet, secretSet } from "../platform";
import { sha256 } from "./sha256";

export const SCOPES = [
  "openid",
  "email",
  "profile",
  // Full Gmail access: needed for "Delete forever" / "Empty trash", like Gmail.
  "https://mail.google.com/",
  // Recipient autocomplete from Google Contacts and "Other contacts".
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
];

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly account?: string,
  ) {
    super(message);
  }
}

export interface Identity {
  email: string;
  name: string;
  picture?: string;
}

export async function getClientId(): Promise<string> {
  const fromSettings = await kvGet<string>("googleClientId");
  const id = (fromSettings || import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
  return id;
}

function redirectScheme(clientId: string): string {
  return "com.googleusercontent.apps." + clientId.replace(/\.apps\.googleusercontent\.com$/, "");
}

function randomString(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return base64UrlEncode(a);
}

function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split(".")[1] ?? "";
  const json = atob(part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4));
  const bytes = Uint8Array.from(json, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await httpFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json()) as TokenResponse;
  if (!res.ok || body.error) {
    throw new AuthError(body.error_description || body.error || `Token request failed (${res.status})`);
  }
  return body;
}

/** Runs the interactive sign-in. Returns the identity of the account that signed in. */
export async function signIn(loginHint?: string): Promise<Identity> {
  if (!isTauri) throw new AuthError("Sign-in requires the Carrier app (running in demo mode).");
  const clientId = await getClientId();
  if (!clientId) throw new AuthError("No Google OAuth client ID configured. See Settings › Developer.");

  const scheme = redirectScheme(clientId);
  const redirectUri = `${scheme}:/oauth2redirect`;
  const verifier = randomString(48);
  const challenge = base64UrlEncode(await sha256(new TextEncoder().encode(verifier)));
  const state = randomString(16);

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account consent");
  url.searchParams.set("access_type", "offline");
  if (loginHint) url.searchParams.set("login_hint", loginHint);

  const { start } = await import("tauri-plugin-auth-session-api");
  let callback: string;
  try {
    callback = await start(url.toString(), scheme, { ephemeral: false });
  } catch (e) {
    if (e === "user_cancelled") throw new AuthError("Sign-in cancelled");
    throw new AuthError(String(e));
  }

  const params = new URL(callback.replace(/^[^:]+:/, "https://callback")).searchParams;
  if (params.get("error")) throw new AuthError(params.get("error")!);
  if (params.get("state") !== state) throw new AuthError("Sign-in state mismatch");
  const code = params.get("code");
  if (!code) throw new AuthError("No authorization code returned");

  const tokens = await tokenRequest({
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  if (!tokens.id_token) throw new AuthError("No identity returned");
  const claims = decodeJwt(tokens.id_token);
  const identity: Identity = {
    email: String(claims.email).toLowerCase(),
    name: String(claims.name ?? claims.email),
    picture: claims.picture ? String(claims.picture) : undefined,
  };
  if (!tokens.refresh_token) throw new AuthError("Google did not return a refresh token");
  await secretSet(`refresh:${identity.email}`, tokens.refresh_token);
  cache.set(identity.email, { token: tokens.access_token, expires: Date.now() + tokens.expires_in * 1000 });
  return identity;
}

const cache = new Map<string, { token: string; expires: number }>();
const inflight = new Map<string, Promise<string>>();

export async function accessToken(email: string, force = false): Promise<string> {
  const c = cache.get(email);
  if (!force && c && c.expires - 60_000 > Date.now()) return c.token;
  const pending = inflight.get(email);
  if (pending) return pending;
  const p = (async () => {
    const refresh = await secretGet(`refresh:${email}`);
    if (!refresh) throw new AuthError("Signed out", email);
    try {
      const t = await tokenRequest({
        client_id: await getClientId(),
        refresh_token: refresh,
        grant_type: "refresh_token",
      });
      cache.set(email, { token: t.access_token, expires: Date.now() + t.expires_in * 1000 });
      return t.access_token;
    } catch (e) {
      if (e instanceof AuthError) throw new AuthError(e.message, email);
      throw e;
    }
  })();
  inflight.set(email, p);
  try {
    return await p;
  } finally {
    inflight.delete(email);
  }
}

export async function signOut(email: string): Promise<void> {
  const refresh = await secretGet(`refresh:${email}`);
  cache.delete(email);
  await secretDelete(`refresh:${email}`);
  if (refresh) {
    httpFetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, {
      method: "POST",
    }).catch(() => {});
  }
}
