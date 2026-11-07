/**
 * Application state: accounts, the current mailbox view, the thread list,
 * the open conversation and all mailbox actions (with optimistic updates
 * and undo).
 */
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { AuthError, signIn, signOut } from "./mail/auth";
import { DemoBackend } from "./mail/demo";
import { GmailBackend } from "./mail/gmail";
import type { Label, MailBackend, SendAs, Thread, ThreadSummary } from "./mail/types";
import { cacheGet, cacheSet, isTauri, kvGet, kvSet } from "./platform";
import { settings } from "./settings.svelte";
import { toasts } from "./toasts.svelte";

export interface Account {
  email: string;
  name: string;
  picture?: string;
  sendAs: SendAs[];
  needsReauth?: boolean;
}

/** "*" is the unified "All inboxes" view. */
export const ALL = "*";

export type View = { kind: "label"; label: string } | { kind: "search"; q: string };

export const SYSTEM_NAMES: Record<string, string> = {
  INBOX: "Inbox",
  CATEGORY_PERSONAL: "Primary",
  CATEGORY_SOCIAL: "Social",
  CATEGORY_PROMOTIONS: "Promotions",
  CATEGORY_UPDATES: "Updates",
  CATEGORY_FORUMS: "Forums",
  STARRED: "Starred",
  IMPORTANT: "Important",
  SENT: "Sent",
  DRAFT: "Drafts",
  ALL: "All mail",
  SPAM: "Spam",
  TRASH: "Trash",
};

export function threadKey(t: { account: string; id: string }): string {
  return `${t.account}|${t.id}`;
}

function splitKey(key: string): { account: string; id: string } {
  const i = key.indexOf("|");
  return { account: key.slice(0, i), id: key.slice(i + 1) };
}

const PAGE = 30;

class App {
  ready = $state(false);
  demo = !isTauri;
  accounts = $state<Account[]>([]);
  current = $state<string>(ALL);
  view = $state<View>({ kind: "label", label: "INBOX" });
  labels = $state<Record<string, Label[]>>({});

  threads = $state<ThreadSummary[]>([]);
  loading = $state(false);
  loadingMore = $state(false);
  refreshing = $state(false);
  listError = $state<string | null>(null);
  hasMore = $state(false);

  open = $state<{ account: string; id: string } | null>(null);
  thread = $state<Thread | null>(null);
  threadLoading = $state(false);
  threadError = $state<string | null>(null);

  selection = new SvelteSet<string>();
  sidebarOpen = $state(false);

  private backends = new Map<string, MailBackend>();
  private summaryCache = new SvelteMap<string, Map<string, ThreadSummary>>();
  private pageTokens = new Map<string, string | undefined>();
  private generation = 0;

  // ---- setup --------------------------------------------------------------

  async init() {
    await settings.load();
    if (this.demo) {
      this.accounts = [
        { email: "you@example.com", name: "Alex Rivera", sendAs: [] },
        { email: "work@example.org", name: "Alex Rivera", sendAs: [] },
      ];
      this.backends.set("you@example.com", new DemoBackend("you@example.com", "Alex Rivera", 0));
      this.backends.set("work@example.org", new DemoBackend("work@example.org", "Alex Rivera", 1));
    } else {
      const saved = (await kvGet<Account[]>("accounts")) ?? [];
      this.accounts = saved;
      for (const a of saved) this.backends.set(a.email, new GmailBackend(a.email));
    }
    const last = await kvGet<{ current: string; view: View }>("lastView");
    if (last && (last.current === ALL || this.accounts.some((a) => a.email === last.current))) {
      this.current = last.current;
      this.view = last.view.kind === "label" ? last.view : { kind: "label", label: "INBOX" };
    } else {
      this.current = this.accounts.length > 1 ? ALL : (this.accounts[0]?.email ?? ALL);
    }
    this.ready = true;
    if (this.accounts.length) {
      this.loadList();
      this.refreshAccounts();
    }
  }

  backend(email: string): MailBackend {
    const b = this.backends.get(email);
    if (!b) throw new Error(`Unknown account ${email}`);
    return b;
  }

  account(email: string): Account | undefined {
    return this.accounts.find((a) => a.email === email);
  }

  private async persistAccounts() {
    if (!this.demo) await kvSet("accounts", $state.snapshot(this.accounts));
  }

