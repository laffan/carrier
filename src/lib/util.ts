export async function pMap<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const entityEl = typeof document !== "undefined" ? document.createElement("textarea") : null;

export function decodeEntities(s: string): string {
  if (!s || !s.includes("&") || !entityEl) return s;
  entityEl.innerHTML = s;
  return entityEl.value;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const DAY = 86_400_000;

/** Gmail-style compact date for lists: time today, "Nov 3" this year, else "11/3/24". */
export function listDate(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  if (d.toDateString() === n.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (d.getFullYear() === n.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { year: "2-digit", month: "numeric", day: "numeric" });
}

/** Longer date for message headers. */
export function fullDate(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const age = now - ts;
  if (new Date(now).toDateString() === d.toDateString()) return time;
  if (age < 6 * DAY) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  }) + `, ${time}`;
}

/** "On Thu, Nov 6, 2025 at 3:04 PM Jane Doe <jane@x.com> wrote:" */
export function replyHeader(ts: number, from: { name: string; email: string }): string {
  const d = new Date(ts);
  const date = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const who = from.name ? `${from.name} <${from.email}>` : `<${from.email}>`;
  return `On ${date} at ${time} ${who} wrote:`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => clearTimeout(t);
  d.flush = (...a: A) => {
    clearTimeout(t);
    fn(...a);
  };
  return d;
}
