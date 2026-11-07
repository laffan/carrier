<script lang="ts">
  import { Check } from "@lucide/svelte";
  import { app, threadKey } from "../lib/app.svelte";
  import Sheet from "./Sheet.svelte";

  interface Props {
    keys: string[];
    /** "move" moves to one folder; "labels" toggles any number of labels. */
    mode?: "move" | "labels";
    onclose: () => void;
  }
  let { keys, mode = "move", onclose }: Props = $props();

  const account = $derived(keys[0]?.split("|")[0] ?? "");
  const sameAccount = $derived(keys.every((k) => k.startsWith(account + "|")));
  const labels = $derived(app.userLabels(account));
  const threads = $derived(app.threads.filter((t) => keys.includes(threadKey(t))));
  const openLabels = $derived(app.thread && keys.includes(threadKey(app.thread)) ? app.thread.labelIds : []);

  function has(id: string): boolean {
    const sets = threads.length ? threads.map((t) => t.labelIds) : [openLabels];
    return sets.every((s) => s.includes(id));
  }

  let checked = $state<Record<string, boolean>>({});
  $effect.pre(() => {
    if (mode === "labels") checked = Object.fromEntries(labels.map((l) => [l.id, has(l.id)]));
  });

  function move(id: string) {
    onclose();
    app.moveTo(keys, id);
  }

  function apply() {
    const add = labels.filter((l) => checked[l.id] && !has(l.id)).map((l) => l.id);
    const remove = labels.filter((l) => !checked[l.id] && has(l.id)).map((l) => l.id);
    onclose();
    if (add.length || remove.length) app.modify(keys, add, remove, "Labels updated");
  }

  function depth(name: string) {
    return name.split("/").length - 1;
  }
</script>

<Sheet {onclose} width={420}>
  <div class="head">
    <span>{mode === "move" ? "Move to" : "Labels"}</span>
    {#if mode === "labels"}<button class="text-btn primary" onclick={apply}>Done</button>{/if}
  </div>
  <div class="scroll items">
    {#if !sameAccount}
      <p class="muted pad">Select conversations from one account to change labels.</p>
    {:else if mode === "move"}
      <button class="item" onclick={() => move("INBOX")}>Inbox</button>
      {#each labels as l (l.id)}
        <button class="item" style:padding-left="{20 + depth(l.name) * 16}px" onclick={() => move(l.id)}>{l.name.split("/").pop()}</button>
      {/each}
      <button class="item" onclick={() => move("SPAM")}>Spam</button>
    {:else}
      {#each labels as l (l.id)}
        <button class="item check" style:padding-left="{20 + depth(l.name) * 16}px" onclick={() => (checked[l.id] = !checked[l.id])}>
          <span>{l.name.split("/").pop()}</span>
          {#if checked[l.id]}<Check size={17} strokeWidth={2} />{/if}
        </button>
      {:else}
        <p class="muted pad">No labels yet. Create labels in Gmail.</p>
      {/each}
    {/if}
  </div>
</Sheet>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 10px 20px;
    font-weight: 600;
    min-height: 56px;
  }
  .items {
    padding: 0 0 12px;
  }
  .item {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    text-align: left;
    font-size: 15px;
  }
  .item:hover {
    background: var(--bg-hover);
  }
  .item.check :global(svg) {
    color: var(--accent);
  }
  .pad {
    padding: 0 20px;
  }
</style>
