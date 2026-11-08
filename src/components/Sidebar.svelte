<script lang="ts">
  import { ChevronDown, Plus, Settings as Gear, CircleAlert } from "@lucide/svelte";
  import { app, ALL, SYSTEM_NAMES } from "../lib/app.svelte";
  import { settings } from "../lib/settings.svelte";

  interface Props {
    onsettings: () => void;
  }
  let { onsettings }: Props = $props();

  let accountsOpen = $state(false);

  /** The account whose folders are listed (All inboxes uses the first). */
  const focus = $derived(app.current === ALL ? (app.accounts[0]?.email ?? "") : app.current);
  const focusAccount = $derived(app.account(focus));

  const primary = $derived(settings.value.inboxType === "primary");
  const folders = $derived([
    "INBOX",
    ...(primary ? ["CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS"] : []),
    "PINNED",
    "IMPORTANT",
    "SENT",
    "DRAFT",
    "ALL",
    "SPAM",
    "TRASH",
  ]);
  const userLabels = $derived(app.userLabels(focus));

  function isActive(id: string) {
    return app.current !== ALL && app.current === focus && app.view.kind === "label" && app.view.label === id;
  }

  function go(id: string) {
    if (app.current !== focus) app.current = focus;
    app.setView({ kind: "label", label: id });
  }

  function name(id: string) {
    if (id === "INBOX") return primary ? "Primary" : "Inbox";
    return SYSTEM_NAMES[id] ?? id;
  }

  function count(id: string) {
    // Gmail shows unread counts for inbox-like folders and totals for drafts.
    if (["INBOX", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS", "SPAM", "DRAFT"].includes(id) || !SYSTEM_NAMES[id]) {
      const n = app.unreadCount(focus, id);
      return n > 0 ? (n > 999 ? "999+" : String(n)) : "";
    }
    return "";
  }

  function pickAccount(email: string) {
    accountsOpen = false;
    app.switchAccount(email);
  }
</script>

<nav class="sidebar">
  <div class="top">
    <button class="account" onclick={() => (accountsOpen = !accountsOpen)} aria-expanded={accountsOpen}>
      <span class="who">
        <span class="name">{app.current === ALL ? "All accounts" : (focusAccount?.name ?? focus)}</span>
        <span class="email">{app.current === ALL ? `${app.accounts.length} accounts` : focus}</span>
      </span>
      <span class="chev" class:open={accountsOpen}><ChevronDown size={16} strokeWidth={1.8} /></span>
    </button>
    {#if app.demo}<span class="demo">Demo</span>{/if}
  </div>

  <div class="scroll items">
    {#if accountsOpen}
      <div class="group accounts">
        {#if app.accounts.length > 1}
          <button class="item" class:active={app.current === ALL} onclick={() => pickAccount(ALL)}>
            <span>All inboxes</span>
            <span class="count">{app.unreadCount(ALL, "INBOX") || ""}</span>
          </button>
        {/if}
        {#each app.accounts as a (a.email)}
          <button class="item" class:active={app.current === a.email} onclick={() => pickAccount(a.email)}>
            <span class="ellipsis with-dot"><span class="dot" style:background={app.accountColor(a.email)}></span>{a.email}</span>
            {#if a.needsReauth}
              <span class="warn" title="Sign in again"><CircleAlert size={15} strokeWidth={1.8} /></span>
            {:else}
              <span class="count">{app.unreadCount(a.email, "INBOX") || ""}</span>
            {/if}
          </button>
        {/each}
        <button class="item subtle" onclick={() => { accountsOpen = false; app.addAccount(); }}>
          <span class="with-icon"><Plus size={15} strokeWidth={1.8} /> Add Google account</span>
        </button>
      </div>
    {/if}

    {#if app.accounts.length > 1 && !accountsOpen}
      <div class="group">
        <button class="item" class:active={app.current === ALL} onclick={() => pickAccount(ALL)}>
          <span>All inboxes</span>
          <span class="count">{app.unreadCount(ALL, "INBOX") || ""}</span>
        </button>
      </div>
    {/if}

    <div class="group">
      {#each folders as id, i (id)}
        {#if i === 1 && primary}<div class="sep"></div>{/if}
        {#if id === "PINNED"}<div class="sep"></div>{/if}
        <button class="item" class:active={isActive(id)} class:indent={id.startsWith("CATEGORY_")} onclick={() => go(id)}>
          <span>{name(id)}</span>
          <span class="count">{count(id)}</span>
        </button>
      {/each}
    </div>

    {#if userLabels.length}
      <div class="group">
        <div class="heading">Labels</div>
        {#each userLabels as l (l.id)}
          <button class="item" class:active={isActive(l.id)} style:padding-left="{16 + (l.name.split('/').length - 1) * 14}px" onclick={() => go(l.id)}>
            <span class="ellipsis">{l.name.split("/").pop()}</span>
            <span class="count">{count(l.id)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="bottom">
    <button class="item" onclick={onsettings}>
      <span class="with-icon"><Gear size={16} strokeWidth={1.7} /> Settings</span>
    </button>
  </div>
</nav>

<style>
  .sidebar {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg-2);
    padding-top: var(--safe-top);
    padding-left: var(--safe-left);
  }
  .top {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px 8px 8px;
    min-height: var(--header-h);
  }
  .account {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-radius: 10px;
    text-align: left;
  }
  .account:hover {
    background: var(--bg-hover);
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .email {
    font-size: 12px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chev {
    display: flex;
    color: var(--text-3);
    transition: transform 0.15s;
  }
  .chev.open {
    transform: rotate(180deg);
  }
  .demo {
    font-size: 11px;
    color: var(--text-3);
    border: 1px solid var(--line-2);
    border-radius: 6px;
    padding: 1px 6px;
  }
  .items {
    flex: 1;
    min-height: 0;
    padding: 0 8px;
  }
  .group {
    padding: 4px 0;
  }
  .group + .group {
    border-top: 1px solid var(--line);
  }
  .accounts {
    padding-bottom: 8px;
  }
  .heading {
    font-size: 12px;
    color: var(--text-3);
    padding: 10px 12px 4px;
    letter-spacing: 0.02em;
  }
  .sep {
    height: 6px;
  }
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 9px;
    text-align: left;
    font-size: 14.5px;
    color: var(--text);
    min-height: 38px;
  }
  .item:hover {
    background: var(--bg-hover);
  }
  .item.active {
    background: var(--bg-selected);
    font-weight: 600;
  }
  .item.indent {
    padding-left: 26px;
    color: var(--text-2);
  }
  .item.indent.active {
    color: var(--text);
  }
  .item.subtle {
    color: var(--text-2);
  }
  .count {
    font-size: 12px;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .with-dot {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .warn {
    color: var(--danger);
    display: flex;
  }
  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .with-icon {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .bottom {
    padding: 6px 8px calc(8px + var(--safe-bottom));
    border-top: 1px solid var(--line);
  }
</style>
