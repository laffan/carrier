import { base64ToBytes, utf8ToBase64 } from "../platform";
import type { Address, Attachment, Outgoing } from "./types";

// ---- addresses ------------------------------------------------------------

/** Parses an RFC 5322 address list such as `"Doe, Jane" <jane@x.com>, bob@y.org`. */
export function parseAddressList(value: string | undefined | null): Address[] {
  if (!value) return [];
  const out: Address[] = [];
  let buf = "";
  let quoted = false;
  let angle = 0;
  const flush = () => {
    const a = parseAddress(buf);
    if (a) out.push(a);
    buf = "";
  };
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && quoted) {
      buf += ch + (value[++i] ?? "");
      continue;
    }
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "<") angle++;
    else if (!quoted && ch === ">") angle = Math.max(0, angle - 1);
    if ((ch === "," || ch === ";") && !quoted && angle === 0) {
      flush();
      continue;
    }
    buf += ch;
  }
  flush();
  return out;
}

export function parseAddress(raw: string): Address | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(.*)<([^>]+)>\s*$/);
  if (m) {
    let name = m[1].trim();
    if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1).replace(/\\(.)/g, "$1");
    return { name: name.trim(), email: m[2].trim() };
  }
  if (s.includes("@")) return { name: "", email: s.replace(/^mailto:/i, "") };
  return null;
}

export function displayName(a: Address): string {
  if (a.name) return a.name;
  return a.email.split("@")[0];
}

export function formatAddressForDisplay(a: Address): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(s.trim());
}

// ---- header encoding ------------------------------------------------------

const ASCII = /^[\x20-\x7e]*$/;

/** RFC 2047 encoded-word for non-ASCII header text. */
export function encodeHeaderText(s: string): string {
  if (ASCII.test(s)) return s;
  // Split into chunks so each encoded-word stays under 75 chars.
  const words: string[] = [];
  let chunk = "";
  for (const ch of s) {
    const next = chunk + ch;
    if (new TextEncoder().encode(next).length > 42) {
      words.push(chunk);
      chunk = ch;
    } else chunk = next;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${utf8ToBase64(w)}?=`).join("\r\n ");
}

export function formatAddress(a: Address): string {
  if (!a.name) return a.email;
  if (!ASCII.test(a.name)) return `${encodeHeaderText(a.name)} <${a.email}>`;
  if (/[()<>[\]:;@\\,."]/.test(a.name)) return `"${a.name.replace(/(["\\])/g, "\\$1")}" <${a.email}>`;
  return `${a.name} <${a.email}>`;
}

/** Decodes RFC 2047 encoded-words (Gmail usually decodes for us, but not always). */
export function decodeHeaderText(s: string): string {
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(\s+(?==\?))?/g, (_, charset: string, enc: string, text: string) => {
    try {
      let bytes: Uint8Array;
      if (enc.toUpperCase() === "B") bytes = base64ToBytes(text);
      else {
        const t = text.replace(/_/g, " ");
        const arr: number[] = [];
        for (let i = 0; i < t.length; i++) {
          if (t[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) {
            arr.push(parseInt(t.slice(i + 1, i + 3), 16));
            i += 2;
          } else arr.push(t.charCodeAt(i));
        }
        bytes = new Uint8Array(arr);
      }
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return text;
    }
  });
}

