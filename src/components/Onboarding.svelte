<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { googleSignInAvailable } from "../lib/mail/auth";

  let busy = $state(false);

  async function add() {
    busy = true;
    try {
      await app.addAccount();
    } finally {
      busy = false;
    }
  }
</script>

<main>
  <div class="card">
    <h1>Carrier</h1>
    <p class="muted">A quiet place for your mail.</p>
    <button class="text-btn primary big" disabled={busy || !googleSignInAvailable} onclick={add}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z" />
        <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
        <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1Z" />
        <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
      </svg>
      {busy ? "Waiting for Google…" : "Sign in with Google"}
    </button>
    {#if googleSignInAvailable}
      <p class="hint">Works with Gmail and Google Workspace accounts. You can add more accounts later.</p>
    {:else}
      <p class="hint warn">
        Google sign-in isn't set up in this build. Add <code>VITE_GOOGLE_CLIENT_ID</code> to <code>.env</code> (README › One-time: register
        Carrier with Google) and restart.
      </p>
    {/if}
    <button class="text-btn demo" onclick={() => app.startDemo()}>Try with sample mail</button>
  </div>
</main>

<style>
  main {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    width: min(360px, 100%);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h1 {
    margin: 0;
    font-size: 30px;
    letter-spacing: -0.03em;
    font-weight: 600;
  }
  p {
    margin: 0 0 18px;
  }
  .big {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 13px 16px;
    font-size: 15px;
    border-radius: 12px;
  }
  .big:disabled {
    opacity: 0.5;
  }
  .warn code {
    font-family: var(--mono);
    font-size: 11.5px;
  }
  .demo {
    align-self: center;
    margin-top: 8px;
  }
  .hint {
    font-size: 12.5px;
    color: var(--text-2);
    text-align: center;
    margin: 0;
  }
</style>
