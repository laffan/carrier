/**
 * In-memory mailbox used when the app runs in a plain browser (no Tauri), so
 * the interface can be developed and tested without a Google account.
 */
import { sleep } from "../util";
import { decodeBody, decodeHeaderText, parseAddressList } from "./mime";
import type {
  Address,
  Attachment,
  Contact,
  DraftRef,
  Label,
  ListQuery,
  ListResult,
  MailBackend,
  Message,
  SendAs,
  Thread,
  ThreadSummary,
} from "./types";

interface DemoMessage extends Message {}

const H = 3_600_000;
const D = 24 * H;

const people: Address[] = [
  { name: "Maya Okafor", email: "maya@okafor.studio" },
  { name: "Jonas Lindqvist", email: "jonas@northwind.se" },
  { name: "Priya Raman", email: "priya.raman@ucsc.edu" },
  { name: "Theo Marchetti", email: "theo@marchetti.it" },
  { name: "Ines Duarte", email: "ines@duarte.pt" },
  { name: "GitHub", email: "noreply@github.com" },
  { name: "Figma", email: "team@figma.com" },
  { name: "Delta", email: "receipts@delta.example" },
  { name: "Hacker Newsletter", email: "kale@hackernewsletter.com" },
  { name: "Ana Kowalski", email: "ana.k@example.net" },
];

type Seed = {
  from: number | "me";
  to?: (number | "me")[];
  subject: string;
  body: string;
  ago: number;
  labels: string[];
  replies?: { from: number | "me"; body: string; ago: number; unread?: boolean }[];
  attach?: string;
  html?: boolean;
};

