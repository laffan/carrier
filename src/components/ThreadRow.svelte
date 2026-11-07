<script lang="ts">
  import { Archive, Trash2, MailOpen, Mail, Star, Paperclip } from "@lucide/svelte";
  import type { ThreadSummary } from "../lib/mail/types";
  import type { SwipeAction } from "../lib/settings.svelte";
  import { listDate } from "../lib/util";

  interface Props {
    thread: ThreadSummary;
    active: boolean;
    checked: boolean;
    selecting: boolean;
    showAccount: boolean;
    /** Account colour, shown as a pill at the row's left edge. */
    color: string;
    sentView: boolean;
    swipeLeft: SwipeAction;
    swipeRight: SwipeAction;
    /** Whether an action removes the row from this list (animate it away). */
    removes: (a: SwipeAction) => boolean;
    onopen: () => void;
    oncheck: () => void;
    onswipe: (a: SwipeAction) => void;
    onstar: () => void;
  }

  let { thread, active, checked, selecting, showAccount, color, sentView, swipeLeft, swipeRight, removes, onopen, oncheck, onswipe, onstar }: Props = $props();

  let row: HTMLDivElement;
  let dx = $state(0);
  let animating = $state(false);
  let collapsing = $state(false);
  let phase: "idle" | "pending" | "swiping" | "scroll" = "idle";
  let startX = 0;
  let startY = 0;
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let suppressClick = false;

  const action = $derived<SwipeAction>(dx > 0 ? swipeRight : dx < 0 ? swipeLeft : "none");
  const threshold = () => Math.min(140, (row?.offsetWidth ?? 400) * 0.3);
  const armed = $derived(Math.abs(dx) > threshold() && action !== "none");

  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0) return;
    phase = "pending";
    startX = e.clientX;
    startY = e.clientY;
    suppressClick = false;
    if (e.pointerType !== "mouse") {
      pressTimer = setTimeout(() => {
        if (phase === "pending") {
          phase = "idle";
          suppressClick = true;
          navigator.vibrate?.(10);
          oncheck();
        }
      }, 450);
    }
  }

  function onpointermove(e: PointerEvent) {
    if (phase === "idle" || phase === "scroll") return;
    const mx = e.clientX - startX;
    const my = e.clientY - startY;
    if (phase === "pending") {
      if (Math.abs(my) > 8 && Math.abs(my) > Math.abs(mx)) {
        phase = "scroll";
        clearTimeout(pressTimer);
        return;
      }
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.4 && !selecting) {
        phase = "swiping";
        clearTimeout(pressTimer);
        row.setPointerCapture(e.pointerId);
      } else return;
    }
    const dir = mx > 0 ? swipeRight : swipeLeft;
    // Resist when there's no action for this direction.
    dx = dir === "none" ? mx * 0.15 : mx;
    e.preventDefault();
  }

  function finish() {
    clearTimeout(pressTimer);
    if (phase !== "swiping") {
      phase = "idle";
      return;
    }
    phase = "idle";
    suppressClick = true;
    const a = action;
    animating = true;
    if (armed) {
      if (removes(a)) {
        dx = dx > 0 ? row.offsetWidth : -row.offsetWidth;
        setTimeout(() => {
          collapsing = true;
          setTimeout(() => onswipe(a), 160);
        }, 180);
        return;
      }
      onswipe(a);
    }
    dx = 0;
    setTimeout(() => (animating = false), 220);
  }

  function onclick(e: MouseEvent) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (selecting || e.metaKey || e.ctrlKey) oncheck();
    else onopen();
  }

  function icon(a: SwipeAction) {
    if (a === "archive") return Archive;
    if (a === "trash") return Trash2;
    if (a === "read") return thread.unread ? MailOpen : Mail;
    if (a === "star") return Star;
    return null;
  }

  const names = $derived.by(() => {
    const ps = thread.participants;
    if (sentView) return "To: " + (thread.recipients.join(", ") || "(no recipients)");
    if (!ps.length) return thread.hasDraft ? "" : "(no sender)";
    if (ps.length === 1) return ps[0].isMe ? "me" : ps[0].name || ps[0].email;
    const shown = ps.slice(-3);
    return (ps.length > 3 ? "… " : "") + shown.map((p) => (p.isMe ? "me" : (p.name || p.email).split(/[\s@]/)[0])).join(", ");
  });

  const LeftIcon = $derived(icon(swipeRight));
  const RightIcon = $derived(icon(swipeLeft));
</script>

<div
  class="wrap"
  class:collapsing
  style:--bgc={action === "archive" ? "var(--swipe-archive)" : action === "trash" ? "var(--swipe-trash)" : action === "read" ? "var(--swipe-read)" : action === "star" ? "var(--swipe-star)" : "var(--bg-3)"}