  /** Loads send-as identities and label lists for every account. */
  async refreshAccounts() {
    await Promise.all(
      this.accounts.map(async (a) => {
        try {
          const b = this.backend(a.email);
          const [sendAs, labels] = await Promise.all([b.listSendAs(), b.listLabels(true)]);
          this.labels[a.email] = labels;
          const idx = this.accounts.findIndex((x) => x.email === a.email);
          if (idx >= 0) this.accounts[idx] = { ...this.accounts[idx], sendAs, needsReauth: false };
        } catch (e) {
          this.handleError(e, a.email);
        }
      }),
    );
    await this.persistAccounts();
  }

  async refreshCounts() {
    await Promise.all(
      this.accounts.map(async (a) => {
        try {
          this.labels[a.email] = await this.backend(a.email).listLabels(true);
        } catch (e) {
          this.handleError(e, a.email, true);
        }
      }),
    );
  }

  async addAccount(loginHint?: string) {
    try {
      const id = await signIn(loginHint);
      const existing = this.accounts.findIndex((a) => a.email === id.email);
      const acct: Account = { email: id.email, name: id.name, picture: id.picture, sendAs: [] };
      if (existing >= 0) this.accounts[existing] = { ...this.accounts[existing], ...acct, needsReauth: false };
      else this.accounts = [...this.accounts, acct];
      this.backends.set(id.email, new GmailBackend(id.email));
      await this.persistAccounts();
      if (existing < 0) this.switchAccount(id.email);
      else this.loadList();
      this.refreshAccounts();
      toasts.show(`Signed in as ${id.email}`);
    } catch (e) {
      toasts.error(e instanceof Error ? e.message : String(e));
    }
  }

  async removeAccount(email: string) {
    await signOut(email).catch(() => {});
    this.accounts = this.accounts.filter((a) => a.email !== email);
    this.backends.delete(email);
    delete this.labels[email];
    await this.persistAccounts();
    if (this.current === email) this.current = this.accounts.length > 1 ? ALL : (this.accounts[0]?.email ?? ALL);
    if (this.open?.account === email) this.closeThread();
    this.threads = this.threads.filter((t) => t.account !== email);
    if (this.accounts.length) this.loadList();
  }

  handleError(e: unknown, account?: string, quiet = false) {
    if (e instanceof AuthError && (e.account || account)) {
      const email = e.account || account!;
      const idx = this.accounts.findIndex((a) => a.email === email);
      if (idx >= 0 && !this.accounts[idx].needsReauth) {
        this.accounts[idx] = { ...this.accounts[idx], needsReauth: true };
        toasts.show(`${email} needs to sign in again`, {
          action: "Sign in",
          onAction: () => this.addAccount(email),
          duration: 10_000,
        });
      }
      return;
    }
    if (!quiet) toasts.error(e instanceof Error ? e.message : String(e));
    else console.warn(e);
  }

  // ---- views --------------------------------------------------------------

  get accountsInView(): string[] {
    return this.current === ALL ? this.accounts.map((a) => a.email) : [this.current];
  }

  get viewTitle(): string {
    if (this.view.kind === "search") return this.view.q;
    const l = this.view.label;
    if (l === "INBOX" && this.current === ALL) return "All inboxes";
    if (l === "INBOX" && settings.value.inboxType === "primary") return "Primary";
    if (SYSTEM_NAMES[l]) return SYSTEM_NAMES[l];
    const found = this.labels[this.current]?.find((x) => x.id === l);
    return found ? found.name.split("/").pop()! : l;
  }

  /** The label the current list is scoped to, if any. */
  get viewLabel(): string | null {
    return this.view.kind === "label" ? this.view.label : null;
  }

  get isInboxView(): boolean {
    const l = this.viewLabel;
    return l === "INBOX" || (l?.startsWith("CATEGORY_") ?? false);
  }

  private queryFor(view: View): { labelIds?: string[]; q?: string } {
    if (view.kind === "search") return { q: view.q };
    const l = view.label;
    if (l === "INBOX") {
      return { labelIds: settings.value.inboxType === "primary" ? ["INBOX", "CATEGORY_PERSONAL"] : ["INBOX"] };
    }
    if (l.startsWith("CATEGORY_")) return { labelIds: ["INBOX", l] };
    if (l === "ALL") return {};
    return { labelIds: [l] };
  }

  private cacheKey(): string {
    return `list:${this.current}:${JSON.stringify(this.view)}`;
  }

  setView(view: View) {
    this.view = view;
    this.selection.clear();
    this.closeThread();
    this.sidebarOpen = false;
    kvSet("lastView", { current: this.current, view: $state.snapshot(view) });
    this.loadList();
  }