const seeds: Seed[] = [
  {
    from: 0,
    subject: "Studio visit next week?",
    body: "Hi!\n\nWe're finally done with the move. Would you like to come by the new studio next Thursday? I'd love to show you the prints.\n\nMaya",
    ago: 0.3 * H,
    labels: ["INBOX", "CATEGORY_PERSONAL", "UNREAD", "IMPORTANT"],
  },
  {
    from: 1,
    subject: "Re: Q4 roadmap draft",
    body: "Attached is the latest version. Main changes are in section 3 — we pushed the sync work to January.",
    ago: 2 * H,
    labels: ["INBOX", "CATEGORY_PERSONAL", "Label_projects"],
    attach: "roadmap-q4.txt",
    replies: [
      { from: "me", body: "Thanks Jonas. Looks good to me — one question about the iPad timeline, can we talk tomorrow?", ago: 1.5 * H },
      { from: 1, body: "Sure, 10am works. I'll send an invite.", ago: 1 * H, unread: true },
    ],
  },
  {
    from: 5,
    subject: "[laffan/carrier] Pull request opened: Markdown compose",
    body: "A new pull request was opened.\n\nhttps://github.com/laffan/carrier/pull/1\n\n— Reply to this email directly or view it on GitHub.",
    ago: 5 * H,
    labels: ["INBOX", "CATEGORY_UPDATES", "UNREAD"],
  },
  {
    from: 2,
    subject: "Reading group — this Friday",
    body: "Hello all,\n\nThis Friday we're discussing chapters 4–6. Snacks provided.\n\nBest,\nPriya",
    ago: 9 * H,
    labels: ["INBOX", "CATEGORY_PERSONAL", "STARRED"],
  },
  {
    from: 6,
    subject: "What's new in Figma this month",
    body: "<h1 style='font-family:Helvetica'>New this month</h1><p style='font-family:Helvetica'>Dev Mode updates, faster files, and more. <a href='https://figma.com'>Read more</a></p><table width='600' style='background:#f3f3f3'><tr><td style='padding:24px;font-family:Helvetica'>A wide newsletter-style table that is wider than a narrow screen.</td></tr></table>",
    html: true,
    ago: 1.2 * D,
    labels: ["INBOX", "CATEGORY_PROMOTIONS", "UNREAD"],
  },
  {
    from: 7,
    subject: "Your trip confirmation: SFO → JFK",
    body: "Confirmation #K7Q2LM\n\nDeparts Thu, Nov 20, 7:05 AM\nArrives 3:40 PM\n\nSeat 21A",
    ago: 1.8 * D,
    labels: ["INBOX", "CATEGORY_UPDATES", "Label_travel"],
  },
  {
    from: 3,
    subject: "Photos from Lisbon",
    body: "Finally got around to sorting them. A few of my favourites are attached — the rest are in the shared album.\n\nT.",
    ago: 2.5 * D,
    labels: ["INBOX", "CATEGORY_PERSONAL"],
    attach: "lisbon-notes.txt",
  },
  {
    from: 8,
    subject: "Hacker Newsletter #712",
    body: "The best articles from the week.\n\n• Why we moved off Kubernetes\n• A gentle introduction to CRDTs\n• Show HN: A tiny mail client",
    ago: 3 * D,
    labels: ["INBOX", "CATEGORY_PROMOTIONS"],
  },
  {
    from: 4,
    subject: "Invoice 2025-031",
    body: "Hi, please find the invoice for October below.\n\nTotal: €1,200.00\nDue: Nov 30\n\nObrigada,\nInês",
    ago: 4 * D,
    labels: ["INBOX", "CATEGORY_PERSONAL", "Label_receipts"],
  },
  {
    from: 9,
    subject: "Quick question about the grant",
    body: "Do you know if the deadline moved? The portal still says Dec 1 but I heard otherwise.",
    ago: 6 * D,
    labels: ["INBOX", "CATEGORY_PERSONAL"],
    replies: [{ from: "me", body: "As far as I know it's still Dec 1. I'll double check with the office.", ago: 5.5 * D }],
  },
  {
    from: "me",
    to: [2],
    subject: "Slides for Tuesday",
    body: "Here's the outline:\n\n1. Motivation\n2. Prior work\n3. **What we built**\n\nLet me know if anything's missing.",
    ago: 7 * D,
    labels: ["SENT"],
  },
  {
    from: "me",
    to: [0],
    subject: "Re: Studio visit next week?",
    body: "Thursday works! Should I bring anything?",
    ago: 0.1 * H,
    labels: ["DRAFT"],
  },
  {
    from: 1,
    subject: "Offsite logistics",
    body: "We booked the cabin for the 14th–16th. Carpool sign-up sheet coming soon.",
    ago: 9 * D,
    labels: ["Label_travel", "Label_projects"],
  },
  {
    from: 5,
    subject: "[GitHub] A new SSH key was added to your account",
    body: "If you did not add this key, please review your account.",
    ago: 12 * D,
    labels: ["SPAM"],
  },
  {
    from: 6,
    subject: "Your weekly summary",
    body: "You edited 4 files this week.",
    ago: 14 * D,
    labels: ["TRASH"],
  },
];

// Filler to exercise pagination.
for (let i = 0; i < 36; i++) {
  const p = (i * 7) % people.length;
  seeds.push({
    from: p,
    subject: ["Following up", "Notes from today", "Weekend plans", "Re: Draft feedback", "Receipt for your order", "Meeting moved", "Hello from the coast", "Shipping update"][i % 8],
    body: `Message ${i + 1}. ${["Let me know what you think.", "Talk soon.", "See attached notes.", "Thanks again!"][i % 4]}`,
    ago: (15 + i * 1.7) * D,
    labels: ["INBOX", i % 3 === 0 ? "CATEGORY_UPDATES" : i % 5 === 0 ? "CATEGORY_SOCIAL" : "CATEGORY_PERSONAL"],
  });
}

const userLabels: Label[] = [
  { id: "Label_projects", name: "Projects", type: "user" },
  { id: "Label_receipts", name: "Receipts", type: "user" },
  { id: "Label_travel", name: "Travel", type: "user" },
];

const systemLabels = [
  "INBOX", "STARRED", "IMPORTANT", "SENT", "DRAFT", "SPAM", "TRASH", "UNREAD",
  "CATEGORY_PERSONAL", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS",
];

