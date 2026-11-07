<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    open: boolean;
    anchor?: HTMLElement;
    onclose: () => void;
    align?: "left" | "right";
    children: Snippet;
  }
  let { open, anchor, onclose, align = "right", children }: Props = $props();

  let pos = $state({ top: 0, left: 0, right: 0 });

  $effect(() => {
    if (!open || !anchor) return;
    const r = anchor.getBoundingClientRect();
    pos = { top: r.bottom + 6, left: r.left, right: window.innerWidth - r.right };
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="scrim" onclick={onclose} oncontextmenu={(e) => (e.preventDefault(), onclose())}></div>
  <div
    class="pop"
    role="menu"
    tabindex="-1"
    style:top="{pos.top}px"
    style:left={align === "left" ? `${pos.left}px` : undefined}
    style:right={align === "right" ? `${pos.right}px` : undefined}
    onkeydown={(e) => e.key === "Escape" && onclose()}
  >
    {@render children()}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 80;
  }
  .pop {
    position: fixed;
    z-index: 81;
    min-width: 200px;
    max-width: 320px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: var(--shadow);
    padding: 6px;
    display: flex;
    flex-direction: column;
    animation: pop 0.12s ease-out;
  }
  .pop :global(button) {
    text-align: left;
    padding: 9px 12px;
    border-radius: 8px;
    font-size: 14px;
  }
  .pop :global(button:hover) {
    background: var(--bg-hover);
  }
  .pop :global(hr) {
    border: none;
    border-top: 1px solid var(--line);
    margin: 4px 0;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
</style>