function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function boundary(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return "carrier_" + Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function filenameParams(name: string): { ct: string; cd: string } {
  if (ASCII.test(name) && !/["\\]/.test(name)) return { ct: `name="${name}"`, cd: `filename="${name}"` };
  const star = encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return { ct: `name="${encodeHeaderText(name)}"`, cd: `filename*=UTF-8''${star}` };
}

export function newMessageId(fromEmail: string): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  const id = Array.from(a, (b) => b.toString(36)).join("").slice(0, 24);
  const domain = fromEmail.split("@")[1] || "carrier.local";
  return `<${Date.now().toString(36)}.${id}@${domain}>`;
}

export interface BuiltParts {
  html: string;
  text: string;
}

/** Builds an RFC 5322 message with a text/plain + text/html alternative and attachments. */
export function buildMime(msg: Outgoing, parts: BuiltParts, date = new Date()): string {
  const headers: string[] = [];
  headers.push(`From: ${formatAddress(msg.from)}`);
  if (msg.to.length) headers.push(`To: ${msg.to.map(formatAddress).join(", ")}`);
  if (msg.cc.length) headers.push(`Cc: ${msg.cc.map(formatAddress).join(", ")}`);
  if (msg.bcc.length) headers.push(`Bcc: ${msg.bcc.map(formatAddress).join(", ")}`);
  headers.push(`Subject: ${encodeHeaderText(msg.subject)}`);
  headers.push(`Date: ${date.toUTCString().replace("GMT", "+0000")}`);
  headers.push(`Message-ID: ${newMessageId(msg.from.email)}`);
  if (msg.inReplyTo) headers.push(`In-Reply-To: ${msg.inReplyTo}`);
  if (msg.references) headers.push(`References: ${msg.references}`);
  headers.push("MIME-Version: 1.0");
  headers.push("X-Mailer: Carrier");

  const alt = boundary();
  const altBody = [
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(utf8ToBase64(parts.text)),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(utf8ToBase64(parts.html)),
    `--${alt}--`,
  ].join("\r\n");

  if (!msg.attachments.length) {
    headers.push(`Content-Type: multipart/alternative; boundary="${alt}"`);
    return headers.join("\r\n") + "\r\n\r\n" + altBody + "\r\n";
  }

  const mixed = boundary();
  headers.push(`Content-Type: multipart/mixed; boundary="${mixed}"`);
  const sections = [`--${mixed}`, `Content-Type: multipart/alternative; boundary="${alt}"`, "", altBody];
  for (const a of msg.attachments) {
    const p = filenameParams(a.filename);
    sections.push(
      `--${mixed}`,
      `Content-Type: ${a.mimeType || "application/octet-stream"}; ${p.ct}`,
      `Content-Disposition: attachment; ${p.cd}`,
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(a.data.replace(/\s/g, "")),
    );
  }
  sections.push(`--${mixed}--`);
  return headers.join("\r\n") + "\r\n\r\n" + sections.join("\r\n") + "\r\n";
}

// ---- parsing Gmail API payloads ------------------------------------------

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}

export function header(headers: GmailHeader[] | undefined, name: string): string {
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? "";
}

function charsetOf(part: GmailPart): string {
  const ct = header(part.headers, "Content-Type");
  const m = ct.match(/charset="?([^";\s]+)"?/i);
  return m ? m[1] : "utf-8";
}

export function decodeBody(data: string, charset = "utf-8"): string {
  const bytes = base64ToBytes(data);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export interface ParsedBody {
  html?: string;
  text?: string;
  attachments: Attachment[];
  /** Inline parts whose data was included in the payload, by Content-ID. */
  inlineData: Record<string, { mimeType: string; data: string }>;
}

export function parsePayload(messageId: string, root: GmailPart): ParsedBody {
  const result: ParsedBody = { attachments: [], inlineData: {} };
  const htmls: string[] = [];
  const texts: string[] = [];

  const walk = (part: GmailPart, inAlternative: boolean) => {
    const type = (part.mimeType || "").toLowerCase();
    const disposition = header(part.headers, "Content-Disposition").toLowerCase();
    const contentId = header(part.headers, "Content-ID").replace(/^<|>$/g, "");
    if (type.startsWith("multipart/")) {
      const alt = type === "multipart/alternative";
      if (alt) {
        // Prefer the richest alternative, but keep text for quoting.
        const html = part.parts?.find((p) => /html|related|mixed/.test(p.mimeType || ""));
        const text = part.parts?.find((p) => p.mimeType === "text/plain");
        if (html) walk(html, true);
        if (text && text.body?.data) texts.push(decodeBody(text.body.data, charsetOf(text)));
        for (const p of part.parts ?? []) if (p !== html && p !== text && p.filename) walk(p, true);
        return;
      }
      for (const p of part.parts ?? []) walk(p, inAlternative);
      return;
    }
    const isAttachment = !!part.filename || disposition.startsWith("attachment");
    if (!isAttachment && type === "text/html" && part.body?.data) {
      htmls.push(decodeBody(part.body.data, charsetOf(part)));
      return;
    }
    if (!isAttachment && type === "text/plain" && part.body?.data) {
      const t = decodeBody(part.body.data, charsetOf(part));
      if (htmls.length) htmls.push(`<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(t)}</pre>`);
      else texts.push(t);
      return;
    }
    if (part.body?.attachmentId || part.body?.data) {
      const inline = !!contentId && !disposition.startsWith("attachment");
      if (inline && part.body?.data) result.inlineData[contentId] = { mimeType: type, data: part.body.data };
      result.attachments.push({
        messageId,
        attachmentId: part.body?.attachmentId ?? "",
        filename: decodeHeaderText(part.filename || (inline ? "image" : "attachment")),
        mimeType: type || "application/octet-stream",
        size: part.body?.size ?? 0,
        contentId: contentId || undefined,
        inline,
      });
    }
    void inAlternative;
  };
  walk(root, false);
  if (htmls.length) result.html = htmls.join("\n");
  if (texts.length) result.text = texts.join("\n");
  return result;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Converts plain text to simple HTML, linkifying URLs. */
export function textToHtml(text: string): string {
  const escaped = escapeHtml(text);
  const linked = escaped.replace(/\b(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]])/g, '<a href="$1">$1</a>');
  return `<div style="white-space:pre-wrap">${linked}</div>`;
}
