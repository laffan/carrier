<script lang="ts">
  import { X, Paperclip, Eye, PenLine, Trash2, ChevronDown, ArrowUp } from "@lucide/svelte";
  import { app } from "../lib/app.svelte";
  import { composer, type FromOption } from "../lib/compose.svelte";
  import { markdownToHtml } from "../lib/mail/markdown";
  import { formatBytes } from "../lib/util";
  import MailBody from "./MailBody.svelte";
  import Popover from "./Popover.svelte";
  import RecipientField from "./RecipientField.svelte";
  import Sheet from "./Sheet.svelte";

  const d = $derived(composer.draft!);
  let showCc = $state(false);
  let fileInput = $state<HTMLInputElement>();
  let textarea = $state<HTMLTextAreaElement>();
  let fromOpen = $state(false);
  let fromAnchor = $state<HTMLElement>();
  let showQuote = $state(false);

  const fromOptions = $derived(composer.fromOptions());
  const title = $derived(
    d.mode === "reply" || d.mode === "replyAll" ? "Reply" : d.mode === "forward" ? "Forward" : d.mode === "draft" ? "Draft" : "New message",
  );
  const sigHtml = $derived(d.signature ? markdownToHtml(d.signature) : "");

  $effect(() => {
    if (d.cc.length || d.bcc.length) showCc = true;
  });

  // Focus: recipients for new mail, body for replies.
  $effect(() => {
    if ((d.mode === "reply" || d.mode === "replyAll") && textarea) {
      textarea.focus();
      textarea.setSelectionRange(0, 0);
    }
  });

  function changed() {
    composer.scheduleSave();
  }

  function autosize() {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = Math.max(180, textarea.scrollHeight) + "px";
  }

  $effect(() => {
    void d.markdown;
    void composer.preview;
    queueMicrotask(autosize);
  });

  function onkeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      composer.send();
    } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "p" || e.key === "P")) {
      e.preventDefault();
      composer.preview = !composer.preview;
    }
  }

  /** Minimal Markdown helpers for hardware keyboards: ⌘B, ⌘I, ⌘K. */
  function onTextKey(e: KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey) || !textarea) return;
    const wrap = (before: string, after = before) => {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en, value } = textarea!;
      const sel = value.slice(s, en);
      d.markdown = value.slice(0, s) + before + sel + after + value.slice(en);
      queueMicrotask(() => textarea!.setSelectionRange(s + before.length, en + before.length));
      changed();
    };
    if (e.key === "b") wrap("**");
    else if (e.key === "i") wrap("*");
    else if (e.key === "k") wrap("[", "](https://)");
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

  const savedLabel = $derived(composer.saving ? "Saving…" : composer.lastSaved ? "Saved" : "");
</script>

<Sheet onclose={() => composer.close()} width={760} full>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="compose" {onkeydown} ondragover={(e) => e.preventDefault()} {ondrop}>
    <header>
      <button class="icon-btn" aria-label="Close" title="Close (saves draft)" onclick={() => composer.close()}><X size={20} strokeWidth={1.7} /></button>
      <span class="title">{title}</span>
      <span class="saved">{savedLabel}</span>
      <div class="actions">
        <button class="icon-btn" aria-label="Attach" title="Attach files" onclick={() => fileInput?.click()}><Paperclip size={19} strokeWidth={1.7} /></button>
        <button
          class="icon-btn"
          class:active={composer.preview}
          aria-label={composer.preview ? "Edit" : "Preview"}
          title={composer.preview ? "Edit (⌘⇧P)" : "Preview (⌘⇧P)"}
          onclick={() => (composer.preview = !composer.preview)}
        >
          {#if composer.preview}<PenLine size={19} strokeWidth={1.7} />{:else}<Eye size={19} strokeWidth={1.7} />{/if}
        </button>
        <button class="send" aria-label="Send" title="Send (⌘↩)" onclick={() => composer.send()}>
          <ArrowUp size={18} strokeWidth={2.2} />
        </button>
      </div>
    </header>

    <div class="scroll fields">
      <div class="field from">
        <span class="label">From</span>
        <button class="from-btn" bind:this={fromAnchor} onclick={() => (fromOpen = fromOptions.length > 1 && !fromOpen)}>
          <span>{d.from.name ? `${d.from.name} <${d.from.email}>` : d.from.email}</span>
          {#if fromOptions.length > 1}<ChevronDown size={14} strokeWidth={1.8} />{/if}
        </button>
      </div>
      <RecipientField label="To" value={d.to} account={d.account} autofocus={d.mode === "new" || d.mode === "forward"} onchange={(v) => ((d.to = v), changed())}>
        {#snippet trailing()}
          {#if !showCc}<button class="ccbtn" onclick={() => (showCc = true)}>Cc/Bcc</button>{/if}
        {/snippet}
      </RecipientField>
      {#if showCc}
        <RecipientField label="Cc" value={d.cc} account={d.account} onchange={(v) => ((d.cc = v), changed())} />
        <RecipientField label="Bcc" value={d.bcc} account={d.account} onchange={(v) => ((d.bcc = v), changed())} />
      {/if}
      <div class="field">
        <input class="subject" placeholder="Subject" bind:value={d.subject} oninput={changed} enterkeyhint="next" />
      </div>

      {#if composer.preview}
        <div class="preview">
          <MailBody html={composer.previewHtml()} loadImages={true} />
        </div>
      {:else}
        <textarea
          bind:this={textarea}
          bind:value={d.markdown}
          class="editor"
          placeholder="Write in Markdown…"
          oninput={() => (changed(), autosize())}
          onkeydown={onTextKey}
          spellcheck="true"
        ></textarea>

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
      <span class="hint">Markdown · <code>**bold**</code> <code>*italic*</code> <code>[link](url)</code> <code>- list</code></span>
      <button class="icon-btn" aria-label="Discard" title="Discard draft" onclick={() => composer.discard()}><Trash2 size={17} strokeWidth={1.7} /></button>
    </footer>
  </div>
</Sheet>

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
  .icon-btn.active {
    color: var(--text);
    background: var(--bg-selected);
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
  .editor {
    display: block;
    width: 100%;
    border: none;
    outline: none;
    resize: none;
    background: transparent;
    padding: 16px 20px 8px;
    font-size: 15.5px;
    line-height: 1.55;
    min-height: 180px;
    overflow: hidden;
  }
  .preview {
    padding: 16px 20px;
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
  .hint code {
    font-family: var(--mono);
    font-size: 11px;
    margin-right: 4px;
  }
  .via {
    color: var(--text-3);
    font-size: 12px;
  }
</style>
