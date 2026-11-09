<script lang="ts">
  import { X } from "@lucide/svelte";
  import { app } from "../lib/app.svelte";
  import { composer, htmlToMarkdown } from "../lib/compose.svelte";
  import { markdownToHtml } from "../lib/mail/markdown";
  import { ACCOUNT_COLORS, settings, SWIPE_LABELS, type SwipeAction } from "../lib/settings.svelte";
  import Sheet from "./Sheet.svelte";
  import { isIOS, isTauri } from "../lib/platform";
  import { applyTemplate, BROWSERS, CUSTOM_BROWSER, validTemplate } from "../lib/browser";

  interface Props {
    onclose: () => void;
  }
  let { onclose }: Props = $props();

  const s = $derived(settings.value);
  const identities = $derived(composer.fromOptions());

  let sigDrafts = $state<Record<string, string>>({});
  let sigLoaded = $state(false);

  $effect(() => {
    if (sigLoaded) return;
    sigLoaded = true;
    (async () => {
      const out: Record<string, string> = {};
      for (const o of identities) out[o.address.email] = await composer.signatureFor(o.address.email);
      sigDrafts = out;
    })();
  });

  function saveSig(email: string) {
    settings.update({
      signatures: { ...s.signatures, [email]: sigDrafts[email] ?? "" },
      signaturesCustomized: { ...s.signaturesCustomized, [email]: true },
    });
  }

  async function importSig(email: string) {
    const sendAs = identities.find((o) => o.address.email === email)?.sendAs;
    sigDrafts[email] = sendAs?.signature ? await htmlToMarkdown(sendAs.signature) : "";
    saveSig(email);
  }

  const swipeOptions: SwipeAction[] = ["archive", "trash", "read", "pin", "none"];

  /** On a Mac, presets open links in the named app instead of rewriting them. */
  const mac = isTauri && !isIOS;
  const EXAMPLE = "https://example.com/page?id=1";

  function pickBrowser(id: string) {
    const prev = BROWSERS.find((b) => b.id === s.browser);
    // Start a custom template from the browser chosen before, so it can be tweaked.
    const browserTemplate = id === CUSTOM_BROWSER && !s.browserTemplate.trim() ? (prev?.template ?? "") : s.browserTemplate;
    settings.update({ browser: id, browserTemplate });
  }
</script>