  switchAccount(email: string) {
    this.current = email;
    if (email === ALL) this.view = { kind: "label", label: "INBOX" };
    else if (this.view.kind === "label" && !SYSTEM_NAMES[this.view.label]) this.view = { kind: "label", label: "INBOX" };
    this.setView(this.view);
  }

  private summaries(account: string): Map<string, ThreadSummary> {
    let m = this.summaryCache.get(account);
    if (!m) {
      m = new Map();
      this.summaryCache.set(account, m);
    }
    return m;
  }

  async loadList() {
    const gen = ++this.generation;
    this.listError = null;
    const cached = cacheGet<ThreadSummary[]>(this.cacheKey());
    if (cached?.length) {
      this.threads = cached;
      this.refreshing = true;
    } else {
      this.threads = [];
      this.loading = true;
    }
    try {
      const fresh = await this.fetchFirstPages();
      if (gen !== this.generation) return;
      this.threads = fresh;
      cacheSet(this.cacheKey(), fresh.slice(0, PAGE));
    } catch (e) {
      if (gen !== this.generation) return;
      this.listError = e instanceof Error ? e.message : String(e);
      this.handleError(e, undefined, true);
    } finally {
      if (gen === this.generation) {
        this.loading = false;
        this.refreshing = false;
      }
    }
  }

