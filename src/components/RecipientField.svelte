<script lang="ts">
  import type { Snippet } from "svelte";
  import { contacts } from "../lib/contacts.svelte";
  import { displayName, isValidEmail, parseAddressList } from "../lib/mail/mime";
  import type { Address, Contact } from "../lib/mail/types";

  interface Props {
    label: string;
    value: Address[];
    account: string;
    autofocus?: boolean;
    onchange: (v: Address[]) => void;
    trailing?: Snippet;
  }
  let { label, value, account, autofocus = false, onchange, trailing }: Props = $props();

  let text = $state("");
  let input = $state<HTMLInputElement>();
  let suggestions = $state<Contact[]>([]);
  let highlighted = $state(0);
  let searchSeq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    if (autofocus) input?.focus();
  });

  function commit(list: Address[]) {
    const next = [...value];
    for (const a of list) if (!next.some((b) => b.email.toLowerCase() === a.email.toLowerCase())) next.push(a);
    onchange(next);
    text = "";
    suggestions = [];
  }

  function commitText(): boolean {
    const t = text.trim().replace(/[,;]$/, "");
    if (!t) return false;
    const parsed = parseAddressList(t);
    if (parsed.length) {
      commit(parsed);
      return true;
    }
    if (isValidEmail(t)) {
      commit([{ name: "", email: t }]);
      return true;
    }
    return false;
  }

  function oninput() {
    if (/[,;]\s*$/.test(text) || (/\s$/.test(text) && isValidEmail(text.trim()))) {
      commitText();
      return;
    }
    clearTimeout(timer);
    const q = text.trim();
    if (q.length < 1) {
      suggestions = [];
      return;
    }
    const seq = ++searchSeq;
    timer = setTimeout(async () => {
      const r = await contacts.search(q, account);
      if (seq !== searchSeq) return;
      suggestions = r.filter((c) => !value.some((v) => v.email.toLowerCase() === c.email.toLowerCase()));
      highlighted = 0;
    }, 120);
  }

  function onkeydown(e: KeyboardEvent) {
    if (suggestions.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      highlighted = (highlighted + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
      return;
    }
    if (e.key === "Enter" || (e.key === "Tab" && text.trim())) {
      if (suggestions.length) {
        e.preventDefault();
        commit([suggestions[highlighted]]);
      } else if (commitText()) e.preventDefault();
      return;
    }
    if (e.key === "Backspace" && !text && value.length) {
      onchange(value.slice(0, -1));
    }
    if (e.key === "Escape" && suggestions.length) {
      e.stopPropagation();
      suggestions = [];
    }
  }

  function onpaste(e: ClipboardEvent) {
    const t = e.clipboardData?.getData("text") ?? "";
    const parsed = parseAddressList(t);
    if (parsed.length > 1 || (parsed.length === 1 && /[,;<]/.test(t))) {
      e.preventDefault();
      commit(parsed);
    }
  }

  function remove(i: number) {
    onchange(value.filter((_, j) => j !== i));
    input?.focus();
  }
</script>

<div class="field">
  <span class="label">{label}</span>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="chips" onclick={() => input?.focus()}>
    {#each value as a, i (a.email)}
      <button class="chip" class:invalid={!isValidEmail(a.email)} title={a.email} onclick={(e) => (e.stopPropagation(), remove(i))}>
        {displayName(a)}<span class="x">×</span>
      </button>
    {/each}
    <input
      bind:this={input}
      bind:value={text}
      type="email"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      enterkeyhint="next"
      {oninput}
      {onkeydown}
      {onpaste}
      onblur={() => setTimeout(() => {
        commitText();
        suggestions = [];
      }, 150)}
    />
  </div>
  {#if trailing}{@render trailing()}{/if}
  {#if suggestions.length}
    <div class="suggest" role="listbox">
      {#each suggestions as s, i (s.email)}
        <button
          class="sug"
          class:hl={i === highlighted}
          role="option"
          aria-selected={i === highlighted}
          onpointerdown={(e) => e.preventDefault()}
          onclick={() => commit([s])}
        >
          <span class="sname">{s.name || s.email}</span>
          {#if s.name}<span class="semail">{s.email}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .field {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 16px 6px 20px;
    border-bottom: 1px solid var(--line);
    min-height: 44px;
  }
  .label {
    color: var(--text-3);
    font-size: 14px;
    width: 52px;
    flex: none;
    padding-top: 7px;
  }
  .chips {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-width: 0;
    cursor: text;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-3);
    border-radius: 7px;
    padding: 4px 8px;
    font-size: 14px;
    max-width: 240px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip.invalid {
    color: var(--danger);
  }
  .x {
    color: var(--text-3);
    font-size: 14px;
  }
  input {
    flex: 1;
    min-width: 120px;
    border: none;
    outline: none;
    background: transparent;
    height: 32px;
    font-size: 15px;
    padding: 0;
  }
  .suggest {
    position: absolute;
    left: 72px;
    right: 16px;
    top: calc(100% - 2px);
    z-index: 5;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: var(--shadow);
    padding: 4px;
    max-height: 280px;
    overflow-y: auto;
  }
  .sug {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    padding: 8px 10px;
    border-radius: 7px;
    text-align: left;
  }
  .sug.hl,
  .sug:hover {
    background: var(--bg-hover);
  }
  .sname {
    font-size: 14px;
  }
  .semail {
    font-size: 12px;
    color: var(--text-2);
  }
</style>
