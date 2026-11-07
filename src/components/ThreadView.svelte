<script lang="ts">
  import { ArrowLeft, Archive, Trash2, Mail, Ellipsis, Reply, ReplyAll, Forward, Inbox, FolderInput, Tag, Star } from "@lucide/svelte";
  import { app, threadKey } from "../lib/app.svelte";
  import { composer } from "../lib/compose.svelte";
  import { contacts } from "../lib/contacts.svelte";
  import { settings } from "../lib/settings.svelte";
  import MessageItem from "./MessageItem.svelte";
  import Popover from "./Popover.svelte";
  import LabelPicker from "./LabelPicker.svelte";

  interface Props {
    showBack: boolean;
  }
  let { showBack }: Props = $props();

  let expanded = $state<Set<string>>(new Set());
  let moreOpen = $state(false);
  let moreAnchor = $state<HTMLElement>();
  let picker = $state<"move" | "labels" | null>(null);
  let scroller = $state<HTMLDivElement>();

  const thread = $derived(app.thread);
  const key = $derived(app.open ? threadKey(app.open) : "");
  const keys = $derived(key ? [key] : []);
  const labels = $derived(thread?.labelIds ?? []);
  const inInbox = $derived(labels.includes("INBOX"));
  const inTrash = $derived(labels.includes("TRASH"));
  const inSpam = $derived(labels.includes("SPAM"));
  const starred = $derived(labels.includes("STARRED"));
  const real = $derived(thread?.messages.filter((m) => !m.labelIds.includes("DRAFT")) ?? []);
  const lastReal = $derived(real[real.length - 1]);
  const userLabels = $derived.by(() => {
    if (!thread) return [];
    const user = app.userLabels(thread.account);
    return user.filter((l) => labels.includes(l.id)).map((l) => ({ id: l.id, name: l.name }));
  });

  // Expand unread messages and the latest one, like Gmail. Messages that
  // arrive while the conversation is open (e.g. your reply) open too.
  let lastThreadId = "";
  let known = new Set<string>();
  $effect(() => {
    if (!thread) return;
    if (thread.id !== lastThreadId) {
      lastThreadId = thread.id;
      known = new Set(thread.messages.map((m) => m.id));
      const open = new Set<string>();
      thread.messages.forEach((m) => {
        if (m.labelIds.includes("UNREAD")) open.add(m.id);
      });
      if (lastReal) open.add(lastReal.id);
      expanded = open;
      contacts.harvest(thread);
      queueMicrotask(() => scroller?.scrollTo({ top: 0 }));
      return;
    }
    const fresh = thread.messages.filter((m) => !known.has(m.id) && !m.labelIds.includes("DRAFT"));
    if (fresh.length) {
      fresh.forEach((m) => known.add(m.id));
      expanded = new Set([...expanded, ...fresh.map((m) => m.id)]);
    }
  });

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

  function reply(mode: "reply" | "replyAll" | "forward") {
    if (!thread || !lastReal) return;
    if (mode === "forward") composer.openForward(thread, lastReal);
    else composer.openReply(thread, lastReal, mode);
  }

  const multipleRecipients = $derived(lastReal ? lastReal.to.length + lastReal.cc.length > 1 : false);
</script>

