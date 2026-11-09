<script lang="ts">
  import { Menu, Search, SquarePen, X, Archive, Trash2, MailOpen, Mail, Pin, Ellipsis, ArrowLeft, Inbox } from "@lucide/svelte";
  import { app, ALL, threadKey } from "../lib/app.svelte";
  import { composer } from "../lib/compose.svelte";
  import { settings, type SwipeAction } from "../lib/settings.svelte";
  import ThreadRow from "./ThreadRow.svelte";
  import Popover from "./Popover.svelte";
  import LabelPicker from "./LabelPicker.svelte";
  import type { ThreadSummary } from "../lib/mail/types";

  interface Props {
    persistentSidebar: boolean;
  }
  let { persistentSidebar }: Props = $props();

  let scroller = $state<HTMLDivElement>();
  let sentinel = $state<HTMLDivElement>();
  let searching = $state(false);
  let query = $state("");
  let searchInput = $state<HTMLInputElement>();
  let previousView = $state(app.view);
  let pull = $state(0);
  let pullStart: number | null = null;
  let moreOpen = $state(false);
  let moreAnchor = $state<HTMLElement>();
  let pickerOpen = $state(false);

  const selecting = $derived(app.selection.size > 0);
  const selected = $derived([...app.selection]);
  const selectedThreads = $derived(app.threads.filter((t) => app.selection.has(threadKey(t))));
  const anyUnread = $derived(selectedThreads.some((t) => t.unread));
  const allPinned = $derived(selectedThreads.length > 0 && selectedThreads.every((t) => t.pinned));
  const label = $derived(app.viewLabel);
  const inTrash = $derived(label === "TRASH");
  const inSpam = $derived(label === "SPAM");

  // Restore a fresh search box when the view changes away from search.
  $effect(() => {
    if (app.view.kind !== "search") {
      searching = false;
      query = "";
    }
  });

  $effect(() => {
    if (!sentinel || !scroller) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) app.loadMore();
      },
      { root: scroller, rootMargin: "600px" },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  });

  // Scroll to top when the view changes.
  $effect(() => {
    void app.view;
    void app.current;
    scroller?.scrollTo({ top: 0 });
  });

  $effect(() => {
    const h = () => startSearch();
    window.addEventListener("carrier:search", h);
    return () => window.removeEventListener("carrier:search", h);
  });

  function startSearch() {
    previousView = app.view.kind === "label" ? app.view : previousView;
    searching = true;
    queueMicrotask(() => searchInput?.focus());
  }

  function submitSearch(e: Event) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (app.current === ALL && app.accounts.length) {
      // Search runs per account; use the first account when in All inboxes.
      app.current = app.accounts[0].email;
    }
    app.setView({ kind: "search", q });
    searchInput?.blur();
  }

  function cancelSearch() {
    searching = false;
    query = "";
    if (app.view.kind === "search") app.setView(previousView.kind === "label" ? previousView : { kind: "label", label: "INBOX" });
  }

  function removes(a: SwipeAction): boolean {
    if (a === "trash") return true;
    if (a === "archive") return app.isInboxView || inTrash || inSpam || app.current === ALL;
    if (a === "pin") return label === "PINNED";
    return false;
  }

  function swipe(t: { account: string; id: string }, a: SwipeAction) {
    const k = [threadKey(t)];
    if (a === "archive") {
      if (inTrash) app.restoreFromTrash(k);
      else if (inSpam) app.notSpam(k);
      else app.archive(k);
    } else if (a === "trash") app.trash(k);
    else if (a === "read") app.toggleRead(k);
    else if (a === "pin") app.togglePin(k);
  }

  function toggleCheck(t: { account: string; id: string }) {
    const k = threadKey(t);
    if (app.selection.has(k)) app.selection.delete(k);
    else app.selection.add(k);
  }

  function ontouchstart(e: TouchEvent) {
    // Dragging a pinned row's handle is not a pull to refresh.
    if ((e.target as Element | null)?.closest?.(".handle")) return;
    if (scroller && scroller.scrollTop <= 0 && !selecting) pullStart = e.touches[0].clientY;
  }
  function ontouchmove(e: TouchEvent) {
    if (pullStart == null || drag) return;
    const dy = e.touches[0].clientY - pullStart;
    if (dy <= 0 || (scroller && scroller.scrollTop > 0)) {
      pull = 0;
      return;
    }
    pull = Math.min(90, dy * 0.45);
  }
  function ontouchend() {
    if (pull > 56) app.refresh();
    pull = 0;
    pullStart = null;
  }

  /** Opens a row from the Drafts section straight into compose. */
  async function openDraftRow(t: (typeof app.threads)[number]) {
    try {
      const thread = await app.backend(t.account).getThread(t.id);
      const draft =
        thread.messages.find((m) => m.id === t.draft?.messageId) ?? [...thread.messages].reverse().find((m) => m.labelIds.includes("DRAFT"));
      if (draft) composer.openDraft(t.account, draft, thread.id);
    } catch (e) {
      app.handleError(e, t.account);
    }
  }

  const draftsMore = $derived(Math.max(0, app.draftsTotal - app.drafts.length));
  // app.threads keeps pinned conversations first, in the user's order; they get their own section
  // (headed everywhere except the Pinned mailbox, where every conversation is pinned).
  const pinnedRows = $derived(app.threads.filter((t) => t.pinned));
  const restRows = $derived(app.threads.filter((t) => !t.pinned));

  // ---- reordering pinned conversations ------------------------------------

  let pinnedBox = $state<HTMLDivElement>();
  /** The drag in progress: which row, where it would land, and how far it has moved. */
  let drag = $state<{ from: number; to: number; dy: number; height: number } | null>(null);

  function startReorder(e: PointerEvent, index: number) {
    if (!pinnedBox || drag) return;
    const items = [...pinnedBox.children] as HTMLElement[];
    const rects = items.map((el) => el.getBoundingClientRect());
    const startY = e.clientY;
    const startScroll = scroller?.scrollTop ?? 0;
    drag = { from: index, to: index, dy: 0, height: rects[index].height };
    const move = (ev: PointerEvent) => {
      if (!drag || ev.pointerId !== e.pointerId) return;
      ev.preventDefault();
      const dy = ev.clientY - startY + ((scroller?.scrollTop ?? 0) - startScroll);
      const centre = rects[index].top + rects[index].height / 2 + dy;
      // The new index is the number of other rows whose middle is above the dragged row's middle.
      const to = rects.filter((r, i) => i !== index && r.top + r.height / 2 < centre).length;
      drag = { ...drag, dy, to };
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      const d = drag;
      drag = null;
      if (!d || d.to === d.from || ev.type === "pointercancel") return;
      const keys = pinnedRows.map(threadKey);
      const [moved] = keys.splice(d.from, 1);
      keys.splice(d.to, 0, moved);
      app.reorderPins(keys);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  /** How far a pinned row is displaced while another row is dragged over it. */
  function shift(i: number): number {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.height;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return drag.height;
    return 0;
  }
  const showDrafts = $derived(app.showsDrafts && app.drafts.length > 0 && !selecting);

  async function openRow(t: (typeof app.threads)[number]) {
    // Draft-only conversations open straight into compose.
    if (t.hasDraft && (t.messageCount <= 1 || label === "DRAFT") && t.labelIds.includes("DRAFT")) {
      const thread = await app.backend(t.account).getThread(t.id);
      const draft = [...thread.messages].reverse().find((m) => m.labelIds.includes("DRAFT"));
      const others = thread.messages.filter((m) => !m.labelIds.includes("DRAFT"));
      if (draft && (label === "DRAFT" || !others.length)) {
        composer.openDraft(t.account, draft, thread.id);
        return;
      }
    }
    app.openThread(t);
  }
</script>

{#snippet row(t: ThreadSummary, pinIndex = -1)}
  <ThreadRow
    thread={t}
    active={!!app.open && threadKey(app.open) === threadKey(t)}
    checked={app.selection.has(threadKey(t))}
    {selecting}
    showAccount={app.current === ALL}
    color={app.accountColor(t.account)}
    sentView={label === "SENT"}
    swipeLeft={settings.value.swipeLeft}
    swipeRight={settings.value.swipeRight}
    {removes}
    onopen={() => openRow(t)}
    oncheck={() => toggleCheck(t)}
    onswipe={(a) => swipe(t, a)}
    onpin={() => app.togglePin([threadKey(t)])}
    note={pinIndex >= 0 ? app.pinNote(threadKey(t)) : undefined}
    onnote={pinIndex >= 0 ? (n) => app.setPinNote(threadKey(t), n) : undefined}
    onreorder={pinIndex >= 0 && pinnedRows.length > 1 ? (e) => startReorder(e, pinIndex) : undefined}
  />
{/snippet}

<section class="list">
  <header>
    {#if selecting}
      <button class="icon-btn" aria-label="Clear selection" onclick={() => app.selection.clear()}><X size={20} strokeWidth={1.7} /></button>
      <span class="title">{app.selection.size}</span>
      <div class="actions">
        {#if inTrash}
          <button class="text-btn" onclick={() => app.restoreFromTrash(selected)}>Restore</button>
          <button class="text-btn danger" onclick={() => app.deleteForever(selected)}>Delete forever</button>
        {:else if inSpam}
          <button class="text-btn" onclick={() => app.notSpam(selected)}>Not spam</button>
          <button class="text-btn danger" onclick={() => app.deleteForever(selected)}>Delete forever</button>
        {:else}
          {#if app.isInboxView || app.current === ALL || label === "ALL" || app.view.kind === "search" || selectedThreads.some((t) => t.labelIds.includes("INBOX"))}
            <button class="icon-btn" aria-label="Archive" title="Archive" onclick={() => app.archive(selected)}><Archive size={19} strokeWidth={1.7} /></button>
          {:else}
            <button class="icon-btn" aria-label="Move to Inbox" title="Move to Inbox" onclick={() => app.moveToInbox(selected)}><Inbox size={19} strokeWidth={1.7} /></button>
          {/if}
          <button class="icon-btn" aria-label="Delete" title="Delete" onclick={() => app.trash(selected)}><Trash2 size={19} strokeWidth={1.7} /></button>
          <button class="icon-btn" aria-label={anyUnread ? "Mark read" : "Mark unread"} title={anyUnread ? "Mark read" : "Mark unread"} onclick={() => app.setRead(selected, anyUnread)}>
            {#if anyUnread}<MailOpen size={19} strokeWidth={1.7} />{:else}<Mail size={19} strokeWidth={1.7} />{/if}
          </button>
          <button class="icon-btn" class:on={allPinned} aria-label={allPinned ? "Unpin" : "Pin"} title={allPinned ? "Unpin" : "Pin to top"} onclick={() => app.setPin(selected, !allPinned)}>
            <Pin size={19} strokeWidth={1.7} fill={allPinned ? "currentColor" : "none"} />
          </button>
          <button class="icon-btn" aria-label="More" bind:this={moreAnchor} onclick={() => (moreOpen = !moreOpen)}><Ellipsis size={19} strokeWidth={1.7} /></button>
        {/if}
      </div>
    {:else if searching || app.view.kind === "search"}
      <button class="icon-btn" aria-label="Back" onclick={cancelSearch}><ArrowLeft size={20} strokeWidth={1.7} /></button>
      <form class="search" onsubmit={submitSearch}>
        <input
          bind:this={searchInput}
          bind:value={query}
          type="search"
          placeholder={app.view.kind === "search" ? app.view.q : "Search mail"}
          enterkeyhint="search"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          onkeydown={(e) => e.key === "Escape" && cancelSearch()}
        />
      </form>
    {:else}
      {#if !persistentSidebar}
        <button class="icon-btn" aria-label="Menu" onclick={() => (app.sidebarOpen = true)}><Menu size={20} strokeWidth={1.7} /></button>
      {/if}
      <span class="title">{app.viewTitle}</span>
      {#if app.refreshing}<span class="spinner small"></span>{/if}
      <div class="actions">
        <button class="icon-btn" aria-label="Search" title="Search (/)" onclick={startSearch}><Search size={19} strokeWidth={1.7} /></button>
        <button class="icon-btn" aria-label="Compose" title="Compose (c)" onclick={() => composer.openNew()}><SquarePen size={19} strokeWidth={1.7} /></button>
      </div>
    {/if}
  </header>

  {#if (inTrash || inSpam) && app.current !== ALL && app.threads.length && !selecting}
    <div class="banner">
      <span>{inTrash ? "Messages in Trash are deleted after 30 days." : "Messages in Spam are deleted after 30 days."}</span>
      <button class="text-btn danger" onclick={() => app.emptyFolder(inTrash ? "TRASH" : "SPAM")}>Empty now</button>
    </div>
  {/if}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="scroll body" bind:this={scroller} {ontouchstart} {ontouchmove} {ontouchend} ontouchcancel={ontouchend}>
    <div class="pull" style:height="{pull}px" class:ready={pull > 56}>
      {#if pull > 8}<span class="spinner" style:transform="rotate({pull * 4}deg)"></span>{/if}
    </div>
    {#if app.loading && !app.threads.length}
      <div class="empty"><span class="spinner"></span></div>
    {:else if app.listError && !app.threads.length}
      <div class="empty">
        <p>{app.listError}</p>
        <button class="text-btn" onclick={() => app.loadList()}>Try again</button>
      </div>
    {:else if !app.threads.length && !app.drafts.length}
      <div class="empty"><p class="muted">{app.view.kind === "search" ? "No results" : `Nothing in ${app.viewTitle}`}</p></div>
    {:else}
      {#if pinnedRows.length}
        {#if app.showsPinned}<div class="section"><span>Pinned</span></div>{/if}
        <div class="pinned" class:dragging={!!drag} bind:this={pinnedBox}>
          {#each pinnedRows as t, i (threadKey(t))}
            <div class="pinitem" class:lifted={drag?.from === i} style:transform={drag ? `translate3d(0, ${shift(i)}px, 0)` : undefined}>
              {@render row(t, i)}
            </div>
          {/each}
        </div>
      {/if}
      {#if showDrafts}
        <div class="section">
          <span>Drafts</span>
          {#if draftsMore > 0}
            <button class="more" onclick={() => app.setView({ kind: "label", label: "DRAFT" })}>{draftsMore} more</button>
          {/if}
        </div>
        {#each app.drafts as t (threadKey(t) + ":draft")}
          <ThreadRow
            thread={t}
            active={false}
            checked={false}
            selecting={false}
            showAccount={false}
            color={app.accountColor(t.account)}
            sentView={false}
            draftView={true}
            swipeLeft="none"
            swipeRight="none"
            removes={() => false}
            onopen={() => openDraftRow(t)}
            oncheck={() => {}}
            onswipe={() => {}}
            onpin={() => {}}
          />
        {/each}
      {/if}
      {#if (pinnedRows.length || showDrafts) && restRows.length}
        <div class="section">
          <span>{app.current === ALL && app.isInboxView ? "Inbox" : app.viewTitle}</span>
        </div>
      {/if}
      {#each restRows as t (threadKey(t))}{@render row(t)}{/each}
      <div bind:this={sentinel} class="sentinel">
        {#if app.loadingMore}<span class="spinner"></span>{/if}
      </div>
    {/if}
  </div>
</section>

<Popover open={moreOpen} anchor={moreAnchor} onclose={() => (moreOpen = false)}>
  <button onclick={() => { moreOpen = false; pickerOpen = true; }}>Move to…</button>
  <button onclick={() => { moreOpen = false; app.reportSpam(selected); }}>Report spam</button>
  <button onclick={() => { moreOpen = false; app.selection.clear(); app.threads.forEach((t) => app.selection.add(threadKey(t))); }}>Select all</button>
</Popover>

{#if pickerOpen}
  <LabelPicker keys={selected} onclose={() => (pickerOpen = false)} />
{/if}

<style>
  .list {
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
    padding: var(--safe-top) 10px 0 10px;
    flex: none;
    border-bottom: 1px solid transparent;
  }
  .title {
    font-size: 17px;
    font-weight: 600;
    padding-left: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    letter-spacing: -0.01em;
  }
  .spinner.small {
    width: 13px;
    height: 13px;
    margin-left: 6px;
  }
  .actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .search {
    flex: 1;
    min-width: 0;
  }
  .search input {
    width: 100%;
    height: 38px;
    border: none;
    outline: none;
    background: var(--bg-2);
    border-radius: 10px;
    padding: 0 12px;
    font-size: 15px;
    -webkit-appearance: none;
    appearance: none;
  }
  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 12px 6px 26px;
    font-size: 13px;
    color: var(--text-2);
    border-bottom: 1px solid var(--line);
  }
  .body {
    flex: 1;
    min-height: 0;
    padding-bottom: var(--safe-bottom);
  }
  .pull {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .pull.ready .spinner {
    border-top-color: var(--accent);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 80px 24px;
    text-align: center;
    color: var(--text-2);
  }
  .empty p {
    margin: 0;
  }
  .section {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 14px 18px 4px 30px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .section .more {
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
    color: var(--text-2);
  }
  .pinned {
    position: relative;
  }
  .pinned.dragging {
    -webkit-user-select: none;
    user-select: none;
    cursor: grabbing;
  }
  .pinned.dragging .pinitem:not(.lifted) {
    transition: transform 0.15s ease-out;
  }
  .pinitem.lifted {
    position: relative;
    z-index: 3;
    box-shadow: var(--shadow);
    border-radius: 10px;
    overflow: hidden;
  }
  .sentinel {
    display: flex;
    justify-content: center;
    padding: 20px;
    min-height: 40px;
  }
</style>
