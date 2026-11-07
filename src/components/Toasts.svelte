<script lang="ts">
  import { toasts } from "../lib/toasts.svelte";
</script>

<div class="toasts" aria-live="polite">
  {#each toasts.items as t (t.id)}
    <div class="toast" class:error={t.error}>
      <span class="msg">{t.message}</span>
      {#if t.action}
        <button class="act" onclick={() => toasts.act(t.id)}>{t.action}</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: calc(20px + var(--safe-bottom));
    transform: translateX(-50%);
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    pointer-events: none;
    width: max-content;
    max-width: calc(100vw - 32px);
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 18px;
    background: #1c1c1e;
    color: #f2f2f2;
    border-radius: 12px;
    padding: 11px 14px 11px 18px;
    font-size: 14px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
    animation: up 0.2s cubic-bezier(0.2, 0.9, 0.3, 1);
  }
  :global(:root[data-theme="dark"]) .toast {
    background: #2c2c2e;
  }
  @media (prefers-color-scheme: dark) {
    .toast {
      background: #2c2c2e;
    }
  }
  .toast.error .msg {
    color: #ffb4a9;
  }
  .act {
    font-weight: 600;
    color: #9ab8ff;
    padding: 2px 4px;
  }
  @keyframes up {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
  }
</style>
