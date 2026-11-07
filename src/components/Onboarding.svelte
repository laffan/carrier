<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { getClientId } from "../lib/mail/auth";
  import { settings } from "../lib/settings.svelte";

  let clientId = $state("");
  let hasClientId = $state(true);
  let busy = $state(false);

  $effect(() => {
    getClientId().then((id) => {
      hasClientId = !!id;
    });
  });

  async function add() {
    busy = true;
    try {
      if (!hasClientId && clientId.trim()) await settings.update({ googleClientId: clientId.trim() });
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
    {#if !hasClientId}
      <label>
        <span>Google OAuth client ID</span>
        <input bind:value={clientId} placeholder="1234-abc.apps.googleusercontent.com" autocapitalize="off" autocorrect="off" spellcheck="false" />
        <span class="hint">Create an “iOS” OAuth client in Google Cloud and paste its ID. See README.</span>
      </label>
    {/if}
    <button class="text-btn primary big" disabled={busy || (!hasClientId && !clientId.trim())} onclick={add}>
      {busy ? "Waiting for Google…" : "Add Gmail account"}
    </button>
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
    width: min(380px, 100%);
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
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
  }
  input {
    border: 1px solid var(--line-2);
    background: var(--bg);
    border-radius: 10px;
    padding: 10px 12px;
    outline: none;
  }
  .hint {
    font-size: 12px;
    color: var(--text-2);
  }
  .big {
    padding: 13px 16px;
    font-size: 15px;
    border-radius: 12px;
  }
  .big:disabled {
    opacity: 0.4;
  }
</style>