<Sheet {onclose} width={620} full>
  <header>
    <span class="title">Settings</span>
    <button class="icon-btn" aria-label="Close" onclick={onclose}><X size={20} strokeWidth={1.7} /></button>
  </header>
  <div class="scroll body">
    <section>
      <h2>Accounts</h2>
      {#each app.accounts as a (a.email)}
        <div class="row">
          <div class="grow">
            <div>{a.email}</div>
            {#if a.needsReauth}<div class="sub warn">Needs to sign in again</div>{:else if a.name}<div class="sub">{a.name}</div>{/if}
            <div class="swatches" role="radiogroup" aria-label="Colour for {a.email}">
              {#each ACCOUNT_COLORS as c}
                <button
                  class="swatch"
                  class:on={app.accountColor(a.email) === c}
                  style:background={c}
                  role="radio"
                  aria-checked={app.accountColor(a.email) === c}
                  aria-label="Colour {c}"
                  onclick={() => app.setAccountColor(a.email, c)}
                ></button>
              {/each}
            </div>
          </div>
          {#if a.needsReauth}<button class="text-btn" onclick={() => app.addAccount(a.email)}>Sign in</button>{/if}
          {#if !app.demo}
            <button class="text-btn danger" onclick={() => confirm(`Remove ${a.email} from Carrier?`) && app.removeAccount(a.email)}>Remove</button>
          {/if}
        </div>
      {/each}
      {#if app.demo && isTauri}
        <p class="note">You're looking at sample mail.</p>
        <button class="text-btn add" onclick={() => (onclose(), app.exitDemo())}>Leave sample mail</button>
      {/if}
      {#if isTauri}<button class="text-btn add" onclick={() => app.addAccount()}>Add Google account</button>{/if}
    </section>

    <section>
      <h2>Signatures</h2>
      <p class="note">Written in Markdown and added below new messages and replies. Gmail's own signature is used until you edit one here.</p>
      {#each identities as o (o.address.email)}
        <div class="sig">
          <div class="sig-head">
            <span>{o.address.email}</span>
            {#if o.sendAs?.signature}<button class="text-btn" onclick={() => importSig(o.address.email)}>Use Gmail signature</button>{/if}
          </div>
          <textarea
            rows="3"
            placeholder="No signature"
            bind:value={sigDrafts[o.address.email]}
            onchange={() => saveSig(o.address.email)}
            onblur={() => saveSig(o.address.email)}
          ></textarea>
          {#if sigDrafts[o.address.email]?.trim()}
            <div class="sig-preview">{@html markdownToHtml(sigDrafts[o.address.email])}</div>
          {/if}
        </div>
      {/each}
    </section>

    <section>
      <h2>Swipe actions</h2>
      <label class="row">
        <span class="grow">Swipe right</span>
        <select value={s.swipeRight} onchange={(e) => settings.update({ swipeRight: e.currentTarget.value as SwipeAction })}>
          {#each swipeOptions as o}<option value={o}>{SWIPE_LABELS[o]}</option>{/each}
        </select>
      </label>
      <label class="row">
        <span class="grow">Swipe left</span>
        <select value={s.swipeLeft} onchange={(e) => settings.update({ swipeLeft: e.currentTarget.value as SwipeAction })}>
          {#each swipeOptions as o}<option value={o}>{SWIPE_LABELS[o]}</option>{/each}
        </select>
      </label>
    </section>

    <section>
      <h2>Mail</h2>
      <label class="row">
        <span class="grow">
          Inbox type
          <span class="sub">Primary hides Social, Promotions, Updates and Forums from Inbox.</span>
        </span>
        <select value={s.inboxType} onchange={(e) => { settings.update({ inboxType: e.currentTarget.value as "primary" | "everything" }); app.loadList(); }}>
          <option value="primary">Primary</option>
          <option value="everything">Everything</option>
        </select>
      </label>
      <label class="row">
        <span class="grow">Default reply</span>
        <select value={s.defaultReply} onchange={(e) => settings.update({ defaultReply: e.currentTarget.value as "reply" | "replyAll" })}>
          <option value="reply">Reply</option>
          <option value="replyAll">Reply all</option>
        </select>
      </label>
      <label class="row">
        <span class="grow">Undo send</span>
        <select value={String(s.undoSendSeconds)} onchange={(e) => settings.update({ undoSendSeconds: Number(e.currentTarget.value) })}>
          <option value="0">Off</option>
          <option value="5">5 seconds</option>
          <option value="10">10 seconds</option>
          <option value="20">20 seconds</option>
          <option value="30">30 seconds</option>
        </select>
      </label>
      <label class="row">
        <span class="grow">
          Load remote images
          <span class="sub">When off, images are blocked until you tap "Show images".</span>
        </span>
        <input type="checkbox" checked={s.loadRemoteImages} onchange={(e) => settings.update({ loadRemoteImages: e.currentTarget.checked })} />
      </label>
      <label class="row">
        <span class="grow">Appearance</span>
        <select value={s.theme} onchange={(e) => settings.update({ theme: e.currentTarget.value as "system" | "light" | "dark" })}>
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
    </section>

    <section>
      <h2>Links</h2>
      <label class="row">
        <span class="grow">
          Default browser
          <span class="sub">
            {#if s.browser === CUSTOM_BROWSER}Web links in messages are rewritten with the template below.
            {:else if mac}Web links in messages open in this app.
            {:else}Web links in messages are rewritten into this browser's URL scheme. It must be installed.{/if}
          </span>
        </span>
        <select value={s.browser} onchange={(e) => pickBrowser(e.currentTarget.value)}>
          {#each BROWSERS as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
          <option value={CUSTOM_BROWSER}>Custom…</option>
        </select>
      </label>
      {#if s.browser === CUSTOM_BROWSER}
        <div class="custom">
          <input
            class="template"
            type="text"
            aria-label="Custom browser URL template"
            placeholder={"e.g. firefox://open-url?url={url}"}
            value={s.browserTemplate}
            oninput={(e) => settings.update({ browserTemplate: e.currentTarget.value })}
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
          />
          <p class="note">
            Placeholders: <code>{"{url}"}</code> the link, encoded · <code>{"{raw}"}</code> the link as is ·
            <code>{"{scheme}"}</code> http or https · <code>{"{s}"}</code> "s" for https links ·
            <code>{"{rest}"}</code> the link without http:// or https://. Without a placeholder, the link is added to the end.
          </p>
          {#if s.browserTemplate.trim()}
            {#if validTemplate(s.browserTemplate)}
              <p class="example"><span class="sub">{EXAMPLE} opens as</span><code>{applyTemplate(s.browserTemplate, EXAMPLE)}</code></p>
            {:else}
              <p class="example warn">This needs to start with a URL scheme, such as <code>mybrowser:</code></p>
            {/if}
          {:else}
            <p class="example sub">Until a template is entered, links open in the system default browser.</p>
          {/if}
        </div>
      {/if}
    </section>

    <section class="about">
      <span class="sub">Carrier 0.1.0</span>
    </section>
  </div>
</Sheet>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 10px 22px;
    border-bottom: 1px solid var(--line);
  }
  .title {
    font-weight: 600;
    font-size: 17px;
  }
  .body {
    flex: 1;
    min-height: 0;
    padding: 4px 0 calc(20px + var(--safe-bottom));
  }
  section {
    padding: 14px 22px 10px;
  }
  section + section {
    border-top: 1px solid var(--line);
  }
  h2 {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0 0 6px;
  }
  .note {
    font-size: 13px;
    color: var(--text-2);
    margin: 0 0 10px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 0;
    font-size: 15px;
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .sub {
    font-size: 12.5px;
    color: var(--text-2);
  }
  .swatches {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .swatch {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  }
  .swatch.on {
    box-shadow:
      0 0 0 2px var(--bg),
      0 0 0 3.5px var(--text-2);
  }
  .warn {
    color: var(--danger);
  }
  .add {
    margin: 4px 0 0 -12px;
  }
  select {
    border: 1px solid var(--line-2);
    background: var(--bg);
    border-radius: 8px;
    padding: 6px 8px;
    font-size: 14px;
  }
  input[type="checkbox"] {
    width: 20px;
    height: 20px;
    accent-color: var(--text);
  }
  textarea {
    width: 100%;
    border: 1px solid var(--line-2);
    background: var(--bg);
    border-radius: 9px;
    padding: 8px 10px;
    font-size: 14px;
    outline: none;
  }
  textarea {
    resize: vertical;
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.5;
  }
  textarea:focus {
    border-color: var(--text-3);
  }
  .sig {
    padding: 8px 0 12px;
  }
  .sig-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 14px;
    margin-bottom: 6px;
  }
  .sig-preview {
    font-size: 13px;
    color: var(--text-2);
    padding: 8px 2px 0;
  }
  .sig-preview :global(*) {
    color: inherit !important;
  }
  .about {
    padding-top: 16px;
  }
  .custom {
    padding: 2px 0 8px;
  }
  .template {
    width: 100%;
    border: 1px solid var(--line-2);
    background: var(--bg);
    border-radius: 9px;
    padding: 8px 10px;
    font-family: var(--mono);
    font-size: 13px;
    outline: none;
    margin-bottom: 8px;
  }
  .template:focus {
    border-color: var(--text-3);
  }
  code {
    font-family: var(--mono);
    font-size: 12px;
  }
  .example {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    font-size: 13px;
    word-break: break-all;
  }
</style>
