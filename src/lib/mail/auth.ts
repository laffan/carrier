/**
 * "Sign in with Google", the same way the Gmail app, Apple Mail, Spark and
 * Outlook add Google accounts: Google's own sign-in page opens in the system
 * web-authentication sheet (ASWebAuthenticationSession on iOS/macOS), the
 * user signs in with any personal Gmail or Google Workspace account, and the
 * app receives tokens for that account. Passwords never touch the app.
 *
 * Under the hood this is OAuth 2.0 + PKCE. Like every third-party mail app,
 * Carrier identifies itself to Google with an app ID that is compiled into the
 * build (see GOOGLE_APP_ID below). It is not a secret and is never shown to,
 * or entered by, the person adding an account.
 */
import { base64UrlEncode, httpFetch, isTauri, secretDelete, secretGet, secretSet } from "../platform";
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

/** Carrier's app registration with Google, fixed at build time (vite.config.ts checks it). */
const GOOGLE_APP_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "").trim();

/** Maps Google's error codes to messages a person can act on. */
function friendlyError(code: string, description?: string | null): string {
  switch (code) {
    case "access_denied":
      return "Sign-in was cancelled or access wasn't granted.";
    case "admin_policy_enforced":
    case "org_internal":
      return "Your Google Workspace administrator hasn't allowed Carrier. Ask them to mark it as trusted (Admin console › Security › API controls).";
    case "invalid_grant":
      return "Your sign-in expired. Please sign in again.";
    default:
      return description || code;
  }
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
    throw new AuthError(body.error ? friendlyError(body.error, body.error_description) : `Sign-in failed (${res.status})`);
  }
  return body;
}

/** Shows Google's sign-in page and returns the account that signed in. */
export async function signIn(loginHint?: string): Promise<Identity> {
  if (!isTauri) throw new AuthError("Adding accounts needs the Carrier app; the browser preview runs in demo mode.");
  if (!GOOGLE_APP_ID) throw new AuthError("This build of Carrier wasn't set up for Google sign-in.");
  let tokens = await authorize("select_account", loginHint);
  // Google normally returns a long-lived token for installed apps. If it
  // didn't (e.g. a previous grant exists), ask once more with the consent page.
  if (!tokens.refresh_token) tokens = await authorize("consent", loginHint);
  if (!tokens.id_token || !tokens.refresh_token) throw new AuthError("Google didn't complete the sign-in. Please try again.");
  const claims = decodeJwt(tokens.id_token);
  const identity: Identity = {
    email: String(claims.email).toLowerCase(),
    name: String(claims.name ?? claims.email),
    picture: claims.picture ? String(claims.picture) : undefined,
  };
  await secretSet(`refresh:${identity.email}`, tokens.refresh_token);
  cache.set(identity.email, { token: tokens.access_token, expires: Date.now() + tokens.expires_in * 1000 });
  return identity;
}

async function authorize(prompt: string, loginHint?: string): Promise<TokenResponse> {
  const scheme = redirectScheme(GOOGLE_APP_ID);
  const redirectUri = `${scheme}:/oauth2redirect`;
  const verifier = randomString(48);
  const challenge = base64UrlEncode(await sha256(new TextEncoder().encode(verifier)));
  const state = randomString(16);

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", GOOGLE_APP_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", prompt);
  url.searchParams.set("access_type", "offline");
  if (loginHint) url.searchParams.set("login_hint", loginHint);

  const { start } = await import("tauri-plugin-auth-session-api");
  let callback: string;
  try {
    // Shares Safari's Google session, so accounts already signed in on the
    // device appear in the account picker, as in the Gmail app.
    callback = await start(url.toString(), scheme, { ephemeral: false });
  } catch (e) {
    if (e === "user_cancelled") throw new AuthError("Sign-in cancelled");
    throw new AuthError(String(e));
  }

  const params = new URL(callback.replace(/^[^:]+:/, "https://callback")).searchParams;
  const error = params.get("error");
  if (error) throw new AuthError(friendlyError(error, params.get("error_description")));
  if (params.get("state") !== state) throw new AuthError("Sign-in was interrupted. Please try again.");
  const code = params.get("code");
  if (!code) throw new AuthError("Google didn't complete the sign-in. Please try again.");

  return tokenRequest({
    code,
    client_id: GOOGLE_APP_ID,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
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
        client_id: GOOGLE_APP_ID,
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
