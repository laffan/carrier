<script lang="ts">
  import { onMount } from "svelte";
  import { app, threadKey } from "./lib/app.svelte";
  import { composer } from "./lib/compose.svelte";
  import Compose from "./components/Compose.svelte";
  import Onboarding from "./components/Onboarding.svelte";
  import Settings from "./components/Settings.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import ThreadList from "./components/ThreadList.svelte";
  import ThreadView from "./components/ThreadView.svelte";
  import Toasts from "./components/Toasts.svelte";

  let width = $state(typeof window !== "undefined" ? window.innerWidth : 1024);
  let settingsOpen = $state(false);

  const twoPane = $derived(width >= 900);
  const persistentSidebar = $derived(width >= 1280);

  onMount(() => {
    app.init();
    const onResize = () => (width = window.innerWidth);
    // Shrink sheets above the on-screen keyboard (iPad).
    const vv = window.visualViewport;
    const onViewport = () => {
      if (vv) document.documentElement.style.setProperty("--vvh", `${vv.height}px`);
    };
    vv?.addEventListener("resize", onViewport);
    onViewport();
    window.addEventListener("resize", onResize);

    // Keep the mailbox fresh while the app is in front.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") app.refresh();
    }, 60_000);
    const onVisible = () => document.visibilityState === "visible" && app.refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      vv?.removeEventListener("resize", onViewport);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("keydown", onKey);
      clearInterval(timer);
    };
  });

  let pendingG = false;

  /** Gmail keyboard shortcuts (for iPad keyboards and macOS). */
  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (composer.draft || settingsOpen) return;
    const key = e.key;
    const open = app.open ? [threadKey(app.open)] : [];
    const targets = app.selection.size ? [...app.selection] : open;

    if (pendingG) {
      pendingG = false;
      const map: Record<string, string> = { i: "INBOX", s: "STARRED", t: "SENT", d: "DRAFT", a: "ALL" };
      if (map[key]) {
        e.preventDefault();
        app.setView({ kind: "label", label: map[key] });
      }
      return;
    }

    const idx = app.open ? app.threads.findIndex((x) => threadKey(x) === threadKey(app.open!)) : -1;
    switch (key) {
      case "g":
        pendingG = true;
        setTimeout(() => (pendingG = false), 1200);
        return;
      case "c":
        e.preventDefault();
        composer.openNew();
        return;
      case "/":
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("carrier:search"));
        return;
      case "j":
      case "ArrowDown": {
        if (key === "ArrowDown" && !app.open) return;
        const next = app.threads[idx + 1];
        if (next) app.openThread(next);
        e.preventDefault();
        return;
      }
      case "k":
      case "ArrowUp": {
        if (key === "ArrowUp" && !app.open) return;
        const prev = app.threads[Math.max(0, idx - 1)];
        if (prev && idx > 0) app.openThread(prev);
        e.preventDefault();
        return;
      }
      case "e":
      case "y":
        if (targets.length) app.archive(targets);
        return;
      case "#":
      case "Delete":
        if (targets.length) app.trash(targets);
        return;
      case "s":
        if (targets.length) app.toggleStar(targets);
        return;
      case "U":
        if (app.selection.size) app.setRead(targets, false);
        else if (app.open) app.markOpenUnread();
        return;
      case "I":
        if (targets.length) app.setRead(targets, true);
        return;
      case "!":
        if (targets.length) app.reportSpam(targets);
        return;
      case "x":
        if (app.open) {
          const k = threadKey(app.open);
          if (app.selection.has(k)) app.selection.delete(k);
          else app.selection.add(k);
        }
        return;
      case "u":
      case "Escape":
        if (app.selection.size) app.selection.clear();
        else if (app.open) app.closeThread();
        return;
      case "Enter":
      case "o":
        if (!app.open && app.threads[0]) app.openThread(app.threads[0]);
        return;
      case "r":
      case "a":
      case "f": {
        const th = app.thread;
        const last = th?.messages.filter((m) => !m.labelIds.includes("DRAFT")).at(-1);
        if (!th || !last) return;
        e.preventDefault();
        if (key === "f") composer.openForward(th, last);
        else composer.openReply(th, last, key === "a" ? "replyAll" : "reply");
        return;
      }
    }
  }
</script>

{#if !app.ready}
  <div class="boot"><span class="spinner"></span></div>
{:else if !app.accounts.length}
  <Onboarding />
{:else}
  <div class="shell" class:two={twoPane}>
    {#if persistentSidebar}
      <aside class="side"><Sidebar onsettings={() => (settingsOpen = true)} /></aside>
    {/if}
    <div class="listpane" class:hidden={!twoPane && !!app.open}>
      <ThreadList {persistentSidebar} />
    </div>
    {#if twoPane}
      <div class="readpane">
        {#if app.open}
          <ThreadView showBack={false} />
        {:else}
          <div class="blank"></div>
        {/if}
      </div>
    {:else if app.open}
      <div class="fullreader">
        <ThreadView showBack={true} />
      </div>
    {/if}
  </div>

  {#if !persistentSidebar && app.sidebarOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="drawer-scrim" onclick={() => (app.sidebarOpen = false)}></div>
    <aside class="drawer"><Sidebar onsettings={() => ((app.sidebarOpen = false), (settingsOpen = true))} /></aside>
  {/if}
{/if}

{#if composer.draft}
  <Compose />
{/if}

{#if settingsOpen}
  <Settings onclose={() => (settingsOpen = false)} />
{/if}

<Toasts />

<style>
  .boot {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .shell {
    display: flex;
    height: 100%;
    padding-left: var(--safe-left);
    padding-right: var(--safe-right);
  }
  .side {
    width: 248px;
    flex: none;
    border-right: 1px solid var(--line);
  }
  .listpane {
    flex: 1;
    min-width: 0;
  }
  .two .listpane {
    flex: none;
    width: clamp(340px, 34vw, 440px);
    border-right: 1px solid var(--line);
  }
  .listpane.hidden {
    display: none;
  }
  .readpane {
    flex: 1;
    min-width: 0;
  }
  .blank {
    height: 100%;
    background: var(--bg);
  }
  .fullreader {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: var(--bg);
    padding-left: var(--safe-left);
    padding-right: var(--safe-right);
    animation: slide 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
  }
  @keyframes slide {
    from {
      transform: translateX(30px);
      opacity: 0.6;
    }
  }
  .drawer-scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.22);
    z-index: 40;
    animation: fade 0.18s;
  }
  .drawer {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(300px, 84vw);
    z-index: 41;
    box-shadow: var(--shadow);
    animation: drawer 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
  }
  @keyframes drawer {
    from {
      transform: translateX(-100%);
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
