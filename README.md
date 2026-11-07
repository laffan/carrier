# Carrier

A minimal Gmail client for iPad (and macOS), built with [Tauri 2](https://tauri.app) and Svelte 5.

Version 0.1 aims to match the everyday Gmail app with less on screen. The one deliberate difference is that **you write mail in Markdown**. When you send, Carrier renders it to rich HTML and includes the Markdown source as the plain-text part.

## Running it

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the UI in a browser at http://127.0.0.1:1420 in **demo mode**, with two in-memory accounts and no Google sign-in. Use this to work on the interface. |
| `npm run tauri dev` | Runs the macOS desktop app with real Gmail (needs the one-time registration below). |
| `npm run tauri ios dev` | Runs on an iPad simulator or a connected iPad (setup below). |
| `npm test` | Unit tests for MIME, Markdown, address parsing and PKCE. |
| `npm run check` | Type-checks the Svelte and TypeScript code. |

## Setup

### 1. Tooling (macOS)

- Xcode, with the iOS platform installed
- Rust (`rustup`) and the iOS targets:

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
```

- Node 20 or newer, then:

```bash
npm install
```

### 2. One-time: register Carrier with Google

**Adding an account** works the way it does in the Gmail app or Apple Mail. You tap **Sign in with Google**, Google's own sign-in page opens in the system sheet, and you sign in with any personal Gmail or Google Workspace account (including 2-step verification and passkeys). You never enter a client ID, password or server setting, and you can add as many accounts as you want.

To show that sign-in page, Google requires every third-party mail app to identify itself with an **app ID**, which is compiled into the app. Apple Mail, Spark and Outlook each have one built in. Carrier needs its own, created **once by whoever builds the app**. It is not a secret and is not something users handle. Borrowing another app's ID is against Google's terms, so Carrier doesn't.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project, for example "Carrier".
2. Enable the **Gmail API** and the **People API**. People is used for recipient autocomplete; if it's disabled, Carrier falls back to addresses it has seen.
3. Under **Google Auth Platform › Branding / Audience**, set the app name to "Carrier", choose user type **External**, then set the publishing status to **In production**. Don't submit for verification.
4. Under **Data access**, add these scopes: `https://mail.google.com/`, `.../auth/contacts.readonly`, `.../auth/contacts.other.readonly`, `openid`, `email` and `profile`.
5. Under **Clients**, create a client: type **iOS**, bundle ID `app.carrier.mail` (the `identifier` in `src-tauri/tauri.conf.json`). The same ID also works for the macOS build.
6. Put the ID in `.env`. `tauri dev`, `tauri build` and the `ios` commands refuse to build without it:

```bash
cp .env.example .env
# VITE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
```

**What this means for sign-in**

- **Personal Gmail accounts.** Google's sign-in shows a one-time "Google hasn't verified this app" notice; tap *Advanced › Go to Carrier*. After that, accounts stay signed in.
- **Workspace accounts.** Sign-in works the same way unless the organisation's admin restricts third-party apps. In that case Google shows "Access blocked" and Carrier asks you to have the admin mark Carrier as trusted (Admin console › Security › API controls). Apple Mail and Spark face the same restriction.
- **Why "In production".** If the status is left on "Testing" instead, every account must be listed as a test user and is signed out every 7 days.
- **Removing the notice.** An unverified app can be used by up to 100 Google accounts. Getting rid of the notice, or distributing Carrier publicly, requires Google's verification. Because `https://mail.google.com/` is a "restricted" scope, that verification includes a paid third-party security assessment.

### 3. iPad

```bash
npm run tauri ios init      # generates src-tauri/gen/apple (Xcode project)
npm run tauri ios dev       # simulator, or choose a connected iPad
```

After `ios init`, run `npx tauri icon app-icon.svg` so the Xcode project gets Carrier's icon.

Set your signing team in `src-tauri/tauri.conf.json` under `bundle.iOS.developmentTeam`, or with the `APPLE_DEVELOPMENT_TEAM` environment variable. `src-tauri/Info.ios.plist` is merged into the generated Info.plist. It makes saved attachments appear in *Files › On My iPad › Carrier*.

## Features

### Implemented (Gmail parity)

- **Accounts.** Sign in with Google, for multiple personal and Workspace accounts, with an *All inboxes* view, an account switcher, and a re-sign-in prompt when a token is revoked.
- **Mailboxes.** Primary, Social, Promotions, Updates, Forums, Starred, Important, Sent, Drafts, All mail, Spam, Trash and your Gmail labels, with unread counts. Settings › Inbox type switches between Primary and Everything.
- **List.**
  - Conversations, with participants, message counts, a draft marker, attachment indicator and star.
  - Pull to refresh, infinite scroll, and a refresh every 60 seconds while the app is visible.
  - The last list is cached for an instant start.
- **Swipe actions.** Configurable for each direction: archive, delete, mark read/unread, star, or none. Defaults are right = archive and left = delete. Every destructive action shows an **Undo** snackbar.
- **Multi-select.** Long-press a row (⌘-click on a Mac). Selected conversations can be archived, deleted, marked read/unread, starred, moved, reported as spam, or all selected at once.
- **Conversation view.**
  - Unread messages and the latest message open expanded.
  - The full header (from, to, cc, date) opens with a tap.
  - Quoted history is collapsed behind `•••`.
  - HTML mail renders in a sandboxed frame and scales down if it's too wide.
  - Inline images, a remote-image toggle, and link handling (http and mailto).
- **Actions.**
  - Archive, delete, delete forever, empty Trash or Spam, restore, mark unread, mark unread from here.
  - Star a message or a conversation, move to a folder, apply labels, report spam, not spam.
- **Compose.**
  - Reply, reply all and forward. Forwarding includes the original attachments.
  - Choose the From address from any account or send-as alias.
  - To/Cc/Bcc fields with autocomplete.
  - Attach files or photos, or drag them in.
  - Drafts autosave to Gmail and can be reopened from Drafts or from inside a conversation.
  - Undo send (off, 5, 10, 20 or 30 seconds), and a prompt before sending without a subject.
- **Signatures.** One per send-as address, written in Markdown. Gmail's own signature is used (converted to Markdown) until you edit it. You can remove the signature for a single message.
- **Attachments.** Preview images, PDFs and text. Save to *Files* (iPad) or Downloads (Mac).
- **Search.** Full Gmail search syntax (`from:`, `has:attachment`, `is:unread`, …).
- **Keyboard shortcuts** (Gmail's):

  | Shortcut | Action |
  | --- | --- |
  | `c` | Compose |
  | `/` | Search |
  | `j` / `k` | Next / previous conversation |
  | `e` | Archive |
  | `#` | Delete |
  | `s` | Star |
  | `r` / `a` / `f` | Reply / reply all / forward |
  | `shift+u` / `shift+i` | Mark unread / read |
  | `!` | Report spam |
  | `x` | Select |
  | `u` or `esc` | Back |
  | `g` then `i` / `s` / `t` / `d` / `a` | Go to Inbox / Starred / Sent / Drafts / All mail |
  | `⌘↩` | Send |
  | `⌘⇧P` | Preview |
  | `⌘B` / `⌘I` / `⌘K` | Bold / italic / link (in the editor) |

- **Appearance.** Light, dark and system themes. Two panes on a landscape iPad or a Mac, and a persistent sidebar on wide screens.

### Markdown

- The body is GitHub-flavoured Markdown: lists, tables, code, task lists and links.
- Single line breaks are kept, as people expect in email.
- Styles are inlined so the result looks right in Gmail, Outlook and Apple Mail.
- The text/plain alternative is the Markdown source followed by `-- ` and the signature. Replies add a `>`-quoted history.
- Use the eye button (⌘⇧P) to preview exactly what will be sent.

### Not in v0.1

Some features can't be built without a server, and some aren't in Gmail's public API:

| Gmail feature | Status |
| --- | --- |
| Push notifications | Needs a server: Gmail `watch` → Pub/Sub → APNs. Carrier refreshes while it's open. |
| Snooze, scheduled send | Not available in the Gmail API. |
| Smart Compose / Smart Reply, nudges, summaries | No API. |
| Mute conversation | Not exposed by the API. |
| Creating and editing labels and filters, vacation responder | Possible through the API; deferred. |
| Sender avatars, contact cards, inline images in compose, Drive attachments | Deferred (avatars left out for minimalism). |
| Full offline mode / outbox | Only the list is cached. Sending requires a connection. |
| Chat, Meet, Spaces | Out of scope. |

## Architecture

```
src/
  App.svelte                 layout (1–3 panes), keyboard shortcuts, refresh timer
  components/                Sidebar, ThreadList/Row (swipe), ThreadView, MessageItem,
                             MailBody (sandboxed HTML), Compose, RecipientField, Settings, …
  lib/
    app.svelte.ts            state + mailbox actions (optimistic, undoable)
    compose.svelte.ts        compose/reply/forward/drafts/undo-send
    settings.svelte.ts       persisted preferences
    platform.ts              Tauri vs browser: HTTP, Keychain, store, files, opener
    mail/
      auth.ts                Sign in with Google (system web sheet, OAuth + PKCE)
      gmail.ts               Gmail + People API client
      mime.ts                RFC 5322/2047/2231 builder and Gmail payload parser
      markdown.ts            Markdown → inline-styled email HTML
      demo.ts                in-memory backend for browser development
src-tauri/
  src/secrets.rs             refresh tokens in the Keychain (macOS/iOS)
  src/files.rs               saving attachments
```

- **Network.** HTTP goes through `tauri-plugin-http`, which is scoped to `*.googleapis.com` and avoids WebView CORS.
- **Sign-in.** [`tauri-plugin-auth-session`](https://crates.io/crates/tauri-plugin-auth-session) shows Google's sign-in in `ASWebAuthenticationSession`.
- **Storage.** Refresh tokens are kept in the Keychain. Preferences and the account list are stored with `tauri-plugin-store`.
- **Gmail calls.** Messages are sent as raw RFC 822 through Gmail's multipart upload endpoint, so attachments can be up to 35 MB, which covers Gmail's 25 MB limit.
