<script lang="ts">
  import { Reply, ReplyAll, Forward, Ellipsis } from "@lucide/svelte";
  import { app } from "../lib/app.svelte";
  import { composer } from "../lib/compose.svelte";
  import { displayName } from "../lib/mail/mime";
  import type { Message, Thread } from "../lib/mail/types";
  import { settings } from "../lib/settings.svelte";
  import { fullDate } from "../lib/util";
  import Attachments from "./Attachments.svelte";
  import MailBody from "./MailBody.svelte";
  import Popover from "./Popover.svelte";

  interface Props {
    thread: Thread;
    message: Message;
    expanded: boolean;
    ontoggle: () => void;
  }
  let { thread, message, expanded, ontoggle }: Props = $props();

  let details = $state(false);
  let menuOpen = $state(false);
  let menuAnchor = $state<HTMLElement>();

  const account = $derived(app.account(thread.account));
  const mine = $derived(
    new Set([thread.account.toLowerCase(), ...(account?.sendAs ?? []).map((s) => s.email.toLowerCase())]),
  );
  const isDraft = $derived(message.labelIds.includes("DRAFT"));
  const fromMe = $derived(mine.has(message.from.email.toLowerCase()));
  const recipients = $derived(
    [...message.to, ...message.cc]
      .map((a) => (mine.has(a.email.toLowerCase()) ? "me" : displayName(a)))
      .join(", "),
  );

  function reply(mode: "reply" | "replyAll") {
    composer.openReply(thread, message, mode);
  }

  async function markUnreadFromHere() {
    menuOpen = false;
    const idx = thread.messages.findIndex((m) => m.id === message.id);
    const ids = thread.messages.slice(idx).map((m) => m.id);
    try {
      await app.backend(thread.account).modifyMessages(ids, ["UNREAD"], []);
      app.closeThread();
      app.refresh();
    } catch (err) {
      app.handleError(err, thread.account);
    }
  }

  function fmt(list: { name: string; email: string }[]) {
    return list.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ");
  }
</script>

<article class="msg" class:expanded class:draft={isDraft}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="head" onclick={isDraft ? () => composer.openDraft(thread.account, message, thread.id) : ontoggle}>
    <div class="who">
      <div class="line">
        <span class="from" class:unread={message.labelIds.includes("UNREAD")}>
          {#if isDraft}<span class="draft-tag">Draft</span>{:else}{fromMe ? "me" : displayName(message.from)}{/if}
        </span>
        <span class="date">{fullDate(message.date)}</span>
      </div>
      {#if expanded && !isDraft}
        <button
          class="to"
          onclick={(e) => {
            e.stopPropagation();
            details = !details;
          }}>to {recipients || "undisclosed recipients"}</button
        >
      {:else}
        <div class="snippet">{message.snippet}</div>
      {/if}
    </div>
    {#if expanded && !isDraft}
      <div class="tools">
        <button class="icon-btn small" aria-label="Reply" onclick={(e) => (e.stopPropagation(), reply("reply"))}><Reply size={17} strokeWidth={1.7} /></button>
        <button class="icon-btn small" aria-label="More" bind:this={menuAnchor} onclick={(e) => (e.stopPropagation(), (menuOpen = !menuOpen))}>
          <Ellipsis size={17} strokeWidth={1.7} />
        </button>
      </div>
    {/if}
  </div>

  {#if expanded && details && !isDraft}
    <dl class="details">
      <dt>From</dt><dd>{fmt([message.from])}</dd>
      {#if message.replyTo.length}<dt>Reply-to</dt><dd>{fmt(message.replyTo)}</dd>{/if}
      <dt>To</dt><dd>{fmt(message.to)}</dd>
      {#if message.cc.length}<dt>Cc</dt><dd>{fmt(message.cc)}</dd>{/if}
      {#if message.bcc.length}<dt>Bcc</dt><dd>{fmt(message.bcc)}</dd>{/if}
      <dt>Date</dt><dd>{new Date(message.date).toLocaleString()}</dd>
      <dt>Subject</dt><dd>{message.subject}</dd>
    </dl>
  {/if}

  {#if expanded && !isDraft}
    <div class="content">
      <MailBody html={message.html} text={message.text} loadImages={settings.value.loadRemoteImages} />
      <Attachments account={thread.account} attachments={message.attachments} />
    </div>
  {/if}
</article>

<Popover open={menuOpen} anchor={menuAnchor} onclose={() => (menuOpen = false)}>
  <button onclick={() => ((menuOpen = false), reply("reply"))}><span class="mi"><Reply size={15} strokeWidth={1.7} /> Reply</span></button>
  <button onclick={() => ((menuOpen = false), reply("replyAll"))}><span class="mi"><ReplyAll size={15} strokeWidth={1.7} /> Reply all</span></button>
  <button onclick={() => ((menuOpen = false), composer.openForward(thread, message))}><span class="mi"><Forward size={15} strokeWidth={1.7} /> Forward</span></button>
  <hr />
  <button onclick={markUnreadFromHere}>Mark unread from here</button>
</Popover>

<style>
  .msg {
    border-bottom: 1px solid var(--line);
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 14px 0;
    cursor: pointer;
  }
  .expanded .head {
    padding-bottom: 10px;
  }
  .who {
    flex: 1;
    min-width: 0;
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .from {
    font-weight: 600;
    font-size: 15px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .draft-tag {
    color: var(--danger);
    font-weight: 500;
  }
  .date {
    font-size: 12px;
    color: var(--text-3);
    flex: none;
  }
  .snippet {
    font-size: 14px;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 1px;
  }
  .to {
    font-size: 13px;
    color: var(--text-2);
    text-align: left;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
    margin-top: 1px;
  }
  .tools {
    display: flex;
    margin: -8px -8px 0 0;
  }
  .icon-btn.small {
    width: 34px;
    height: 34px;
  }
  .details {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 12px;
    font-size: 13px;
    margin: 0 0 14px;
    padding: 10px 12px;
    background: var(--bg-2);
    border-radius: 10px;
  }
  .details dt {
    color: var(--text-3);
  }
  .details dd {
    margin: 0;
    word-break: break-word;
  }
  .content {
    padding-bottom: 20px;
  }
  .mi {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
</style>
