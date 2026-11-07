<script lang="ts">
  import { FileText, Image as ImageIcon, Paperclip, Download, X } from "@lucide/svelte";
  import { app } from "../lib/app.svelte";
  import type { Attachment } from "../lib/mail/types";
  import { base64ToBytes, isIOS, revealFile, saveFile } from "../lib/platform";
  import { toasts } from "../lib/toasts.svelte";
  import { formatBytes } from "../lib/util";

  interface Props {
    account: string;
    attachments: Attachment[];
  }
  let { account, attachments }: Props = $props();

  const files = $derived(attachments.filter((a) => !a.inline || !a.contentId));

  let viewing = $state<{ a: Attachment; url: string; data: string } | null>(null);
  let busy = $state<string | null>(null);

  const previewable = (t: string) => t.startsWith("image/") || t === "application/pdf" || t.startsWith("text/");

  async function load(a: Attachment): Promise<string> {
    busy = a.attachmentId;
    try {
      return await app.backend(account).getAttachment(a.messageId, a.attachmentId);
    } finally {
      busy = null;
    }
  }

  async function open(a: Attachment) {
    try {
      const data = await load(a);
      if (previewable(a.mimeType)) {
        const blob = new Blob([base64ToBytes(data) as BlobPart], { type: a.mimeType });
        viewing = { a, data, url: URL.createObjectURL(blob) };
      } else await save(a, data);
    } catch (e) {
      app.handleError(e, account);
    }
  }

  async function save(a: Attachment, data?: string) {
    try {
      const d = data ?? (await load(a));
      const path = await saveFile(a.filename, d, a.mimeType);
      toasts.show(isIOS ? `Saved to Files › Carrier` : `Saved ${a.filename}`, {
        action: isIOS || app.demo ? undefined : "Show",
        onAction: () => revealFile(path),
      });
    } catch (e) {
      app.handleError(e, account);
    }
  }

  function close() {
    if (viewing) URL.revokeObjectURL(viewing.url);
    viewing = null;
  }
</script>

{#if files.length}
  <div class="atts">
    {#each files as a (a.attachmentId + a.filename)}
      <button class="att" onclick={() => open(a)} disabled={busy === a.attachmentId}>
        <span class="ic">
          {#if busy === a.attachmentId}<span class="spinner"></span>
          {:else if a.mimeType.startsWith("image/")}<ImageIcon size={16} strokeWidth={1.7} />
          {:else if a.mimeType === "application/pdf" || a.mimeType.startsWith("text/")}<FileText size={16} strokeWidth={1.7} />
          {:else}<Paperclip size={16} strokeWidth={1.7} />{/if}
        </span>
        <span class="meta">
          <span class="fname">{a.filename}</span>
          <span class="size">{formatBytes(a.size)}</span>
        </span>
      </button>
    {/each}
  </div>
{/if}

{#if viewing}
  <div class="viewer" role="dialog" aria-modal="true">
    <header>
      <span class="vname">{viewing.a.filename}</span>
      <button class="icon-btn" aria-label="Save" onclick={() => viewing && save(viewing.a, viewing.data)}><Download size={19} strokeWidth={1.7} /></button>
      <button class="icon-btn" aria-label="Close" onclick={close}><X size={20} strokeWidth={1.7} /></button>
    </header>
    <div class="stage">
      {#if viewing.a.mimeType.startsWith("image/")}
        <img src={viewing.url} alt={viewing.a.filename} />
      {:else}
        <iframe title={viewing.a.filename} src={viewing.url} sandbox="allow-same-origin"></iframe>
      {/if}
    </div>
  </div>
{/if}

<style>
  .atts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
  }
  .att {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px 8px 10px;
    border: 1px solid var(--line-2);
    border-radius: 10px;
    max-width: 260px;
    text-align: left;
  }
  .att:hover {
    background: var(--bg-hover);
  }
  .ic {
    color: var(--text-2);
    display: flex;
  }
  .ic .spinner {
    width: 16px;
    height: 16px;
  }
  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .fname {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .size {
    font-size: 11px;
    color: var(--text-3);
  }
  .viewer {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: var(--bg);
    display: flex;
    flex-direction: column;
  }
  .viewer header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: calc(var(--safe-top) + 8px) 10px 8px 20px;
    border-bottom: 1px solid var(--line);
  }
  .vname {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding-bottom: var(--safe-bottom);
  }
  .stage img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .stage iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: #fff;
  }
</style>
