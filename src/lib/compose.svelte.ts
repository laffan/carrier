/**
 * Compose state: new messages, replies, forwards and drafts. Bodies are
 * written in Markdown and rendered to HTML when the message is built.
 */
import { app, type Account } from "./app.svelte";
import { renderOutgoing, sanitizeFragment } from "./mail/markdown";
import { buildMime, displayName, isValidEmail, textToHtml } from "./mail/mime";
import type { Address, Message, OutgoingAttachment, Outgoing, Quote, SendAs, Thread } from "./mail/types";
import { kvDelete, kvGet, kvSet } from "./platform";
import { settings } from "./settings.svelte";
import { toasts } from "./toasts.svelte";
import { contacts } from "./contacts.svelte";
import { fullDate, replyHeader } from "./util";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "draft";

export interface Draft {
  account: string;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  markdown: string;
  signature: string;
  includeSignature: boolean;
  quote?: Quote;
  attachments: OutgoingAttachment[];
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  draftId?: string;
  mode: ComposeMode;
}

interface StoredDraftBody {
  markdown: string;
  signature: string;
  includeSignature: boolean;
  quote?: Quote;
}

export interface FromOption {
  account: string;
  address: Address;
  sendAs?: SendAs;
}

let turndownPromise: Promise<(html: string) => string> | null = null;

