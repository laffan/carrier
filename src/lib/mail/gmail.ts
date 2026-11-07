import { httpFetch } from "../platform";
import { decodeEntities, pMap, sleep } from "../util";
import { AuthError, accessToken } from "./auth";
import { decodeHeaderText, header, parseAddress, parseAddressList, parsePayload, type GmailHeader, type GmailPart } from "./mime";
import type {
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

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const UPLOAD = "https://gmail.googleapis.com/upload/gmail/v1/users/me";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  historyId?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
}

interface GmailThread {
  id: string;
  historyId: string;
  snippet?: string;
  messages?: GmailMessage[];
}

const SUMMARY_HEADERS = ["From", "To", "Subject", "Date", "Content-Type"];

/** System labels that the sidebar shows unread counts for. */
const COUNTED = new Set(["INBOX", "CATEGORY_PERSONAL", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS", "DRAFT", "SPAM"]);

export class GmailBackend implements MailBackend {
  private myAddresses = new Set<string>();
  private draftsCache: { at: number; list: DraftRef[] } | null = null;
  private contactsWarm = false;

  constructor(public readonly email: string) {
    this.myAddresses.add(email.toLowerCase());
  }

  // ---- transport ----------------------------------------------------------

  private async request(url: string, init: RequestInit = {}, attempt = 0, refreshToken = false): Promise<Response> {
    const token = await accessToken(this.email, refreshToken);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    let res: Response;
    try {
      res = await httpFetch(url, { ...init, headers });
    } catch (e) {
      if (attempt < 2) {
        await sleep(500 * 2 ** attempt);
        return this.request(url, init, attempt + 1);
      }
      throw e;
    }
    if (res.status === 401 && !refreshToken) return this.request(url, init, attempt + 1, true);
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(400 * 2 ** attempt + Math.random() * 200);
      return this.request(url, init, attempt + 1);
    }
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        msg = body?.error?.message || msg;
      } catch {
        /* ignore */
      }
      if (res.status === 401) throw new AuthError(msg, this.email);
      if (res.status === 403 && /insufficient|scope/i.test(msg)) throw new AuthError(msg, this.email);
      throw new ApiError(msg, res.status);
    }
    return res;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.request(path.startsWith("http") ? path : API + path, init);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private post<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
    return this.json<T>(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** multipart/related upload: JSON metadata + raw RFC 822 message (up to 35 MB). */
  private upload<T>(path: string, metadata: unknown, raw: string, method = "POST"): Promise<T> {
    const b = "carrier_upload_" + Math.random().toString(36).slice(2);
    const body =
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${b}\r\nContent-Type: message/rfc822\r\n\r\n${raw}\r\n--${b}--`;
    return this.json<T>(`${UPLOAD}${path}${path.includes("?") ? "&" : "?"}uploadType=multipart`, {
      method,
      headers: { "Content-Type": `multipart/related; boundary=${b}` },
      body,
    });
  }

  // ---- labels -------------------------------------------------------------

  async listLabels(withCounts: boolean): Promise<Label[]> {
    const res = await this.json<{ labels: { id: string; name: string; type: string }[] }>("/labels");
    const labels: Label[] = (res.labels ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type === "user" ? "user" : "system",
    }));
    if (withCounts) {
      const targets = labels.filter((l) => l.type === "user" || COUNTED.has(l.id));
      await pMap(targets, 8, async (l) => {
        try {
          const d = await this.json<{ threadsUnread?: number; threadsTotal?: number }>(`/labels/${encodeURIComponent(l.id)}`);
          l.unread = d.threadsUnread ?? 0;
          l.total = d.threadsTotal ?? 0;
        } catch {
          /* counts are cosmetic */
        }
      });
    }
    return labels;
  }

  // ---- threads ------------------------------------------------------------

  async listThreads(query: ListQuery, cache?: Map<string, ThreadSummary>): Promise<ListResult> {
    const p = new URLSearchParams();
    for (const l of query.labelIds ?? []) p.append("labelIds", l);
    if (query.q) p.set("q", query.q);
    if (query.pageToken) p.set("pageToken", query.pageToken);
    p.set("maxResults", String(query.maxResults ?? 30));
    const res = await this.json<{ threads?: GmailThread[]; nextPageToken?: string }>(`/threads?${p}`);
    const list = res.threads ?? [];
    const threads = await pMap(list, 8, async (t) => {
      const cached = cache?.get(t.id);
      if (cached && cached.historyId === t.historyId) return cached;
      const hs = SUMMARY_HEADERS.map((h) => `metadataHeaders=${h}`).join("&");
      const full = await this.json<GmailThread>(`/threads/${t.id}?format=metadata&${hs}`);
      return this.summarize(full);
    });
    return { threads, nextPageToken: res.nextPageToken };
  }

  private summarize(t: GmailThread): ThreadSummary {
    const msgs = [...(t.messages ?? [])].sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
    const real = msgs.filter((m) => !m.labelIds?.includes("DRAFT"));
    const shown = real.length ? real : msgs;
    const last = shown[shown.length - 1];
    const senders = real;
    const labelIds = new Set<string>();
    msgs.forEach((m) => m.labelIds?.forEach((l) => labelIds.add(l)));
    const participants: ThreadSummary["participants"] = [];
    for (const m of senders) {
      const from = parseAddress(decodeHeaderText(header(m.payload?.headers, "From")));
      if (!from) continue;
      const isMe = this.myAddresses.has(from.email.toLowerCase());
      const unread = !!m.labelIds?.includes("UNREAD");
      const existing = participants.find((p) => p.email.toLowerCase() === from.email.toLowerCase());
      if (existing) {
        existing.unread ||= unread;
        // Gmail shows the latest position of a repeated sender.
        participants.splice(participants.indexOf(existing), 1);
        participants.push(existing);
      } else participants.push({ name: from.name, email: from.email, unread, isMe });
    }
    const first = msgs[0];
    const d = [...msgs].reverse().find((m) => m.labelIds?.includes("DRAFT"));
    const draft = d
      ? {
          messageId: d.id,
          to: parseAddressList(decodeHeaderText(header(d.payload?.headers, "To"))).map((a) => a.name || a.email),
          subject: decodeHeaderText(header(d.payload?.headers, "Subject")),
          snippet: decodeEntities(d.snippet ?? ""),
          date: Number(d.internalDate ?? 0),
        }
      : undefined;
    return {
      account: this.email,
      id: t.id,
      historyId: t.historyId,
      subject: decodeHeaderText(header(first?.payload?.headers, "Subject")),
      snippet: decodeEntities(last?.snippet ?? t.snippet ?? ""),
      participants,
      recipients: parseAddressList(decodeHeaderText(header(last?.payload?.headers, "To"))).map((a) => a.name || a.email),
      messageCount: shown.length,
      date: Number(last?.internalDate ?? 0),
      labelIds: [...labelIds],
      unread: msgs.some((m) => m.labelIds?.includes("UNREAD")),
      starred: msgs.some((m) => m.labelIds?.includes("STARRED")),
      hasAttachments: msgs.some((m) => /multipart\/mixed/i.test(header(m.payload?.headers, "Content-Type"))),
      hasDraft: !!draft,
      draft,
      lastMessageId: last?.id ?? "",
    };
  }

  async getThread(id: string): Promise<Thread> {
    const t = await this.json<GmailThread>(`/threads/${id}?format=full`);
    const messages = (t.messages ?? []).map((m) => this.parseMessage(m));
    messages.sort((a, b) => a.date - b.date);
    // Resolve inline cid: images to data URLs.
    await pMap(messages, 4, async (m) => {
      if (!m.html || !m.html.includes("cid:")) return;
      for (const a of m.attachments.filter((a) => a.contentId && a.inline)) {
        if (!m.html.includes(`cid:${a.contentId}`)) continue;
        try {
          const data = a.attachmentId ? await this.getAttachment(m.id, a.attachmentId) : "";
          if (data) m.html = m.html.split(`cid:${a.contentId}`).join(`data:${a.mimeType};base64,${data}`);
        } catch {
          /* leave broken image */
        }
      }
    });
    const labelIds = new Set<string>();
    messages.forEach((m) => m.labelIds.forEach((l) => labelIds.add(l)));
    return {
      account: this.email,
      id: t.id,
      subject: messages[0]?.subject ?? "",
      labelIds: [...labelIds],
      messages,
    };
  }

  private parseMessage(m: GmailMessage): Message {
    const h = m.payload?.headers;
    const body = m.payload ? parsePayload(m.id, m.payload) : { attachments: [], inlineData: {} as Record<string, { mimeType: string; data: string }> };
    let html = body.html;
    if (html) {
      for (const [cid, d] of Object.entries(body.inlineData)) {
        html = html.split(`cid:${cid}`).join(`data:${d.mimeType};base64,${d.data.replace(/-/g, "+").replace(/_/g, "/")}`);
      }
    }
    return {
      id: m.id,
      threadId: m.threadId,
      labelIds: m.labelIds ?? [],
      snippet: decodeEntities(m.snippet ?? ""),
      date: Number(m.internalDate ?? 0),
      from: parseAddress(decodeHeaderText(header(h, "From"))) ?? { name: "", email: "" },
      to: parseAddressList(decodeHeaderText(header(h, "To"))),
      cc: parseAddressList(decodeHeaderText(header(h, "Cc"))),
      bcc: parseAddressList(decodeHeaderText(header(h, "Bcc"))),
      replyTo: parseAddressList(decodeHeaderText(header(h, "Reply-To"))),
      subject: decodeHeaderText(header(h, "Subject")),
      messageId: header(h, "Message-ID") || header(h, "Message-Id"),
      references: header(h, "References"),
      html,
      text: body.text,
      attachments: body.attachments,
    };
  }

  async modifyThreads(ids: string[], add: string[], remove: string[]): Promise<void> {
    await pMap(ids, 6, (id) => this.post(`/threads/${id}/modify`, { addLabelIds: add, removeLabelIds: remove }));
  }

  async modifyMessages(ids: string[], add: string[], remove: string[]): Promise<void> {
    if (!ids.length) return;
    await this.post(`/messages/batchModify`, { ids, addLabelIds: add, removeLabelIds: remove });
  }

  async trashThreads(ids: string[]): Promise<void> {
    await pMap(ids, 6, (id) => this.post(`/threads/${id}/trash`));
  }

  async untrashThreads(ids: string[]): Promise<void> {
    await pMap(ids, 6, (id) => this.post(`/threads/${id}/untrash`));
  }

  async deleteThreadsForever(ids: string[]): Promise<void> {
    await pMap(ids, 6, (id) => this.json(`/threads/${id}`, { method: "DELETE" }));
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<string> {
    const r = await this.json<{ data: string }>(`/messages/${messageId}/attachments/${attachmentId}`);
    return (r.data ?? "").replace(/-/g, "+").replace(/_/g, "/");
  }

  // ---- identities ---------------------------------------------------------

  async listSendAs(): Promise<SendAs[]> {
    const r = await this.json<{
      sendAs?: {
        sendAsEmail: string;
        displayName?: string;
        signature?: string;
        isDefault?: boolean;
        isPrimary?: boolean;
        verificationStatus?: string;
      }[];
    }>("/settings/sendAs");
    const list = (r.sendAs ?? [])
      .filter((s) => s.isPrimary || s.verificationStatus === "accepted")
      .map((s) => ({
        email: s.sendAsEmail,
        name: s.displayName ?? "",
        isDefault: !!s.isDefault,
        isPrimary: !!s.isPrimary,
        signature: s.signature ?? "",
      }));
    list.forEach((s) => this.myAddresses.add(s.email.toLowerCase()));
    return list;
  }

  // ---- sending & drafts ---------------------------------------------------

  async send(raw: string, threadId?: string): Promise<{ id: string; threadId: string }> {
    return this.upload("/messages/send", threadId ? { threadId } : {}, raw);
  }

  async saveDraft(raw: string, threadId?: string, draftId?: string): Promise<DraftRef> {
    const message = threadId ? { threadId } : {};
    const r = draftId
      ? await this.upload<{ id: string; message: { id: string; threadId: string } }>(`/drafts/${draftId}`, { id: draftId, message }, raw, "PUT")
      : await this.upload<{ id: string; message: { id: string; threadId: string } }>(`/drafts`, { message }, raw);
    this.draftsCache = null;
    return { draftId: r.id, messageId: r.message.id, threadId: r.message.threadId };
  }

  async deleteDraft(draftId: string): Promise<void> {
    this.draftsCache = null;
    await this.json(`/drafts/${draftId}`, { method: "DELETE" });
  }

  async findDraft(messageId: string): Promise<DraftRef | undefined> {
    if (!this.draftsCache || Date.now() - this.draftsCache.at > 30_000) {
      const list: DraftRef[] = [];
      let pageToken: string | undefined;
      do {
        const p = new URLSearchParams({ maxResults: "500" });
        if (pageToken) p.set("pageToken", pageToken);
        const r = await this.json<{ drafts?: { id: string; message: { id: string; threadId: string } }[]; nextPageToken?: string }>(`/drafts?${p}`);
        for (const d of r.drafts ?? []) list.push({ draftId: d.id, messageId: d.message.id, threadId: d.message.threadId });
        pageToken = r.nextPageToken;
      } while (pageToken && list.length < 5000);
      this.draftsCache = { at: Date.now(), list };
    }
    return this.draftsCache.list.find((d) => d.messageId === messageId);
  }

  // ---- contacts -----------------------------------------------------------

  async searchContacts(query: string): Promise<Contact[]> {
    const readMask = "names,emailAddresses";
    const people = "https://people.googleapis.com/v1";
    if (!this.contactsWarm) {
      // The People API asks clients to send an empty "warm-up" query first.
      this.contactsWarm = true;
      await Promise.allSettled([
        this.json(`${people}/people:searchContacts?query=&readMask=${readMask}`),
        this.json(`${people}/otherContacts:search?query=&readMask=emailAddresses,names`),
      ]);
    }
    type P = { person?: { names?: { displayName?: string }[]; emailAddresses?: { value?: string }[] } };
    const q = encodeURIComponent(query);
    const results = await Promise.allSettled([
      this.json<{ results?: P[] }>(`${people}/people:searchContacts?query=${q}&readMask=${readMask}&pageSize=10`),
      this.json<{ results?: P[] }>(`${people}/otherContacts:search?query=${q}&readMask=emailAddresses,names&pageSize=10`),
    ]);
    const out: Contact[] = [];
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const p of r.value?.results ?? []) {
        const name = p.person?.names?.[0]?.displayName ?? "";
        for (const e of p.person?.emailAddresses ?? []) if (e.value) out.push({ name, email: e.value });
      }
    }
    return out;
  }
}