>
  {#if dx !== 0}
    <div class="under" class:armed>
      {#if dx > 0 && LeftIcon}<span class="ic left"><LeftIcon size={20} strokeWidth={1.8} /></span>{/if}
      {#if dx < 0 && RightIcon}<span class="ic right"><RightIcon size={20} strokeWidth={1.8} /></span>{/if}
    </div>
  {/if}
  <div
    bind:this={row}
    class="row"
    class:active
    class:checked
    class:unread={thread.unread}
    class:animating
    style:transform={dx ? `translate3d(${dx}px,0,0)` : undefined}
    role="button"
    tabindex="-1"
    {onpointerdown}
    {onpointermove}
    onpointerup={finish}
    onpointercancel={finish}
    {onclick}
    onkeydown={(e) => e.key === "Enter" && onopen()}
    oncontextmenu={(e) => {
      e.preventDefault();
      oncheck();
    }}
  >
    <span class="pill" style:background={color} aria-hidden="true"></span>
    <div class="mark">
      {#if selecting}
        <span class="check" class:on={checked}></span>
      {:else if thread.unread}
        <span class="dot"></span>
      {/if}
    </div>
    <div class="body">
      <div class="line1">
        <span class="from">
{names}{#if thread.hasDraft}<span class="draft">{thread.participants.length ? ", " : ""}Draft</span>{/if}
          {#if thread.messageCount > 1}<span class="count">{thread.messageCount}</span>{/if}
        </span>
        <span class="date">{listDate(thread.date)}</span>
      </div>
      <div class="line2">
        <span class="subject">{thread.subject || "(no subject)"}</span>
        {#if thread.hasAttachments}<span class="clip"><Paperclip size={13} strokeWidth={1.8} /></span>{/if}
      </div>
      <div class="line3">
        <span class="snippet">{thread.snippet}</span>
        <button
          class="star"
          class:on={thread.starred}
          aria-label={thread.starred ? "Unstar" : "Star"}
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => {
            e.stopPropagation();
            onstar();
          }}
        >
          <Star size={15} strokeWidth={1.7} fill={thread.starred ? "currentColor" : "none"} />
        </button>
      </div>
      {#if showAccount}<div class="acct">{thread.account}</div>{/if}
    </div>
  </div>
</div>

<style>
  .wrap {
    position: relative;
    overflow: hidden;
    max-height: 140px;
    transition: max-height 0.16s ease-out;
  }
  .wrap.collapsing {
    max-height: 0;
  }
  .under {
    position: absolute;
    inset: 0;
    background: var(--bg-3);
    display: flex;
    align-items: center;
    color: white;
    transition: background 0.12s;
  }
  .under.armed {
    background: var(--bgc);
  }
  .under:not(.armed) .ic {
    color: var(--text-2);
  }
  .ic {
    position: absolute;
    display: flex;
    transition: transform 0.15s;
  }
  .armed .ic {
    transform: scale(1.15);
  }
  .ic.left {
    left: 24px;
  }
  .ic.right {
    right: 24px;
  }
  .row {
    position: relative;
    display: flex;
    gap: 10px;
    padding: 13px 18px 13px 16px;
    background: var(--bg);
    cursor: default;
    touch-action: pan-y;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    outline: none;
  }
  .row.animating {
    transition: transform 0.2s ease-out;
  }
  .row:hover {
    background: color-mix(in srgb, var(--bg) 100%, var(--text) 2.5%);
  }
  .row.active {
    background: var(--bg-selected);
  }
  .row.checked {
    background: var(--accent-soft);
  }
  .row::after {
    content: "";
    position: absolute;
    left: 34px;
    right: 0;
    bottom: 0;
    border-bottom: 1px solid var(--line);
  }
  .pill {
    position: absolute;
    left: 5px;
    top: 14px;
    bottom: 14px;
    width: 4px;
    border-radius: 4px;
    opacity: 0.9;
  }
  .mark {
    width: 10px;
    flex: none;
    display: flex;
    justify-content: center;
    padding-top: 7px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }
  .check {
    width: 16px;
    height: 16px;
    margin-top: -3px;
    margin-left: 4px;
    border-radius: 50%;
    border: 1.5px solid var(--line-2);
    flex: none;
  }
  .check.on {
    background: var(--accent);
    border-color: var(--accent);
    box-shadow: inset 0 0 0 3px var(--bg);
  }
  .body {
    flex: 1;
    min-width: 0;
  }
  .line1,
  .line2,
  .line3 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .from {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 15px;
    color: var(--text);
  }
  .unread .from {
    font-weight: 600;
  }
  .draft {
    color: var(--danger);
    font-weight: 400;
  }
  .count {
    color: var(--text-3);
    font-size: 12px;
    margin-left: 6px;
    font-weight: 400;
  }
  .date {
    flex: none;
    font-size: 12px;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .unread .date {
    color: var(--text);
    font-weight: 500;
  }
  .line2 {
    margin-top: 1px;
  }
  .subject {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    color: var(--text);
  }
  .unread .subject {
    font-weight: 600;
  }
  .clip {
    color: var(--text-3);
    display: flex;
    align-self: center;
  }
  .line3 {
    margin-top: 1px;
    align-items: center;
  }
  .snippet {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .star {
    color: var(--text-3);
    display: flex;
    padding: 2px;
    margin: -2px -2px -2px 0;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .row:hover .star,
  .star.on {
    opacity: 1;
  }
  @media (hover: none) {
    .star {
      opacity: 1;
    }
    .star:not(.on) {
      color: var(--line-2);
    }
  }
  .star.on {
    color: var(--star);
  }
  .acct {
    font-size: 11px;
    color: var(--text-3);
    margin-top: 3px;
  }
</style>
