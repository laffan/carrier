<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    onclose: () => void;
    width?: number;
    full?: boolean;
    children: Snippet;
  }
  let { onclose, width = 560, full = false, children }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="scrim" onclick={onclose}></div>
<div class="sheet" class:full style:--w="{width}px" role="dialog" aria-modal="true" tabindex="-1" onkeydown={(e) => e.key === "Escape" && onclose()}>
  {@render children()}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.25);
    z-index: 60;
    animation: fade 0.18s ease-out;
  }
  .sheet {
    position: fixed;
    z-index: 61;
    left: 50%;
    top: max(5vh, calc(var(--safe-top) + 16px));
    transform: translateX(-50%);
    width: min(var(--w), calc(100vw - 32px));
    max-height: calc(var(--vvh, 100vh) - max(10vh, calc(var(--safe-top) + var(--safe-bottom) + 32px)));
    background: var(--bg);
    border-radius: 16px;
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: rise 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
    outline: none;
  }
  .sheet.full {
    height: calc(var(--vvh, 100vh) - max(10vh, calc(var(--safe-top) + var(--safe-bottom) + 32px)));
  }
  @media (max-width: 640px) {
    .sheet {
      left: 0;
      transform: none;
      width: 100vw;
      top: calc(var(--safe-top) + 10px);
      bottom: calc(100vh - var(--vvh, 100vh));
      max-height: none;
      height: auto;
      border-radius: 14px 14px 0 0;
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      translate: 0 24px;
    }
  }
</style>