function textToB64(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

export class DemoBackend implements MailBackend {
  private messages: DemoMessage[] = [];
  private drafts = new Map<string, DraftRef>();
  private attachmentData = new Map<string, string>();
  private seq = 1;
  private me: Address;

  constructor(public readonly email: string, name: string, variant = 0) {
    this.me = { name, email };
    const now = Date.now();
    const list = variant === 0 ? seeds : seeds.filter((_, i) => i % 3 === 1).map((s) => ({ ...s, ago: s.ago + 3 * H }));
    list.forEach((s, ti) => {
      const threadId = `t${variant}_${ti}`;
      const addr = (x: number | "me") => (x === "me" ? this.me : people[x]);
      const first = this.make(threadId, addr(s.from), (s.to ?? ["me"]).map(addr), s.subject, s.body, now - s.ago, s.labels, s.html);
      if (s.attach) {
        const attId = `att_${first.id}`;
        const data = textToB64(`Demo attachment: ${s.attach}\n\nThis file exists only in demo mode.\n`);
        this.attachmentData.set(attId, data);
        first.attachments.push({ messageId: first.id, attachmentId: attId, filename: s.attach, mimeType: "text/plain", size: 64, inline: false });
      }
      if (s.labels.includes("DRAFT")) this.drafts.set(`d_${first.id}`, { draftId: `d_${first.id}`, messageId: first.id, threadId });
      for (const r of s.replies ?? []) {
        const from = addr(r.from);
        const to = r.from === "me" ? [addr(s.from)] : [this.me];
        const labels = s.labels.filter((l) => l !== "UNREAD" && l !== "STARRED");
        if (r.from === "me") labels.push("SENT");
        if (r.unread) labels.push("UNREAD");
        this.make(threadId, from, to, "Re: " + s.subject.replace(/^Re: /, ""), r.body, now - r.ago, labels);
      }
    });
  }

  private make(threadId: string, from: Address, to: Address[], subject: string, body: string, date: number, labels: string[], html = false): DemoMessage {
    const id = `m${this.seq++}`;
    const m: DemoMessage = {
      id,
      threadId,
      labelIds: [...labels],
      snippet: (html ? body.replace(/<[^>]+>/g, " ") : body).replace(/\s+/g, " ").trim().slice(0, 140),
      date,
      from,
      to,
      cc: [],
      bcc: [],
      replyTo: [],
      subject,
      messageId: `<${id}@demo.carrier>`,
      references: "",
      html: html ? body : undefined,
      text: html ? undefined : body,
      attachments: [] as Attachment[],
    };
    this.messages.push(m);
    return m;
  }

  private async delay() {
    await sleep(120 + Math.random() * 120);
  }

  private threadMessages(id: string) {
    return this.messages.filter((m) => m.threadId === id).sort((a, b) => a.date - b.date);
  }

  async listLabels(withCounts: boolean): Promise<Label[]> {
    await this.delay();
    const labels: Label[] = [...systemLabels.map((id) => ({ id, name: id, type: "system" as const })), ...userLabels.map((l) => ({ ...l }))];
    if (withCounts) {
      for (const l of labels) {
        const threads = new Map<string, boolean>();
        for (const m of this.messages) {
          if (!m.labelIds.includes(l.id)) continue;
          threads.set(m.threadId, (threads.get(m.threadId) ?? false) || m.labelIds.includes("UNREAD"));
        }
        l.total = threads.size;
        l.unread = [...threads.values()].filter(Boolean).length;
      }
    }
    return labels;
  }

  private matches(msgs: DemoMessage[], q: string): boolean {
    const terms = q.toLowerCase().match(/(\w+:"[^"]*"|\w+:\S+|"[^"]*"|\S+)/g) ?? [];
    return terms.every((t) => {
      const [k, ...rest] = t.split(":");
      const v = rest.join(":").replace(/"/g, "");
      if (rest.length) {
        if (k === "is") return v === "unread" ? msgs.some((m) => m.labelIds.includes("UNREAD")) : v === "starred" ? msgs.some((m) => m.labelIds.includes("STARRED")) : true;
        if (k === "from") return msgs.some((m) => `${m.from.name} ${m.from.email}`.toLowerCase().includes(v));
        if (k === "to") return msgs.some((m) => m.to.some((a) => `${a.name} ${a.email}`.toLowerCase().includes(v)));
        if (k === "has") return v === "attachment" ? msgs.some((m) => m.attachments.length > 0) : true;
        if (k === "in" || k === "label") return msgs.some((m) => m.labelIds.some((l) => l.toLowerCase().includes(v)));
        if (k === "subject") return msgs.some((m) => m.subject.toLowerCase().includes(v));
      }
      const needle = t.replace(/"/g, "");
      return msgs.some((m) => `${m.subject} ${m.from.name} ${m.from.email} ${m.text ?? ""} ${m.html ?? ""}`.toLowerCase().includes(needle));
    });
  }

  async listThreads(query: ListQuery): Promise<ListResult> {
    await this.delay();
    const ids = [...new Set(this.messages.map((m) => m.threadId))];
    let threads = ids.map((id) => this.summary(id));
    const want = query.labelIds ?? [];
    threads = threads.filter((t) => want.every((l) => t.labelIds.includes(l)));
    const inTrashOrSpam = want.includes("TRASH") || want.includes("SPAM") || /in:(trash|spam)/.test(query.q ?? "");
    if (!inTrashOrSpam) threads = threads.filter((t) => !t.labelIds.includes("TRASH") && !t.labelIds.includes("SPAM"));
    if (query.q) threads = threads.filter((t) => this.matches(this.threadMessages(t.id), query.q!));
    threads.sort((a, b) => b.date - a.date);
    const start = Number(query.pageToken ?? 0);
    const size = query.maxResults ?? 30;
    const page = threads.slice(start, start + size);
    return { threads: page, nextPageToken: start + size < threads.length ? String(start + size) : undefined };
  }

  private summary(id: string): ThreadSummary {
    const msgs = this.threadMessages(id);
    const real = msgs.filter((m) => !m.labelIds.includes("DRAFT"));
    const shown = real.length ? real : msgs;
    const last = shown[shown.length - 1];
    const senders = real;
    const labelIds = [...new Set(msgs.flatMap((m) => m.labelIds))];
    const participants: ThreadSummary["participants"] = [];
    for (const m of senders) {
      const existing = participants.find((p) => p.email === m.from.email);
      const unread = m.labelIds.includes("UNREAD");
      if (existing) {
        existing.unread ||= unread;
        participants.splice(participants.indexOf(existing), 1);
        participants.push(existing);
      } else participants.push({ ...m.from, unread, isMe: m.from.email === this.email });
    }
    return {
      account: this.email,
      id,
      historyId: String(msgs.map((m) => m.labelIds.join()).join("|").length + msgs.length),
      subject: msgs[0].subject,
      snippet: last.snippet,
      participants,
      recipients: last.to.map((a) => a.name || a.email),
      messageCount: shown.length,
      date: last.date,
      labelIds,
      unread: msgs.some((m) => m.labelIds.includes("UNREAD")),
      starred: msgs.some((m) => m.labelIds.includes("STARRED")),
      hasAttachments: msgs.some((m) => m.attachments.length > 0),
      hasDraft: msgs.some((m) => m.labelIds.includes("DRAFT")),
      draft: (() => {
        const d = [...msgs].reverse().find((m) => m.labelIds.includes("DRAFT"));
        return d ? { messageId: d.id, to: d.to.map((a) => a.name || a.email), subject: d.subject, snippet: d.snippet, date: d.date } : undefined;
      })(),
      lastMessageId: last.id,
    };
  }

  async getThread(id: string): Promise<Thread> {
    await this.delay();
    const messages = this.threadMessages(id).map((m) => ({ ...m, labelIds: [...m.labelIds] }));
    return {
      account: this.email,
      id,
      subject: messages[0]?.subject ?? "",
      labelIds: [...new Set(messages.flatMap((m) => m.labelIds))],
      messages,
    };
  }

  private apply(msgs: DemoMessage[], add: string[], remove: string[]) {
    for (const m of msgs) {
      m.labelIds = m.labelIds.filter((l) => !remove.includes(l));
      for (const l of add) if (!m.labelIds.includes(l)) m.labelIds.push(l);
    }
  }

  async modifyThreads(ids: string[], add: string[], remove: string[]) {
    await this.delay();
    this.apply(this.messages.filter((m) => ids.includes(m.threadId)), add, remove);
  }

  async modifyMessages(ids: string[], add: string[], remove: string[]) {
    await this.delay();
    this.apply(this.messages.filter((m) => ids.includes(m.id)), add, remove);
  }

  async trashThreads(ids: string[]) {
    await this.modifyThreads(ids, ["TRASH"], ["INBOX"]);
  }

  async untrashThreads(ids: string[]) {
    await this.modifyThreads(ids, [], ["TRASH"]);
  }

  async deleteThreadsForever(ids: string[]) {
    await this.delay();
    this.messages = this.messages.filter((m) => !ids.includes(m.threadId));
  }

  async getAttachment(_messageId: string, attachmentId: string): Promise<string> {
    await this.delay();
    return this.attachmentData.get(attachmentId) ?? "";
  }

  async listSendAs(): Promise<SendAs[]> {
    return [
      {
        email: this.email,
        name: this.me.name,
        isDefault: true,
        isPrimary: true,
        signature: this.email.startsWith("work") ? "<div>Alex Rivera<br>Northwind Research</div>" : "",
      },
    ];
  }

  private fromRaw(raw: string, threadId: string | undefined, labels: string[]): DemoMessage {
    const [head, ...rest] = raw.split("\r\n\r\n");
    const hv = (n: string) => head.match(new RegExp(`^${n}: (.*)$`, "mi"))?.[1] ?? "";
    const plain = rest.join("\r\n\r\n").match(/text\/plain[^\r]*\r\nContent-Transfer-Encoding: base64\r\n\r\n([\sA-Za-z0-9+/=]+?)\r\n--/);
    const text = plain ? decodeBody(plain[1].replace(/\s/g, "")) : "";
    const html = rest.join("\r\n\r\n").match(/text\/html[^\r]*\r\nContent-Transfer-Encoding: base64\r\n\r\n([\sA-Za-z0-9+/=]+?)\r\n--/);
    const tid = threadId ?? `t_new_${this.seq}`;
    const m = this.make(tid, this.me, parseAddressList(decodeHeaderText(hv("To"))), decodeHeaderText(hv("Subject")), "", Date.now(), labels);
    m.html = html ? decodeBody(html[1].replace(/\s/g, "")) : undefined;
    m.text = text;
    const visible = m.html ? new DOMParser().parseFromString(m.html, "text/html").body.textContent ?? "" : text;
    m.snippet = visible.replace(/\s+/g, " ").trim().slice(0, 140);
    m.cc = parseAddressList(hv("Cc"));
    m.bcc = parseAddressList(hv("Bcc"));
    return m;
  }

  async send(raw: string, threadId?: string) {
    await this.delay();
    const m = this.fromRaw(raw, threadId, ["SENT"]);
    return { id: m.id, threadId: m.threadId };
  }

  async saveDraft(raw: string, threadId?: string, draftId?: string): Promise<DraftRef> {
    await this.delay();
    if (draftId) {
      const old = this.drafts.get(draftId);
      if (old) this.messages = this.messages.filter((m) => m.id !== old.messageId);
    }
    const m = this.fromRaw(raw, threadId, ["DRAFT"]);
    const ref = { draftId: draftId ?? `d_${m.id}`, messageId: m.id, threadId: m.threadId };
    this.drafts.set(ref.draftId, ref);
    return ref;
  }

  async deleteDraft(draftId: string) {
    await this.delay();
    const d = this.drafts.get(draftId);
    if (d) this.messages = this.messages.filter((m) => m.id !== d.messageId);
    this.drafts.delete(draftId);
  }

  async findDraft(messageId: string) {
    return [...this.drafts.values()].find((d) => d.messageId === messageId);
  }

  async searchContacts(query: string): Promise<Contact[]> {
    const q = query.toLowerCase();
    return people.filter((p) => p.name.toLowerCase().includes(q) || p.email.includes(q));
  }
}