  private async fetchFirstPages(): Promise<ThreadSummary[]> {
    const query = this.queryFor(this.view);
    const accounts = this.accountsInView.filter((a) => !this.account(a)?.needsReauth);
    const results = await Promise.allSettled(
      accounts.map(async (email) => {
        const r = await this.backend(email).listThreads({ ...query, maxResults: PAGE }, this.summaries(email));
        this.pageTokens.set(email, r.nextPageToken);
        r.threads.forEach((t) => this.summaries(email).set(t.id, t));
        return r.threads;
      }),
    );
    const out: ThreadSummary[] = [];
    let failures = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") out.push(...r.value);
      else {
        failures++;
        this.pageTokens.delete(accounts[i]);
        this.handleError(r.reason, accounts[i], true);
      }
    });
    if (failures && failures === results.length) throw (results[0] as PromiseRejectedResult).reason;
    this.hasMore = accounts.some((a) => this.pageTokens.get(a));
    return out.sort((a, b) => b.date - a.date);
  }

  /** Pull-to-refresh / periodic refresh: keeps already-loaded pages. */
  async refresh() {
    if (this.refreshing || this.loading || !this.accounts.length) return;
    const gen = this.generation;
    this.refreshing = true;
    try {
      const fresh = await this.fetchFirstPages();
      if (gen !== this.generation) return;
      const seen = new Set(fresh.map(threadKey));
      const oldest = fresh.length ? fresh[fresh.length - 1].date : Infinity;
      const tail = this.threads.filter((t) => !seen.has(threadKey(t)) && t.date < oldest);
      this.threads = [...fresh, ...tail];
      cacheSet(this.cacheKey(), fresh.slice(0, PAGE));
      this.refreshCounts();
      if (this.open && this.thread) this.reloadThread();
    } catch (e) {
      this.handleError(e, undefined, true);
    } finally {
      if (gen === this.generation) this.refreshing = false;
    }
  }

  async loadMore() {
    if (this.loadingMore || !this.hasMore) return;
    const gen = this.generation;
    this.loadingMore = true;
    try {
      const query = this.queryFor(this.view);
      const accounts = this.accountsInView.filter((a) => this.pageTokens.get(a));
      const pages = await Promise.all(
        accounts.map(async (email) => {
          const r = await this.backend(email).listThreads(
            { ...query, maxResults: PAGE, pageToken: this.pageTokens.get(email) },
            this.summaries(email),
          );
          this.pageTokens.set(email, r.nextPageToken);
          return r.threads;
        }),
      );
      if (gen !== this.generation) return;
      const seen = new Set(this.threads.map(threadKey));
      const more = pages.flat().filter((t) => !seen.has(threadKey(t)));
      this.threads = [...this.threads, ...more].sort((a, b) => b.date - a.date);
      this.hasMore = this.accountsInView.some((a) => this.pageTokens.get(a));
    } catch (e) {
      this.handleError(e);
    } finally {
      this.loadingMore = false;
    }
  }

  // ---- conversation -------------------------------------------------------

  async openThread(t: { account: string; id: string }) {
    this.open = { account: t.account, id: t.id };
    this.threadError = null;
    this.thread = null;
    this.threadLoading = true;
    const summary = this.threads.find((x) => x.account === t.account && x.id === t.id);
    try {
      const thread = await this.backend(t.account).getThread(t.id);
      if (this.open?.id !== t.id) return;
      this.thread = thread;
      if (summary?.unread || thread.messages.some((m) => m.labelIds.includes("UNREAD"))) {
        this.patchLocal([threadKey(t)], [], ["UNREAD"]);
        this.backend(t.account)
          .modifyThreads([t.id], [], ["UNREAD"])
          .then(() => this.refreshCounts())
          .catch((e) => this.handleError(e, t.account, true));
      }
    } catch (e) {
      if (this.open?.id !== t.id) return;
      this.threadError = e instanceof Error ? e.message : String(e);
      this.handleError(e, t.account, true);
    } finally {
      if (this.open?.id === t.id) this.threadLoading = false;
    }
  }

  async reloadThread() {
    if (!this.open) return;
    const { account, id } = this.open;
    try {
      const thread = await this.backend(account).getThread(id);
      if (this.open?.id === id) this.thread = thread;
    } catch (e) {
      this.handleError(e, account, true);
    }
  }

  closeThread() {
    this.open = null;
    this.thread = null;
    this.threadError = null;
  }

  /** Opens the thread after the given key in the list (Gmail's auto-advance), or closes. */
  private advanceFrom(keys: string[], before: ThreadSummary[]) {
    if (!this.open || !keys.includes(threadKey(this.open))) return;
    const idx = before.findIndex((t) => threadKey(t) === threadKey(this.open!));
    const next = before.slice(idx + 1).find((t) => !keys.includes(threadKey(t)));
    const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches;
    if (next && wide) this.openThread(next);
    else this.closeThread();
  }

  // ---- actions ------------------------------------------------------------

  /** Applies label changes to the local list and open thread immediately. */
  private patchLocal(keys: string[], add: string[], remove: string[]) {
    const set = new Set(keys);
    this.threads = this.threads.map((t) => {
      if (!set.has(threadKey(t))) return t;
      const labelIds = [...t.labelIds.filter((l) => !remove.includes(l)), ...add.filter((l) => !t.labelIds.includes(l))];
      const next = {
        ...t,
        labelIds,
        unread: remove.includes("UNREAD") ? false : add.includes("UNREAD") ? true : t.unread,
        starred: remove.includes("STARRED") ? false : add.includes("STARRED") ? true : t.starred,
        participants: remove.includes("UNREAD") ? t.participants.map((p) => ({ ...p, unread: false })) : t.participants,
        historyId: t.historyId + "*",
      };
      this.summaries(t.account).set(t.id, next);
      return next;
    });
    if (this.thread && set.has(threadKey(this.thread))) {
      const fix = (ids: string[]) => [...ids.filter((l) => !remove.includes(l)), ...add.filter((l) => !ids.includes(l))];
      this.thread = {
        ...this.thread,
        labelIds: fix(this.thread.labelIds),
        messages: this.thread.messages.map((m) => ({ ...m, labelIds: fix(m.labelIds) })),
      };
    }
  }

  /** Would a thread with these labels still be listed in the current view? */
  private stillInView(labelIds: string[]): boolean {
    if (this.view.kind === "search") return !labelIds.includes("TRASH") && !labelIds.includes("SPAM");
    const l = this.view.label;
    if (l === "ALL") return !labelIds.includes("TRASH") && !labelIds.includes("SPAM");
    if (l === "TRASH" || l === "SPAM") return labelIds.includes(l);
    if (labelIds.includes("TRASH") || labelIds.includes("SPAM")) return false;
    if (l.startsWith("CATEGORY_")) return labelIds.includes("INBOX") && labelIds.includes(l);
    return labelIds.includes(l);
  }

  private byAccount(keys: string[]): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const k of keys) {
      const { account, id } = splitKey(k);
      m.set(account, [...(m.get(account) ?? []), id]);
    }
    return m;
  }

  /**
   * Generic label change with optimistic UI and an undo toast.
   * `message` is shown in the toast (e.g. "Archived").
   */
  async modify(keys: string[], add: string[], remove: string[], message?: string, undoable = true) {
    if (!keys.length) return;
    const before = this.threads;
    const prevLabels = new Map(before.filter((t) => keys.includes(threadKey(t))).map((t) => [threadKey(t), t.labelIds]));
    this.patchLocal(keys, add, remove);
    const leaving = this.threads.filter((t) => keys.includes(threadKey(t)) && !this.stillInView(t.labelIds));
    if (leaving.length) {
      const leavingKeys = leaving.map(threadKey);
      this.threads = this.threads.filter((t) => !leavingKeys.includes(threadKey(t)));
      this.advanceFrom(leavingKeys, before);
    }
    this.selection.clear();
    try {
      await Promise.all(
        [...this.byAccount(keys)].map(([account, ids]) => this.backend(account).modifyThreads(ids, add, remove)),
      );
      this.refreshCounts();
    } catch (e) {
      this.threads = before;
      this.handleError(e);
      return;
    }
    if (message) {
      toasts.show(message, {
        action: undoable ? "Undo" : undefined,
        onAction: undoable
          ? async () => {
              // Restore each thread's exact previous labels.
              this.threads = before.map((t) => (prevLabels.has(threadKey(t)) ? { ...t, labelIds: prevLabels.get(threadKey(t))! } : t));
              try {
                await Promise.all(
                  [...this.byAccount(keys)].map(([account, ids]) => this.backend(account).modifyThreads(ids, remove, add)),
                );
                this.refreshCounts();
              } catch (e) {
                this.handleError(e);
              }
            }
          : undefined,
      });
    }
  }

  archive(keys: string[]) {
    const n = keys.length;
    return this.modify(keys, [], ["INBOX"], n > 1 ? `${n} archived` : "Archived");
  }

  async trash(keys: string[]) {
    if (!keys.length) return;
    if (this.viewLabel === "TRASH") return this.deleteForever(keys);
    const before = this.threads;
    this.threads = this.threads.filter((t) => !keys.includes(threadKey(t)));
    this.advanceFrom(keys, before);
    this.selection.clear();
    try {
      await Promise.all([...this.byAccount(keys)].map(([a, ids]) => this.backend(a).trashThreads(ids)));
      this.refreshCounts();
    } catch (e) {
      this.threads = before;
      this.handleError(e);
      return;
    }
    const n = keys.length;
    toasts.show(n > 1 ? `${n} moved to Trash` : "Moved to Trash", {
      action: "Undo",
      onAction: async () => {
        this.threads = before;
        try {
          await Promise.all([...this.byAccount(keys)].map(([a, ids]) => this.backend(a).untrashThreads(ids)));
          this.refreshCounts();
        } catch (e) {
          this.handleError(e);
        }
      },
    });
  }

  async deleteForever(keys: string[]) {
    if (!keys.length) return;
    if (!confirm(keys.length > 1 ? `Delete ${keys.length} conversations forever?` : "Delete this conversation forever?")) return;
    const before = this.threads;
    this.threads = this.threads.filter((t) => !keys.includes(threadKey(t)));
    this.advanceFrom(keys, before);
    this.selection.clear();
    try {
      await Promise.all([...this.byAccount(keys)].map(([a, ids]) => this.backend(a).deleteThreadsForever(ids)));
      toasts.show("Deleted forever");
      this.refreshCounts();
    } catch (e) {
      this.threads = before;
      this.handleError(e);
    }
  }

  async emptyFolder(label: "TRASH" | "SPAM") {
    if (this.current === ALL) return;
    if (!confirm(`Delete everything in ${SYSTEM_NAMES[label]} forever?`)) return;
    const b = this.backend(this.current);
    try {
      let token: string | undefined;
      const ids: string[] = [];
      do {
        const r = await b.listThreads({ labelIds: [label], maxResults: 100, pageToken: token }, this.summaries(this.current));
        ids.push(...r.threads.map((t) => t.id));
        token = r.nextPageToken;
      } while (token && ids.length < 5000);
      await b.deleteThreadsForever(ids);
      this.threads = [];
      toasts.show(`${SYSTEM_NAMES[label]} emptied`);
      this.refreshCounts();
    } catch (e) {
      this.handleError(e);
    }
  }

  setRead(keys: string[], read: boolean) {
    return read ? this.modify(keys, [], ["UNREAD"], undefined, false) : this.modify(keys, ["UNREAD"], [], undefined, false);
  }

  async toggleRead(keys: string[]) {
    const items = this.threads.filter((t) => keys.includes(threadKey(t)));
    const anyUnread = items.some((t) => t.unread);
    await this.setRead(keys, anyUnread);
  }

  /** Marks the open thread unread and returns to the list, like Gmail. */
  async markOpenUnread() {
    if (!this.open) return;
    const key = threadKey(this.open);
    this.closeThread();
    await this.modify([key], ["UNREAD"], []);
  }

  async setStar(keys: string[], on: boolean) {
    if (!keys.length) return;
    const items = this.threads.filter((t) => keys.includes(threadKey(t)));
    this.patchLocal(keys, on ? ["STARRED"] : [], on ? [] : ["STARRED"]);
    if (!on) {
      const leaving = this.threads.filter((t) => keys.includes(threadKey(t)) && !this.stillInView(t.labelIds));
      if (leaving.length) this.threads = this.threads.filter((t) => !leaving.includes(t));
    }
    try {
      if (on) {
        // Gmail stars the latest message of a conversation.
        const byAcct = new Map<string, string[]>();
        for (const k of keys) {
          const { account, id } = splitKey(k);
          const s = items.find((t) => t.account === account && t.id === id);
          const mid = s?.lastMessageId ?? (this.thread?.id === id ? this.thread.messages.at(-1)?.id : undefined);
          if (mid) byAcct.set(account, [...(byAcct.get(account) ?? []), mid]);
        }
        await Promise.all([...byAcct].map(([a, ids]) => this.backend(a).modifyMessages(ids, ["STARRED"], [])));
      } else {
        await Promise.all([...this.byAccount(keys)].map(([a, ids]) => this.backend(a).modifyThreads(ids, [], ["STARRED"])));
      }
    } catch (e) {
      this.handleError(e);
      this.refresh();
    }
  }

  async toggleStar(keys: string[]) {
    const items = this.threads.filter((t) => keys.includes(threadKey(t)));
    const starred = items.length ? items.every((t) => t.starred) : !!this.thread?.labelIds.includes("STARRED");
    await this.setStar(keys, !starred);
  }

  reportSpam(keys: string[]) {
    return this.modify(keys, ["SPAM"], ["INBOX"], keys.length > 1 ? `${keys.length} reported as spam` : "Reported as spam");
  }

  notSpam(keys: string[]) {
    return this.modify(keys, ["INBOX"], ["SPAM"], "Moved to Inbox");
  }

  async restoreFromTrash(keys: string[]) {
    const before = this.threads;
    this.threads = this.threads.filter((t) => !keys.includes(threadKey(t)));
    this.advanceFrom(keys, before);
    this.selection.clear();
    try {
      await Promise.all([...this.byAccount(keys)].map(([a, ids]) => this.backend(a).untrashThreads(ids)));
      toasts.show("Restored");
      this.refreshCounts();
    } catch (e) {
      this.threads = before;
      this.handleError(e);
    }
  }

  moveToInbox(keys: string[]) {
    return this.modify(keys, ["INBOX"], [], "Moved to Inbox");
  }

  /** Gmail "Move to": adds the target and removes the current folder. */
  moveTo(keys: string[], target: string) {
    const remove: string[] = [];
    const l = this.viewLabel;
    if (l && l !== target && !["STARRED", "IMPORTANT", "ALL", "SENT", "DRAFT"].includes(l)) {
      remove.push(l.startsWith("CATEGORY_") ? "INBOX" : l);
    }
    if (target === "INBOX") return this.modify(keys, ["INBOX"], remove.filter((x) => x !== "INBOX"), "Moved to Inbox");
    const name = SYSTEM_NAMES[target] ?? this.labelName(splitKey(keys[0]).account, target);
    return this.modify(keys, [target], remove, `Moved to ${name}`);
  }

  labelName(account: string, id: string): string {
    return SYSTEM_NAMES[id] ?? this.labels[account]?.find((l) => l.id === id)?.name ?? id;
  }

  userLabels(account: string): Label[] {
    return (this.labels[account] ?? []).filter((l) => l.type === "user").sort((a, b) => a.name.localeCompare(b.name));
  }

  unreadCount(account: string, labelId: string): number {
    if (account === ALL) {
      return this.accounts.reduce((n, a) => n + this.unreadCount(a.email, labelId), 0);
    }
    const id = labelId === "INBOX" && settings.value.inboxType === "primary" ? "CATEGORY_PERSONAL" : labelId;
    const l = this.labels[account]?.find((x) => x.id === id);
    if (labelId === "DRAFT") return l?.total ?? 0;
    return l?.unread ?? 0;
  }

  /** Called after sending or saving a draft to keep lists in sync. */
  afterSend() {
    if (this.viewLabel === "SENT" || this.viewLabel === "DRAFT" || this.view.kind === "search") this.refresh();
    if (this.open) this.reloadThread();
    this.refreshCounts();
  }
}

export const app = new App();
