import { app } from "./app.svelte";
import type { Address, Contact, Thread } from "./mail/types";
import { kvGet, kvSet } from "./platform";

/**
 * Recipient suggestions: addresses you've written to or read from (stored
 * locally), merged with Google Contacts / "Other contacts" search.
 */
class Contacts {
  private local: (Contact & { score: number })[] = [];
  private loaded = false;

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    this.local = (await kvGet<(Contact & { score: number })[]>("contacts")) ?? [];
  }

  private persist() {
    kvSet("contacts", this.local.slice(0, 2000));
  }

  private add(a: Address, weight: number) {
    if (!a.email || /no-?reply|notifications?@|mailer-daemon/i.test(a.email)) return;
    const email = a.email.toLowerCase();
    const found = this.local.find((c) => c.email.toLowerCase() === email);
    if (found) {
      found.score += weight;
      if (!found.name && a.name) found.name = a.name;
    } else this.local.push({ name: a.name, email: a.email, score: weight });
  }

  async remember(list: Address[]) {
    await this.load();
    list.forEach((a) => this.add(a, 5));
    this.local.sort((a, b) => b.score - a.score);
    this.persist();
  }

  async harvest(thread: Thread) {
    await this.load();
    for (const m of thread.messages) [m.from, ...m.to, ...m.cc].forEach((a) => this.add(a, 1));
    this.local.sort((a, b) => b.score - a.score);
    this.persist();
  }

  async search(q: string, account: string): Promise<Contact[]> {
    await this.load();
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const local = this.local.filter((c) => c.email.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle)).slice(0, 8);
    let remote: Contact[] = [];
    try {
      remote = await app.backend(account).searchContacts(q);
    } catch {
      /* People API may be disabled; local suggestions still work */
    }
    const out: Contact[] = [];
    for (const c of [...local, ...remote]) {
      if (!out.some((o) => o.email.toLowerCase() === c.email.toLowerCase())) out.push({ name: c.name, email: c.email });
    }
    return out.slice(0, 8);
  }
}

export const contacts = new Contacts();
