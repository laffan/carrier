/**
 * "Default browser": opens web links from messages in a chosen browser by
 * rewriting them into that browser's URL scheme (iPad), or by naming the app
 * (macOS, where most browsers don't register these schemes).
 *
 * A template turns an http(s) link into the browser's URL. Placeholders:
 *   {url}     the whole link, percent-encoded (for ?url= parameters)
 *   {raw}     the whole link as is
 *   {scheme}  "http" or "https"
 *   {s}       "s" for https links, empty for http
 *   {rest}    the link without "http://" or "https://"
 * A template without placeholders is treated as a prefix to the whole link.
 */

export interface BrowserPreset {
  id: string;
  name: string;
  /** URL template on iPad (empty: no rewrite). */
  template: string;
  /** Application name on macOS. */
  macApp?: string;
}

export const BROWSERS: BrowserPreset[] = [
  { id: "system", name: "System default", template: "" },
  // x-safari-https:// opens Safari even when another browser is the default (iPadOS 17+).
  { id: "safari", name: "Safari", template: "x-safari-{scheme}://{rest}", macApp: "Safari" },
  { id: "chrome", name: "Chrome", template: "googlechrome{s}://{rest}", macApp: "Google Chrome" },
  { id: "firefox", name: "Firefox", template: "firefox://open-url?url={url}", macApp: "Firefox" },
  { id: "edge", name: "Microsoft Edge", template: "microsoft-edge-{scheme}://{rest}", macApp: "Microsoft Edge" },
  { id: "brave", name: "Brave", template: "brave://open-url?url={url}", macApp: "Brave Browser" },
  { id: "duckduckgo", name: "DuckDuckGo", template: "ddgQuickLink://{raw}", macApp: "DuckDuckGo" },
  { id: "orion", name: "Orion", template: "orion://open-url?url={url}", macApp: "Orion" },
];

export const CUSTOM_BROWSER = "custom";

const PLACEHOLDER = /\{(url|raw|scheme|s|rest)\}/g;

/** Applies a template to an http(s) link. Other links are returned unchanged. */
export function applyTemplate(template: string, link: string): string {
  const m = /^(https?):\/\/(.*)$/is.exec(link.trim());
  const t = template.trim();
  if (!m || !t) return link;
  const scheme = m[1].toLowerCase();
  const values: Record<string, string> = {
    url: encodeURIComponent(link.trim()),
    raw: link.trim(),
    scheme,
    s: scheme === "https" ? "s" : "",
    rest: m[2],
  };
  if (!/\{(url|raw|scheme|s|rest)\}/.test(t)) return t + values.raw;
  return t.replace(PLACEHOLDER, (_, k: string) => values[k]);
}

/** Whether a custom template produces a usable URL (has a scheme). */
export function validTemplate(template: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(applyTemplate(template, "https://example.com/"));
}

/** How to open a web link: the URL to open and, on macOS, the app to open it with. */
export function browserTarget(
  link: string,
  choice: { browser: string; browserTemplate: string },
  mac: boolean,
): { url: string; openWith?: string } {
  if (!/^https?:/i.test(link.trim())) return { url: link };
  if (choice.browser === CUSTOM_BROWSER) {
    return { url: validTemplate(choice.browserTemplate) ? applyTemplate(choice.browserTemplate, link) : link };
  }
  const preset = BROWSERS.find((b) => b.id === choice.browser);
  if (!preset || preset.id === "system") return { url: link };
  if (mac) return { url: link, openWith: preset.macApp };
  return { url: applyTemplate(preset.template, link) };
}
