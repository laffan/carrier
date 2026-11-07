/**
 * Markdown → email HTML. Email clients ignore or strip <style> blocks, so
 * every element gets inline styles. The plain-text alternative is the
 * Markdown source itself, which reads naturally as text.
 */
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { escapeHtml } from "./mime";
import type { Outgoing } from "./types";

const marked = new Marked({ gfm: true, breaks: true, async: false });

const FONT = "-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

const STYLES: Record<string, string> = {
  p: "margin:0 0 12px 0",
  h1: "font-size:22px;line-height:1.3;margin:18px 0 10px 0;font-weight:600",
  h2: "font-size:18px;line-height:1.3;margin:16px 0 8px 0;font-weight:600",
  h3: "font-size:16px;line-height:1.3;margin:14px 0 6px 0;font-weight:600",
  h4: "font-size:14px;margin:12px 0 6px 0;font-weight:600",
  h5: "font-size:14px;margin:12px 0 6px 0;font-weight:600",
  h6: "font-size:14px;margin:12px 0 6px 0;font-weight:600;color:#555",
  ul: "margin:0 0 12px 0;padding-left:24px",
  ol: "margin:0 0 12px 0;padding-left:24px",
  li: "margin:2px 0",
  blockquote: "margin:0 0 12px 0;padding:0 0 0 12px;border-left:3px solid #d0d0d0;color:#555",
  pre: `margin:0 0 12px 0;padding:10px 12px;background:#f5f5f5;border-radius:6px;font-family:${MONO};font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word`,
  code: `font-family:${MONO};font-size:90%;background:#f2f2f2;padding:1px 4px;border-radius:3px`,
  table: "border-collapse:collapse;margin:0 0 12px 0",
  th: "border:1px solid #d6d6d6;padding:6px 10px;text-align:left;font-weight:600;background:#fafafa",
  td: "border:1px solid #d6d6d6;padding:6px 10px",
  hr: "border:none;border-top:1px solid #e0e0e0;margin:16px 0",
  img: "max-width:100%;height:auto",
  a: "color:#1a5fb4",
};

/** Renders Markdown to sanitized, inline-styled HTML (no wrapper). */
export function markdownToHtml(md: string): string {
  if (!md.trim()) return "";
  const raw = marked.parse(md) as string;
  const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  const doc = new DOMParser().parseFromString(`<div id="root">${clean}</div>`, "text/html");
  const root = doc.getElementById("root")!;
  root.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    let style = STYLES[tag];
    if (tag === "code" && el.parentElement?.tagName === "PRE") style = "font-family:inherit;font-size:inherit";
    if (tag === "input" && el.getAttribute("type") === "checkbox") style = "margin:0 6px 0 0;vertical-align:middle";
    if (tag === "li" && el.querySelector(":scope > input[type=checkbox]")) style = "margin:2px 0;list-style:none";
    if (style) {
      const existing = el.getAttribute("style");
      el.setAttribute("style", existing ? `${style};${existing}` : style);
    }
  });
  // Trailing paragraph margin adds visible gap before signatures/quotes.
  const last = root.lastElementChild as HTMLElement | null;
  if (last && last.tagName === "P") last.style.marginBottom = "0";
  return root.innerHTML;
}

/** Converts HTML (e.g. a Gmail signature) to sanitized HTML for embedding. */
export function sanitizeFragment(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

export function quoteText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => (l.startsWith(">") ? `>${l}` : `> ${l}`))
    .join("\n");
}

/** Produces the HTML and plain-text bodies for an outgoing message. */
export function renderOutgoing(msg: Outgoing): { html: string; text: string } {
  const bodyHtml = markdownToHtml(msg.markdown);
  const sigHtml = msg.signature.trim() ? markdownToHtml(msg.signature) : "";

  let html = `<div dir="auto" style="font-family:${FONT};font-size:14px;line-height:1.5;color:#1d1d1f">`;
  html += bodyHtml || "<br>";
  if (sigHtml) {
    html += `<br><div class="gmail_signature" data-smartmail="gmail_signature" style="color:#555">${sigHtml}</div>`;
  }
  html += "</div>";

  let text = msg.markdown.trimEnd();
  if (msg.signature.trim()) text += `\n\n-- \n${msg.signature.trim()}`;

  if (msg.quote) {
    const q = msg.quote;
    if (q.kind === "reply") {
      html +=
        `<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">${escapeHtml(q.header)}<br></div>` +
        `<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">` +
        `${q.html}</blockquote></div>`;
      text += `\n\n${q.header}\n\n${quoteText(q.text)}`;
    } else {
      const fields = (q.forwardFields ?? [])
        .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}<br>`)
        .join("");
      html +=
        `<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>${fields}</div><br><br>` +
        `${q.html}</div>`;
      const tf = (q.forwardFields ?? []).map(([k, v]) => `${k}: ${v}`).join("\n");
      text += `\n\n---------- Forwarded message ---------\n${tf}\n\n${q.text}`;
    }
  }
  return { html, text: text + "\n" };
}
