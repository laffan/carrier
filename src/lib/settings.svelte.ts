import { kvGet, kvSet } from "./platform";

export type SwipeAction = "archive" | "trash" | "read" | "star" | "none";

export interface Settings {
  swipeRight: SwipeAction;
  swipeLeft: SwipeAction;
  /** Seconds to hold a message before sending; 0 disables undo. */
  undoSendSeconds: number;
  /** "primary" shows only the Primary category in Inbox, like Gmail's default inbox. */
  inboxType: "primary" | "everything";
  loadRemoteImages: boolean;
  theme: "system" | "light" | "dark";
  defaultReply: "reply" | "replyAll";
  /** Markdown signatures keyed by send-as address. */
  signatures: Record<string, string>;
  /** Colour chosen for each account (keyed by email); defaults by position. */
  accountColors: Record<string, string>;
  /** Whether a signature was imported/edited at least once (otherwise Gmail's is used). */
  signaturesCustomized: Record<string, boolean>;
}

export const DEFAULTS: Settings = {
  swipeRight: "archive",
  swipeLeft: "trash",
  undoSendSeconds: 5,
  inboxType: "primary",
  loadRemoteImages: true,
  theme: "system",
  defaultReply: "reply",
  signatures: {},
  accountColors: {},
  signaturesCustomized: {},
};

class SettingsStore {
  value = $state<Settings>({ ...DEFAULTS });
  loaded = $state(false);
  /** Whether the system currently prefers dark mode. */
  systemDark = $state(false);

  /** Effective appearance, combining the setting with the system preference. */
  get dark(): boolean {
    const t = this.value.theme;
    return t === "dark" || (t === "system" && this.systemDark);
  }

  constructor() {
    if (typeof window !== "undefined" && window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      this.systemDark = mq.matches;
      mq.addEventListener?.("change", (e) => (this.systemDark = e.matches));
    }
  }

  async load() {
    const saved = await kvGet<Partial<Settings>>("settings");
    this.value = { ...DEFAULTS, ...(saved ?? {}) };
    this.loaded = true;
    this.applyTheme();
  }

  async update(patch: Partial<Settings>) {
    this.value = { ...this.value, ...patch };
    this.applyTheme();
    await kvSet("settings", $state.snapshot(this.value));
  }

  applyTheme() {
    if (typeof document === "undefined") return;
    const t = this.value.theme;
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  }
}

export const settings = new SettingsStore();

export const SWIPE_LABELS: Record<SwipeAction, string> = {
  archive: "Archive",
  trash: "Delete",
  read: "Mark read / unread",
  star: "Star",
  none: "None",
};

/** Account colours: distinct, readable in light and dark mode. */
export const ACCOUNT_COLORS = ["#4a7dff", "#e58a3c", "#33a873", "#a865d8", "#e0566f", "#2aa6b8", "#c8a228", "#7d8b9b"];
