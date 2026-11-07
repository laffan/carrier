import { describe, expect, it } from "vitest";
import { markdownToHtml, renderOutgoing } from "../markdown";
import {
  buildMime,
  decodeBody,
  decodeHeaderText,
  encodeHeaderText,
  formatAddress,
  parseAddressList,
  parsePayload,
} from "../mime";
import { sha256js } from "../sha256";
import type { Outgoing } from "../types";
import { base64ToBytes, utf8ToBase64 } from "../../platform";

const b64url = (s: string) => utf8ToBase64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("addresses", () => {
  it("parses lists with quoted commas and bare addresses", () => {
    expect(parseAddressList('"Doe, Jane" <jane@x.com>, bob@y.org; Ann <ann@z.io>')).toEqual([
      { name: "Doe, Jane", email: "jane@x.com" },
      { name: "", email: "bob@y.org" },
      { name: "Ann", email: "ann@z.io" },
    ]);
  });

  it("formats names that need quoting or encoding", () => {
    expect(formatAddress({ name: "Doe, Jane", email: "j@x.com" })).toBe('"Doe, Jane" <j@x.com>');
    expect(formatAddress({ name: "Jane", email: "j@x.com" })).toBe("Jane <j@x.com>");
    expect(formatAddress({ name: "Inês", email: "i@x.pt" })).toMatch(/^=\?UTF-8\?B\?.+\?= <i@x\.pt>$/);
  });

  it("round-trips encoded header text", () => {
    const s = "Réunion — 会議 📅 with a fairly long subject line that needs folding";
    const enc = encodeHeaderText(s);
    expect(enc).not.toBe(s);
    expect(decodeHeaderText(enc.replace(/\r\n /g, " "))).toBe(s);
    expect(encodeHeaderText("Plain ASCII")).toBe("Plain ASCII");
  });

  it("decodes Q-encoded words", () => {
    expect(decodeHeaderText("=?ISO-8859-1?Q?Caf=E9_au_lait?=")).toBe("Café au lait");
  });
});

describe("markdown", () => {
  it("renders inline-styled HTML", () => {
    const html = markdownToHtml("Hello **world**\n\n- a\n- b\n\n`x`");
    expect(html).toContain("<strong>world</strong>");
    expect(html).toMatch(/<ul style="[^"]*padding-left/);
    expect(html).toMatch(/<code style="[^"]*font-family/);
  });

  it("keeps single newlines as line breaks", () => {
    expect(markdownToHtml("line one\nline two")).toContain("<br>");
  });

  it("strips scripts and event handlers", () => {
    const html = markdownToHtml('<script>alert(1)</script><img src=x onerror="alert(1)">hi');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });

  it("builds bodies with signature and quoted reply", () => {
    const out: Outgoing = {
      from: { name: "Me", email: "me@x.com" },
      to: [{ name: "", email: "you@y.com" }],
      cc: [],
      bcc: [],
      subject: "Re: Hi",
      markdown: "Thanks!",
      signature: "**Me**",
      quote: { kind: "reply", header: "On Mon, You wrote:", html: "<p>Hi</p>", text: "Hi\nthere" },
      attachments: [],
    };
    const { html, text } = renderOutgoing(out);
    expect(text).toBe("Thanks!\n\n-- \n**Me**\n\nOn Mon, You wrote:\n\n> Hi\n> there\n");
    expect(html).toContain('class="gmail_signature"');
    expect(html).toContain('<blockquote class="gmail_quote"');
    expect(html.indexOf("gmail_signature")).toBeLessThan(html.indexOf("gmail_quote"));
  });
});

describe("MIME", () => {
  const base: Outgoing = {
    from: { name: "Me", email: "me@x.com" },
    to: [{ name: "You", email: "you@y.com" }],
    cc: [{ name: "", email: "c@y.com" }],
    bcc: [],
    subject: "Grüße",
    markdown: "# Hi",
    signature: "",
    attachments: [],
    inReplyTo: "<a@b>",
    references: "<z@b> <a@b>",
  };

  it("builds multipart/alternative with threading headers", () => {
    const raw = buildMime(base, { html: "<h1>Hi</h1>", text: "# Hi\n" });
    expect(raw).toMatch(/^From: Me <me@x\.com>\r\n/);
    expect(raw).toContain("To: You <you@y.com>\r\n");
    expect(raw).toContain("Cc: c@y.com\r\n");
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw).toContain("In-Reply-To: <a@b>\r\n");
    expect(raw).toContain("References: <z@b> <a@b>\r\n");
    expect(raw).toContain("Content-Type: multipart/alternative;");
    const html = raw.match(/text\/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/)![1];
    expect(new TextDecoder().decode(base64ToBytes(html.replace(/\r\n/g, "")))).toBe("<h1>Hi</h1>");
    expect(raw.split("\r\n").every((l) => l.length <= 998)).toBe(true);
  });

  it("adds attachments as multipart/mixed with RFC 2231 filenames", () => {
    const raw = buildMime(
      { ...base, attachments: [{ filename: "résumé.pdf", mimeType: "application/pdf", data: utf8ToBase64("x".repeat(200)), size: 200 }] },
      { html: "<p>x</p>", text: "x" },
    );
    expect(raw).toContain("Content-Type: multipart/mixed;");
    expect(raw).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf");
    expect(raw.split("\r\n").every((l) => l.length <= 998)).toBe(true);
  });

  it("parses Gmail payloads", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=UTF-8" }], body: { data: b64url("plain ✓") } },
            {
              mimeType: "multipart/related",
              parts: [
                { mimeType: "text/html", headers: [{ name: "Content-Type", value: 'text/html; charset="utf-8"' }], body: { data: b64url('<p>hi <img src="cid:img1"></p>') } },
                { mimeType: "image/png", filename: "a.png", headers: [{ name: "Content-ID", value: "<img1>" }], body: { attachmentId: "A1", size: 10 } },
              ],
            },
          ],
        },
        { mimeType: "application/pdf", filename: "doc.pdf", headers: [{ name: "Content-Disposition", value: "attachment" }], body: { attachmentId: "A2", size: 2048 } },
      ],
    };
    const r = parsePayload("m1", payload);
    expect(r.html).toContain("cid:img1");
    expect(r.text).toBe("plain ✓");
    expect(r.attachments.map((a) => [a.filename, a.inline, a.contentId])).toEqual([
      ["a.png", true, "img1"],
      ["doc.pdf", false, undefined],
    ]);
  });

  it("decodes non-UTF-8 bodies", () => {
    const latin1 = btoa(String.fromCharCode(0x63, 0x61, 0x66, 0xe9));
    expect(decodeBody(latin1, "iso-8859-1")).toBe("café");
  });
});

describe("sha256", () => {
  it("matches the standard test vector", () => {
    const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    expect(hex(sha256js(new TextEncoder().encode("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hex(sha256js(new Uint8Array(0)))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
