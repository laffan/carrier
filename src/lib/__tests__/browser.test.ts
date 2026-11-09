import { describe, expect, it } from "vitest";
import { applyTemplate, BROWSERS, browserTarget, validTemplate } from "../browser";

const template = (id: string) => BROWSERS.find((b) => b.id === id)!.template;
const link = "https://example.com/a b?x=1&y=2#top";

describe("browser templates", () => {
  it("rewrites into each preset's scheme", () => {
    expect(applyTemplate(template("chrome"), "https://example.com/p?q=1")).toBe("googlechromes://example.com/p?q=1");
    expect(applyTemplate(template("chrome"), "http://example.com/")).toBe("googlechrome://example.com/");
    expect(applyTemplate(template("edge"), "https://example.com/")).toBe("microsoft-edge-https://example.com/");
    expect(applyTemplate(template("safari"), "http://example.com/")).toBe("x-safari-http://example.com/");
    expect(applyTemplate(template("firefox"), link)).toBe("firefox://open-url?url=" + encodeURIComponent(link));
    expect(applyTemplate(template("brave"), link)).toBe("brave://open-url?url=" + encodeURIComponent(link));
    expect(applyTemplate(template("orion"), link)).toBe("orion://open-url?url=" + encodeURIComponent(link));
    expect(applyTemplate(template("duckduckgo"), "https://example.com/")).toBe("ddgQuickLink://https://example.com/");
    expect(applyTemplate(template("snorkle"), "https://example.com/page")).toBe("snorkle-https://example.com/page");
    expect(applyTemplate(template("snorkle"), "http://example.com/page")).toBe("snorkle-http://example.com/page");
  });

  it("treats a template without placeholders as a prefix", () => {
    expect(applyTemplate("mybrowser://open?", "https://example.com/")).toBe("mybrowser://open?https://example.com/");
  });

  it("leaves non-web links and empty templates alone", () => {
    expect(applyTemplate("firefox://open-url?url={url}", "tel:+15551234")).toBe("tel:+15551234");
    expect(applyTemplate("", "https://example.com/")).toBe("https://example.com/");
  });

  it("validates custom templates", () => {
    expect(validTemplate("firefox://open-url?url={url}")).toBe(true);
    expect(validTemplate("{url}")).toBe(false);
  });
});

describe("browserTarget", () => {
  const url = "https://example.com/";
  it("rewrites on iPad and names the app on a Mac", () => {
    expect(browserTarget(url, { browser: "chrome", browserTemplate: "" }, false)).toEqual({ url: "googlechromes://example.com/" });
    expect(browserTarget(url, { browser: "chrome", browserTemplate: "" }, true)).toEqual({ url, openWith: "Google Chrome" });
  });

  it("uses the scheme on a Mac when a browser has no app name", () => {
    expect(browserTarget(url, { browser: "snorkle", browserTemplate: "" }, true)).toEqual({ url: "snorkle-https://example.com/" });
  });

  it("uses the system default when nothing applies", () => {
    expect(browserTarget(url, { browser: "system", browserTemplate: "" }, false)).toEqual({ url });
    expect(browserTarget(url, { browser: "custom", browserTemplate: "" }, false)).toEqual({ url });
    expect(browserTarget(url, { browser: "custom", browserTemplate: "{url}" }, false)).toEqual({ url });
    expect(browserTarget("tel:123", { browser: "chrome", browserTemplate: "" }, false)).toEqual({ url: "tel:123" });
  });

  it("applies a custom template on both platforms", () => {
    const choice = { browser: "custom", browserTemplate: "x://go?u={url}" };
    expect(browserTarget(url, choice, true)).toEqual({ url: "x://go?u=" + encodeURIComponent(url) });
  });
});
