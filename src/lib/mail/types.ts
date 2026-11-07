export interface Address {
  name: string;
  email: string;
}

export interface Label {
  id: string;
  name: string;
  type: "system" | "user";
  unread?: number;
  total?: number;
}

export interface ThreadSummary {
  /** Account email the thread belongs to. */
  account: string;
  id: string;
  historyId: string;
  subject: string;
  snippet: string;
  /** Display participants, oldest first, deduplicated. */
  participants: { name: string; email: string; unread: boolean; isMe: boolean }[];
  /** Short names of the latest message's recipients (used in Sent). */
  recipients: string[];
  messageCount: number;
  date: number;
  labelIds: string[];
  unread: boolean;
  starred: boolean;
  hasAttachments: boolean;
  hasDraft: boolean;
  /** The latest unsent draft in the conversation, if any. */
  draft?: { messageId: string; to: string[]; subject: string; snippet: string; date: number };
  lastMessageId: string;
}

export interface Attachment {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
  inline: boolean;
}

export interface Message {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  date: number;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  subject: string;
  messageId: string;
  references: string;
  html?: string;
  text?: string;
  attachments: Attachment[];
}

export interface Thread {
  account: string;
  id: string;
  subject: string;
  labelIds: string[];
  messages: Message[];
}

export interface SendAs {
  email: string;
  name: string;
  isDefault: boolean;
  isPrimary: boolean;
  /** Signature HTML as configured in Gmail. */
  signature: string;
}

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  /** Standard base64 (not url-safe). */
  data: string;
  size: number;
}

export interface Outgoing {
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  /** Markdown source written by the user. */
  markdown: string;
  /** Markdown signature (may be empty). */
  signature: string;
  quote?: Quote;
  attachments: OutgoingAttachment[];
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

export interface Quote {
  kind: "reply" | "forward";
  header: string;
  html: string;
  text: string;
  /** Rendered forward header block (forward only). */
  forwardFields?: [string, string][];
}

export interface ListQuery {
  labelIds?: string[];
  q?: string;
  pageToken?: string;
  maxResults?: number;
}

export interface ListResult {
  threads: ThreadSummary[];
  nextPageToken?: string;
}

export interface DraftRef {
  draftId: string;
  messageId: string;
  threadId: string;
}

export interface Contact {
  name: string;
  email: string;
}

/** Everything the UI needs from a mailbox. Implemented by Gmail and the demo backend. */
export interface MailBackend {
  readonly email: string;
  listLabels(withCounts: boolean): Promise<Label[]>;
  listThreads(query: ListQuery, cache?: Map<string, ThreadSummary>): Promise<ListResult>;
  getThread(id: string): Promise<Thread>;
  modifyThreads(ids: string[], add: string[], remove: string[]): Promise<void>;
  modifyMessages(ids: string[], add: string[], remove: string[]): Promise<void>;
  trashThreads(ids: string[]): Promise<void>;
  untrashThreads(ids: string[]): Promise<void>;
  deleteThreadsForever(ids: string[]): Promise<void>;
  getAttachment(messageId: string, attachmentId: string): Promise<string>;
  listSendAs(): Promise<SendAs[]>;
  send(raw: string, threadId?: string): Promise<{ id: string; threadId: string }>;
  saveDraft(raw: string, threadId?: string, draftId?: string): Promise<DraftRef>;
  deleteDraft(draftId: string): Promise<void>;
  findDraft(messageId: string): Promise<DraftRef | undefined>;
  searchContacts(query: string): Promise<Contact[]>;
}
