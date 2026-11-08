<script lang="ts">
  import { onMount } from "svelte";
  import { X, Paperclip, Trash2, ChevronDown, ArrowUp, Maximize2 } from "@lucide/svelte";
  import { app } from "../lib/app.svelte";
  import { composer, type FromOption } from "../lib/compose.svelte";
  import { markdownToHtml } from "../lib/mail/markdown";
  import { formatBytes } from "../lib/util";
  import MailBody from "./MailBody.svelte";
  import MarkdownEditor from "./MarkdownEditor.svelte";
  import Popover from "./Popover.svelte";
  import RecipientField from "./RecipientField.svelte";
  import Sheet from "./Sheet.svelte";

  interface Props {
    /** Rendered beneath the conversation (replies and forwards) instead of in a sheet. */
    inline?: boolean;
  }
  let { inline = false }: Props = $props();

  const d = $derived(composer.draft!);
  let card = $state<HTMLElement>();
  let showCc = $state(false);
  let fileInput = $state<HTMLInputElement>();
  let fromOpen = $state(false);
  let fromAnchor = $state<HTMLElement>();
  let showQuote = $state(false);

  // An inline reply stays in its conversation, so it can only switch between that account's addresses.
  const fromOptions = $derived(composer.fromOptions().filter((o) => !inline || o.account === d.account));
  const title = $derived(
    d.mode === "reply" || d.mode === "replyAll" ? "Reply" : d.mode === "forward" ? "Forward" : d.mode === "draft" ? "Draft" : "New message",
  );
  const sigHtml = $derived(d.signature ? markdownToHtml(d.signature) : "");

  $effect(() => {
    if (d.cc.length || d.bcc.length) showCc = true;
  });

  function changed() {
    composer.scheduleSave();
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      composer.send();
    }
  }

  function pickFrom(o: FromOption) {
    fromOpen = false;
    composer.setFrom(o);
  }

  function ondrop(e: DragEvent) {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    composer.addFiles(e.dataTransfer.files);
  }

  onMount(() => {
    // Bring the inline editor into view beneath the last message.
    if (inline) requestAnimationFrame(() => card?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  });

  const savedLabel = $derived(composer.saving ? "Saving…" : composer.lastSaved ? "Saved" : "");
</script>

{#if inline}
  <div class="card" bind:this={card}>{@render body()}</div>
{:else}
  <Sheet onclose={() => composer.close()} width={760} full>{@render body()}</Sheet>
{/if}

{#snippet body()}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="compose" class:inline {onkeydown} ondragover={(e) => e.preventDefault()} {ondrop}>
    <header>
      <button class="icon-btn" aria-label="Close" title="Close (saves draft)" onclick={() => composer.close()}><X size={20} strokeWidth={1.7} /></button>
      <span class="title">{title}</span>
      <span class="saved">{savedLabel}</span>
      <div class="actions">
        {#if inline}
          <button class="icon-btn" aria-label="Open in window" title="Open in window" onclick={() => composer.popOut()}><Maximize2 size={17} strokeWidth={1.7} /></button>
        {/if}
        <button class="icon-btn" aria-label="Attach" title="Attach files" onclick={() => fileInput?.click()}><Paperclip size={19} strokeWidth={1.7} /></button>
        <button class="send" aria-label="Send" title="Send (⌘↩)" onclick={() => composer.send()}>
          <ArrowUp size={18} strokeWidth={2.2} />
        </button>
      </div>
    </header>

    <div class="scroll fields">
      {#if !inline || fromOptions.length > 1}<div class="field from">
        <span class="label">From</span>
        <button class="from-btn" bind:this={fromAnchor} onclick={() => (fromOpen = fromOptions.length > 1 && !fromOpen)}>
          <span>{d.from.name ? `${d.from.name} <${d.from.email}>` : d.from.email}</span>
          {#if fromOptions.length > 1}<ChevronDown size={14} strokeWidth={1.8} />{/if}
        </button>
      </div>{/if}
      <RecipientField label="To" value={d.to} account={d.account} autofocus={d.mode === "new" || d.mode === "forward"} onchange={(v) => ((d.to = v), changed())}>
        {#snippet trailing()}
          {#if !showCc}<button class="ccbtn" onclick={() => (showCc = true)}>Cc/Bcc</button>{/if}
        {/snippet}
      </RecipientField>
      {#if showCc}
        <RecipientField label="Cc" value={d.cc} account={d.account} onchange={(v) => ((d.cc = v), changed())} />
        <RecipientField label="Bcc" value={d.bcc} account={d.account} onchange={(v) => ((d.bcc = v), changed())} />
      {/if}
      {#if !inline}
        <div class="field">
          <input class="subject" placeholder="Subject" bind:value={d.subject} oninput={changed} enterkeyhint="next" />
        </div>
      {/if}

      <MarkdownEditor
        value={d.markdown}
        placeholder="Write something…"
        autofocus={d.mode === "reply" || d.mode === "replyAll" || d.mode === "draft"}
        onchange={(v) => {
          d.markdown = v;
          changed();
        }}
        onsend={() => composer.send()}
      />

        {#if d.signature && d.includeSignature}
          <div class="sig">
            <div class="sig-body">{@html sigHtml}</div>
            <button class="sig-x" aria-label="Remove signature" title="Remove signature from this message" onclick={() => ((d.includeSignature = false), changed())}>×</button>
          </div>
        {:else if d.signature}
          <button class="sig-add" onclick={() => ((d.includeSignature = true), changed())}>Add signature</button>
        {/if}

        {#if d.quote}
          <div class="quote">
            <button class="quote-toggle" onclick={() => (showQuote = !showQuote)}>
              {d.quote.kind === "forward" ? "Forwarded message" : "Quoted text"} {showQuote ? "▴" : "▾"}
            </button>
            {#if showQuote}
              <div class="quote-body"><MailBody html={d.quote.html} loadImages={false} /></div>
            {/if}
          </div>
        {/if}

      {#if d.attachments.length || composer.loadingAttachments}
        <div class="atts">
          {#each d.attachments as a, i (a.filename + i)}
            <span class="att">
              <span class="aname">{a.filename}</span>
              <span class="asize">{formatBytes(a.size)}</span>
              <button aria-label="Remove attachment" onclick={() => composer.removeAttachment(i)}>×</button>
            </span>
          {/each}
          {#if composer.loadingAttachments}<span class="spinner"></span>{/if}
        </div>
      {/if}
    </div>

    <footer>
      <span class="hint">Markdown · ⌘B bold · ⌘I italic · ⌘K link</span>
      <button class="icon-btn" aria-label="Discard" title="Discard draft" onclick={() => composer.discard()}><Trash2 size={17} strokeWidth={1.7} /></button>
    </footer>
  </div>
{/snippet}

<Popover open={fromOpen} anchor={fromAnchor} onclose={() => (fromOpen = false)} align="left">
  {#each fromOptions as o (o.account + o.address.email)}
    <button onclick={() => pickFrom(o)}>
      {o.address.name ? `${o.address.name} <${o.address.email}>` : o.address.email}
      {#if app.accounts.length > 1 && o.account !== o.address.email}<span class="via"> · {o.account}</span>{/if}
    </button>
  {/each}
</Popover>

<input bind:this={fileInput} type="file" multiple hidden onchange={(e) => {
  const f = (e.currentTarget as HTMLInputElement).files;
  if (f) composer.addFiles(f);
  (e.currentTarget as HTMLInputElement).value = "";
}} />

<style>
  .compose {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .card {
    margin: 20px 0 0;
    border: 1px solid var(--line-2);
    border-radius: 14px;
    overflow: hidden;
    background: var(--bg);
    scroll-margin-bottom: 24px;
  }
  .compose.inline .fields {
    flex: none;
    overflow: visible;
  }
  .compose.inline footer {
    padding-bottom: 4px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
    flex: none;
  }
  .title {
    font-weight: 600;
    font-size: 16px;
  }
  .saved {
    font-size: 12px;
    color: var(--text-3);
    margin-left: 4px;
  }
  .actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .send {
    width: 34px;
    height: 34px;
    margin-left: 6px;
    border-radius: 50%;
    background: var(--text);
    color: var(--bg);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .send:hover {
    opacity: 0.85;
  }
  .fields {
    flex: 1;
    min-height: 0;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 16px 6px 20px;
    border-bottom: 1px solid var(--line);
    min-height: 44px;
  }
  .label {
    color: var(--text-3);
    font-size: 14px;
    width: 52px;
    flex: none;
  }
  .from-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 15px;
    color: var(--text);
    min-width: 0;
    text-align: left;
  }
  .from-btn span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ccbtn {
    font-size: 13px;
    color: var(--text-3);
    padding: 7px 0 0;
  }
  .subject {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 15px;
    height: 32px;
    padding: 0;
  }
  .sig {
    position: relative;
    margin: 0 20px 8px;
    padding: 8px 28px 8px 0;
    color: var(--text-2);
    font-size: 14px;
    border-top: 1px dashed var(--line-2);
  }
  .sig-body :global(p) {
    margin: 0 0 4px !important;
  }
  .sig-body :global(*) {
    color: inherit !important;
  }
  .sig-x {
    position: absolute;
    right: 0;
    top: 6px;
    color: var(--text-3);
    font-size: 16px;
    padding: 0 4px;
  }
  .sig-add {
    margin: 0 20px 8px;
    font-size: 13px;
    color: var(--text-3);
  }
  .quote {
    margin: 4px 20px 12px;
  }
  .quote-toggle {
    font-size: 13px;
    color: var(--text-3);
  }
  .quote-body {
    margin-top: 8px;
    padding-left: 10px;
    border-left: 2px solid var(--line-2);
    opacity: 0.8;
  }
  .atts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 20px 16px;
    align-items: center;
  }
  .att {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 10px;
    border: 1px solid var(--line-2);
    border-radius: 9px;
    font-size: 13px;
    max-width: 280px;
  }
  .aname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .asize {
    color: var(--text-3);
    font-size: 11px;
    flex: none;
  }
  .att button {
    color: var(--text-3);
    padding: 0 4px;
    font-size: 15px;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px 4px 20px;
    padding-bottom: calc(4px + var(--safe-bottom));
    border-top: 1px solid var(--line);
    flex: none;
  }
  .hint {
    font-size: 12px;
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .via {
    color: var(--text-3);
    font-size: 12px;
  }
</style>