<section class="reader">
  <header>
    {#if showBack}
      <button class="icon-btn" aria-label="Back" onclick={() => app.closeThread()}><ArrowLeft size={20} strokeWidth={1.7} /></button>
    {/if}
    <div class="actions">
      {#if thread}
        {#if inTrash}
          <button class="text-btn" onclick={() => app.restoreFromTrash(keys)}>Restore</button>
          <button class="text-btn danger" onclick={() => app.deleteForever(keys)}>Delete forever</button>
        {:else if inSpam}
          <button class="text-btn" onclick={() => app.notSpam(keys)}>Not spam</button>
          <button class="icon-btn" aria-label="Delete" title="Delete (#)" onclick={() => app.trash(keys)}><Trash2 size={19} strokeWidth={1.7} /></button>
        {:else}
          {#if inInbox}
            <button class="icon-btn" aria-label="Archive" title="Archive (e)" onclick={() => app.archive(keys)}><Archive size={19} strokeWidth={1.7} /></button>
          {:else}
            <button class="icon-btn" aria-label="Move to Inbox" title="Move to Inbox" onclick={() => app.moveToInbox(keys)}><Inbox size={19} strokeWidth={1.7} /></button>
          {/if}
          <button class="icon-btn" aria-label="Delete" title="Delete (#)" onclick={() => app.trash(keys)}><Trash2 size={19} strokeWidth={1.7} /></button>
          <button class="icon-btn" aria-label="Mark unread" title="Mark unread (shift+u)" onclick={() => app.markOpenUnread()}><Mail size={19} strokeWidth={1.7} /></button>
          <button class="icon-btn" class:on={starred} aria-label="Star" title="Star (s)" onclick={() => app.toggleStar(keys)}>
            <Star size={19} strokeWidth={1.7} fill={starred ? "currentColor" : "none"} />
          </button>
          <button class="icon-btn" aria-label="More" bind:this={moreAnchor} onclick={() => (moreOpen = !moreOpen)}><Ellipsis size={19} strokeWidth={1.7} /></button>
        {/if}
      {/if}
    </div>
  </header>

  <div class="scroll body" bind:this={scroller}>
    {#if app.threadLoading && !thread}
      <div class="center"><span class="spinner"></span></div>
    {:else if app.threadError}
      <div class="center">
        <p class="muted">{app.threadError}</p>
        <button class="text-btn" onclick={() => app.open && app.openThread(app.open)}>Try again</button>
      </div>
    {:else if thread}
      <div class="inner">
        <h1>{thread.subject || "(no subject)"}</h1>
        {#if userLabels.length}
          <div class="labels">
            {#each userLabels as l (l.id)}<span class="label">{l.name}</span>{/each}
          </div>
        {/if}
        {#each thread.messages as m (m.id)}
          <MessageItem thread={thread} message={m} expanded={expanded.has(m.id)} ontoggle={() => toggle(m.id)} />
        {/each}
        {#if lastReal}
          <div class="replybar">
            {#if settings.value.defaultReply === "replyAll" && multipleRecipients}
              <button class="pill" onclick={() => reply("replyAll")}><ReplyAll size={16} strokeWidth={1.7} /> Reply all</button>
              <button class="pill" onclick={() => reply("reply")}><Reply size={16} strokeWidth={1.7} /> Reply</button>
            {:else}
              <button class="pill" onclick={() => reply("reply")}><Reply size={16} strokeWidth={1.7} /> Reply</button>
              {#if multipleRecipients}<button class="pill" onclick={() => reply("replyAll")}><ReplyAll size={16} strokeWidth={1.7} /> Reply all</button>{/if}
            {/if}
            <button class="pill" onclick={() => reply("forward")}><Forward size={16} strokeWidth={1.7} /> Forward</button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</section>

<Popover open={moreOpen} anchor={moreAnchor} onclose={() => (moreOpen = false)}>
  <button onclick={() => ((moreOpen = false), (picker = "move"))}><span class="mi"><FolderInput size={15} strokeWidth={1.7} /> Move to…</span></button>
  <button onclick={() => ((moreOpen = false), (picker = "labels"))}><span class="mi"><Tag size={15} strokeWidth={1.7} /> Labels…</span></button>
  <hr />
  <button onclick={() => ((moreOpen = false), app.reportSpam(keys))}>Report spam</button>
</Popover>

{#if picker}
  <LabelPicker {keys} mode={picker} onclose={() => (picker = null)} />
{/if}

<style>
  .reader {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: var(--bg);
  }
  header {
    display: flex;
    align-items: center;
    gap: 4px;
    height: calc(var(--header-h) + var(--safe-top));
    padding: var(--safe-top) calc(10px + var(--safe-right)) 0 10px;
    flex: none;
  }
  .actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .body {
    flex: 1;
    min-height: 0;
  }
  .inner {
    max-width: 820px;
    margin: 0 auto;
    padding: 8px 28px calc(40px + var(--safe-bottom));
  }
  @media (max-width: 640px) {
    .inner {
      padding: 4px 18px calc(32px + var(--safe-bottom));
    }
  }
  h1 {
    font-size: 22px;
    line-height: 1.3;
    font-weight: 600;
    letter-spacing: -0.015em;
    margin: 6px 0 8px;
    word-break: break-word;
  }
  .labels {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }
  .label {
    font-size: 12px;
    color: var(--text-2);
    background: var(--bg-3);
    padding: 2px 8px;
    border-radius: 6px;
  }
  .replybar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 20px 0 0;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 16px;
    border: 1px solid var(--line-2);
    border-radius: 999px;
    font-size: 14px;
    color: var(--text);
  }
  .pill:hover {
    background: var(--bg-hover);
  }
  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 80px 20px;
  }
  .mi {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
</style>