/** Converts HTML (e.g. a Gmail signature) to Markdown. */
export function htmlToMarkdown(html: string): Promise<string> {
  if (!turndownPromise) {
    turndownPromise = import("turndown").then(({ default: TurndownService }) => {
      const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", emDelimiter: "*", br: "  " });
      td.remove(["style", "script"]);
      return (h: string) =>
        td
          .turndown(sanitizeFragment(h))
          .replace(/ {2}\n/g, "\n")
          .trim();
    });
  }
  return turndownPromise.then((fn) => fn(html));
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style,script,head").forEach((n) => n.remove());
  doc.querySelectorAll("br").forEach((n) => n.replaceWith("\n"));
  doc.querySelectorAll("p,div,tr,li,h1,h2,h3,h4,blockquote").forEach((n) => n.append("\n"));
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function sameAddress(a: Address, b: Address) {
  return a.email.toLowerCase() === b.email.toLowerCase();
}

function uniq(list: Address[]): Address[] {
  const out: Address[] = [];
  for (const a of list) if (!out.some((b) => sameAddress(a, b))) out.push(a);
  return out;
}

function myAddresses(acct: Account | undefined): Set<string> {
  const s = new Set<string>();
  if (!acct) return s;
  s.add(acct.email.toLowerCase());
  acct.sendAs.forEach((x) => s.add(x.email.toLowerCase()));
  return s;
}

function prefixed(subject: string, prefix: "Re:" | "Fwd:"): string {
  const re = prefix === "Re:" ? /^(re|aw|sv|antw):\s*/i : /^(fwd?|wg|tr):\s*/i;
  return re.test(subject) ? subject : `${prefix} ${subject}`;
}

class Composer {
  draft = $state<Draft | null>(null);
  /**
   * Replies and forwards are written inline, beneath the conversation; new
   * messages and reopened drafts use the compose sheet.
   */
  inline = $state(false);
  /** Gmail message ids this draft has been saved as (hidden from the open conversation). */
  savedMessageIds = $state<string[]>([]);
  private closing = false;
  saving = $state(false);
  lastSaved = $state<number | null>(null);
  loadingAttachments = $state(false);
  private savedHash = "";
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private savePromise: Promise<void> | null = null;

  // ---- identities ---------------------------------------------------------

  fromOptions(): FromOption[] {
    const out: FromOption[] = [];
    for (const a of app.accounts) {
      if (a.sendAs.length) {
        const sorted = [...a.sendAs].sort((x, y) => Number(y.isDefault) - Number(x.isDefault));
        for (const s of sorted) out.push({ account: a.email, address: { name: s.name || a.name, email: s.email }, sendAs: s });
      } else out.push({ account: a.email, address: { name: a.name, email: a.email } });
    }
    return out;
  }

  private defaultFrom(account: string): FromOption {
    const opts = this.fromOptions().filter((o) => o.account === account);
    return opts.find((o) => o.sendAs?.isDefault) ?? opts[0] ?? { account, address: { name: "", email: account } };
  }

  /** Picks the identity a reply should come from: the address the message was sent to. */
  private replyFrom(account: string, m: Message): FromOption {
    const opts = this.fromOptions().filter((o) => o.account === account);
    const recipients = [...m.to, ...m.cc, ...m.bcc, m.from];
    return opts.find((o) => recipients.some((r) => sameAddress(r, o.address))) ?? this.defaultFrom(account);
  }

  async signatureFor(email: string): Promise<string> {
    const s = settings.value;
    if (s.signaturesCustomized[email]) return s.signatures[email] ?? "";
    const sendAs = this.fromOptions().find((o) => o.address.email === email)?.sendAs;
    if (sendAs?.signature) return htmlToMarkdown(sendAs.signature);
    return "";
  }

  // ---- opening ------------------------------------------------------------

  private async begin(d: Omit<Draft, "signature" | "includeSignature">, inline = false) {
    if (this.draft) await this.close();
    const signature = await this.signatureFor(d.from.email);
    this.inline = inline;
    this.savedMessageIds = [];
    this.draft = { ...d, signature, includeSignature: true };
    this.lastSaved = null;
    this.savedHash = this.hash();
  }

  async openNew(init: Partial<Pick<Draft, "to" | "cc" | "bcc" | "subject" | "markdown">> = {}) {
    const account = app.current === "*" ? (app.accounts[0]?.email ?? "") : app.current;
    if (!account) return toasts.error("Add an account first");
    const from = this.defaultFrom(account);
    await this.begin({
      account,
      from: from.address,
      to: init.to ?? [],
      cc: init.cc ?? [],
      bcc: init.bcc ?? [],
      subject: init.subject ?? "",
      markdown: init.markdown ?? "",
      attachments: [],
      mode: "new",
    });
  }

  /** Opens compose from a mailto: URL. */
  async openMailto(url: string) {
    const u = new URL(url);
    const to = decodeURIComponent(u.pathname).split(",").filter(Boolean).map((email) => ({ name: "", email: email.trim() }));
    const p = u.searchParams;
    const list = (k: string) => (p.get(k) ?? "").split(",").filter(Boolean).map((email) => ({ name: "", email: email.trim() }));
    await this.openNew({ to, cc: list("cc"), bcc: list("bcc"), subject: p.get("subject") ?? "", markdown: p.get("body") ?? "" });
  }

  async openReply(thread: Thread, message: Message, mode: "reply" | "replyAll") {
    const account = thread.account;
    const acct = app.account(account);
    const mine = myAddresses(acct);
    const fromMe = mine.has(message.from.email.toLowerCase());
    let to: Address[];
    let cc: Address[] = [];
    if (fromMe) {
      to = message.to;
      if (mode === "replyAll") cc = message.cc;
    } else {
      to = message.replyTo.length ? message.replyTo : [message.from];
      if (mode === "replyAll") {
        cc = [...message.to, ...message.cc].filter((a) => !mine.has(a.email.toLowerCase()) && !to.some((t) => sameAddress(t, a)));
      }
    }
    const from = this.replyFrom(account, message);
    cc = cc.filter((a) => !sameAddress(a, from.address));
    const html = message.html ? sanitizeFragment(message.html) : textToHtml(message.text ?? "");
    const text = message.text ?? htmlToText(message.html ?? "");
    await this.begin({
      account,
      from: from.address,
      to: uniq(to),
      cc: uniq(cc),
      bcc: [],
      subject: prefixed(thread.subject || message.subject, "Re:"),
      markdown: "",
      attachments: [],
      quote: { kind: "reply", header: replyHeader(message.date, message.from), html, text },
      threadId: thread.id,
      inReplyTo: message.messageId || undefined,
      references: [message.references, message.messageId].filter(Boolean).join(" ") || undefined,
      mode,
    }, true);
  }

  async openForward(thread: Thread, message: Message) {
    const account = thread.account;
    const from = this.replyFrom(account, message);
    const html = message.html ? sanitizeFragment(message.html) : textToHtml(message.text ?? "");
    const text = message.text ?? htmlToText(message.html ?? "");
    const fmt = (a: Address) => (a.name ? `${a.name} <${a.email}>` : a.email);
    const fields: [string, string][] = [
      ["From", fmt(message.from)],
      ["Date", fullDate(message.date, Infinity)],
      ["Subject", message.subject],
      ["To", message.to.map(fmt).join(", ")],
    ];
    if (message.cc.length) fields.push(["Cc", message.cc.map(fmt).join(", ")]);
    await this.begin({
      account,
      from: from.address,
      to: [],
      cc: [],
      bcc: [],
      subject: prefixed(thread.subject || message.subject, "Fwd:"),
      markdown: "",
      attachments: [],
      quote: { kind: "forward", header: "", html, text, forwardFields: fields },
      threadId: thread.id,
      inReplyTo: message.messageId || undefined,
      references: [message.references, message.messageId].filter(Boolean).join(" ") || undefined,
      mode: "forward",
    }, true);
    const files = message.attachments.filter((a) => !a.inline);
    if (files.length) {
      this.loadingAttachments = true;
      try {
        const b = app.backend(account);
        const loaded = await Promise.all(
          files.map(async (a) => ({
            filename: a.filename,
            mimeType: a.mimeType,
            size: a.size,
            data: await b.getAttachment(a.messageId, a.attachmentId),
          })),
        );
        if (this.draft && this.draft.mode === "forward") this.draft.attachments = [...loaded, ...this.draft.attachments];
      } catch (e) {
        app.handleError(e, account);
      } finally {
        this.loadingAttachments = false;
      }
    }
  }

  /** Opens an existing Gmail draft for editing. */
  async openDraft(account: string, message: Message, threadId: string) {
    try {
      const ref = await app.backend(account).findDraft(message.id);
      if (!ref) return toasts.error("This draft no longer exists");
      const stored = await kvGet<StoredDraftBody>(`draftbody:${ref.draftId}`);
      let markdown = stored?.markdown;
      if (markdown === undefined) {
        const text = message.text ?? htmlToText(message.html ?? "");
        markdown = text.split(/\n-- \n/)[0].split(/\nOn .+ wrote:\n/)[0].split(/\n---------- Forwarded message/)[0].trimEnd();
      }
      const isReply = !!message.references || threadId !== message.id;
      if (this.draft) await this.close();
      this.inline = false;
      this.savedMessageIds = [];
      this.draft = {
        account,
        from: message.from.email ? message.from : this.defaultFrom(account).address,
        to: message.to,
        cc: message.cc,
        bcc: message.bcc,
        subject: message.subject,
        markdown,
        signature: stored?.signature ?? (await this.signatureFor(message.from.email)),
        includeSignature: stored?.includeSignature ?? !!stored,
        quote: stored?.quote,
        attachments: [],
        threadId: isReply ? threadId : undefined,
        inReplyTo: undefined,
        references: message.references || undefined,
        draftId: ref.draftId,
        mode: "draft",
      };
      // Draft attachments are kept by downloading them into the compose state.
      const files = message.attachments.filter((a) => !a.inline);
      if (files.length) {
        this.loadingAttachments = true;
        const b = app.backend(account);
        const loaded = await Promise.all(
          files.map(async (a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size, data: await b.getAttachment(a.messageId, a.attachmentId) })),
        );
        if (this.draft?.draftId === ref.draftId) this.draft.attachments = loaded;
        this.loadingAttachments = false;
      }
        this.savedHash = this.hash();
    } catch (e) {
      this.loadingAttachments = false;
      app.handleError(e, account);
    }
  }

  /** Whether the inline draft belongs to this conversation. */
  isInlineFor(account: string, threadId: string): boolean {
    const d = this.draft;
    return !!d && this.inline && d.account === account && d.threadId === threadId;
  }

  /** Moves an inline reply or forward into the compose sheet. */
  popOut() {
    this.inline = false;
  }

  /** Where a restored message reopens: inline if its conversation is still open. */
  private restoreInline(d: Draft, wasInline: boolean): boolean {
    return wasInline && !!app.open && app.open.account === d.account && app.open.id === d.threadId;
  }

  // ---- editing ------------------------------------------------------------

  async setFrom(opt: FromOption) {
    const d = this.draft;
    if (!d) return;
    const prevSigDefault = await this.signatureFor(d.from.email);
    if (opt.account !== d.account) {
      // Drafts and threads belong to one mailbox; move the draft.
      if (d.draftId) app.backend(d.account).deleteDraft(d.draftId).catch(() => {});
      d.draftId = undefined;
      d.threadId = undefined;
      d.account = opt.account;
    }
    d.from = opt.address;
    // Swap the signature unless the user edited it for this message.
    if (d.signature === prevSigDefault) d.signature = await this.signatureFor(opt.address.email);
    this.scheduleSave();
  }

  async addFiles(files: FileList | File[]) {
    const d = this.draft;
    if (!d) return;
    for (const f of Array.from(files)) {
      const buf = new Uint8Array(await f.arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      d.attachments.push({ filename: f.name, mimeType: f.type || "application/octet-stream", size: f.size, data: btoa(s) });
    }
    const total = d.attachments.reduce((n, a) => n + a.size, 0);
    if (total > 25 * 1024 * 1024) toasts.error("Attachments exceed Gmail's 25 MB limit");
    this.scheduleSave();
  }

  removeAttachment(i: number) {
    this.draft?.attachments.splice(i, 1);
    this.scheduleSave();
  }

  private hash(): string {
    const d = this.draft;
    if (!d) return "";
    return JSON.stringify([d.from.email, d.to, d.cc, d.bcc, d.subject, d.markdown, d.signature, d.includeSignature, d.attachments.map((a) => a.filename + a.size)]);
  }

  get dirty(): boolean {
    return !!this.draft && this.hash() !== this.savedHash;
  }

  get isEmpty(): boolean {
    const d = this.draft;
    if (!d) return true;
    return !d.to.length && !d.cc.length && !d.bcc.length && !d.subject.trim() && !d.markdown.trim() && !d.attachments.length;
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 4000);
  }

  private outgoing(d: Draft): Outgoing {
    return {
      from: d.from,
      to: d.to,
      cc: d.cc,
      bcc: d.bcc,
      subject: d.subject,
      markdown: d.markdown,
      signature: d.includeSignature ? d.signature : "",
      quote: d.quote,
      attachments: d.attachments,
      threadId: d.threadId,
      inReplyTo: d.inReplyTo,
      references: d.references,
    };
  }

  private build(d: Draft): string {
    const out = this.outgoing(d);
    return buildMime(out, renderOutgoing(out));
  }

  async save(): Promise<void> {
    clearTimeout(this.saveTimer);
    if (this.savePromise) await this.savePromise;
    const d = this.draft;
    if (!d || !this.dirty || this.isEmpty) return;
    const snapshot = $state.snapshot(d) as Draft;
    const hash = this.hash();
    this.saving = true;
    this.savePromise = (async () => {
      try {
        const ref = await app.backend(snapshot.account).saveDraft(this.build(snapshot), snapshot.threadId, snapshot.draftId);
        const body: StoredDraftBody = {
          markdown: snapshot.markdown,
          signature: snapshot.signature,
          includeSignature: snapshot.includeSignature,
          quote: snapshot.quote,
        };
        await kvSet(`draftbody:${ref.draftId}`, body);
        if (this.draft && (this.draft.draftId === snapshot.draftId || !this.draft.draftId)) {
          this.draft.draftId = ref.draftId;
          this.savedMessageIds = [...this.savedMessageIds, ref.messageId];
          if (!this.draft.threadId && snapshot.mode !== "new") this.draft.threadId = ref.threadId;
        }
        if (this.hash() === hash) this.savedHash = hash;
        this.lastSaved = Date.now();
      } catch (e) {
        app.handleError(e, snapshot.account, true);
      } finally {
        this.saving = false;
        this.savePromise = null;
      }
    })();
    await this.savePromise;
  }

  /** Closes compose, keeping the message as a draft (Gmail behavior). */
  async close() {
    const d = this.draft;
    if (!d || this.closing) return;
    clearTimeout(this.saveTimer);
    const shouldSave = this.dirty && !this.isEmpty;
    if (shouldSave) {
      this.closing = true;
      try {
        await this.save();
      } finally {
        this.closing = false;
      }
      if (this.draft === d) this.draft = null;
      toasts.show("Saved to Drafts");
      app.afterSend();
    } else this.draft = null;
  }

  async discard() {
    const d = this.draft;
    if (!d) return;
    clearTimeout(this.saveTimer);
    if (this.savePromise) await this.savePromise;
    const id = this.draft?.draftId ?? d.draftId;
    this.draft = null;
    if (id) {
      try {
        await app.backend(d.account).deleteDraft(id);
        await kvDelete(`draftbody:${id}`);
        app.afterSend();
      } catch (e) {
        app.handleError(e, d.account, true);
      }
    }
    toasts.show("Draft discarded");
  }

  validate(d: Draft): string | null {
    const all = [...d.to, ...d.cc, ...d.bcc];
    if (!all.length) return "Add at least one recipient";
    const bad = all.find((a) => !isValidEmail(a.email));
    if (bad) return `"${bad.email}" isn't a valid address`;
    return null;
  }

  async send() {
    const d = this.draft;
    if (!d) return;
    const err = this.validate(d);
    if (err) return toasts.error(err);
    if (!d.subject.trim() && !confirm("Send without a subject?")) return;
    clearTimeout(this.saveTimer);
    if (this.savePromise) await this.savePromise;
    const snapshot = $state.snapshot(this.draft!) as Draft;
    const raw = this.build(snapshot);
    const wasInline = this.inline;
    this.draft = null;
    const go = () => this.deliver(snapshot, raw, wasInline);
    const secs = settings.value.undoSendSeconds;
    if (secs > 0) {
      toasts.show("Sending…", {
        action: "Undo",
        duration: secs * 1000,
        onAction: async () => {
          if (this.draft) await this.close();
          this.inline = this.restoreInline(snapshot, wasInline);
          this.draft = snapshot;
          this.savedHash = "";
        },
        onExpire: go,
      });
    } else await go();
  }

  private async deliver(d: Draft, raw: string, wasInline: boolean) {
    try {
      const b = app.backend(d.account);
      await b.send(raw, d.threadId);
      if (d.draftId) {
        await b.deleteDraft(d.draftId).catch(() => {});
        kvDelete(`draftbody:${d.draftId}`);
      }
      contacts.remember([...d.to, ...d.cc, ...d.bcc]);
      toasts.show("Message sent");
      app.afterSend();
    } catch (e) {
      app.handleError(e, d.account);
      // Put it back so nothing is lost.
      if (this.draft) await this.close();
      this.inline = this.restoreInline(d, wasInline);
      this.draft = d;
      this.savedHash = "";
      toasts.error("Couldn't send. Your message is still open.");
    }
  }

  recipientsSummary(d: Draft): string {
    return [...d.to, ...d.cc, ...d.bcc].map(displayName).join(", ");
  }
}

export const composer = new Composer();
