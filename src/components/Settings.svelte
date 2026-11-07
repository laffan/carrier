<script lang="ts">
  import { X } from "@lucide/svelte";
  import { app } from "../lib/app.svelte";
  import { composer, htmlToMarkdown } from "../lib/compose.svelte";
  import { markdownToHtml } from "../lib/mail/markdown";
  import { settings, SWIPE_LABELS, type SwipeAction } from "../lib/settings.svelte";
  import Sheet from "./Sheet.svelte";

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

  const swipeOptions: SwipeAction[] = ["archive", "trash", "read", "star", "none"];
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
          </div>
          {#if a.needsReauth}<button class="text-btn" onclick={() => app.addAccount(a.email)}>Sign in</button>{/if}
          {#if !app.demo}
            <button class="text-btn danger" onclick={() => confirm(`Remove ${a.email} from Carrier?`) && app.removeAccount(a.email)}>Remove</button>
          {/if}
        </div>
      {/each}
      {#if !app.demo}<button class="text-btn add" onclick={() => app.addAccount()}>Add Google account</button>{/if}
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
</style>
