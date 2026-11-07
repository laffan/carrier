export interface Toast {
  id: number;
  message: string;
  action?: string;
  onAction?: () => void;
  error?: boolean;
  /** Called when the toast leaves without the action being taken. */
  onExpire?: () => void;
  progress?: number;
}

interface ShowOptions {
  action?: string;
  onAction?: () => void;
  onExpire?: () => void;
  duration?: number;
}

class Toasts {
  items = $state<Toast[]>([]);
  private seq = 0;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(message: string, opts: ShowOptions = {}): number {
    const id = ++this.seq;
    // One toast at a time, like Gmail's snackbar. Expire the previous one.
    for (const t of this.items) this.expire(t.id);
    this.items = [...this.items, { id, message, action: opts.action, onAction: opts.onAction, onExpire: opts.onExpire }];
    const duration = opts.duration ?? (opts.action ? 6000 : 3000);
    this.timers.set(id, setTimeout(() => this.expire(id), duration));
    return id;
  }

  error(message: string) {
    const id = ++this.seq;
    this.items = [...this.items, { id, message, error: true }];
    this.timers.set(id, setTimeout(() => this.dismiss(id), 5000));
  }

  act(id: number) {
    const t = this.items.find((x) => x.id === id);
    this.dismiss(id);
    t?.onAction?.();
  }

  expire(id: number) {
    const t = this.items.find((x) => x.id === id);
    this.dismiss(id);
    t?.onExpire?.();
  }

  dismiss(id: number) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.items = this.items.filter((x) => x.id !== id);
  }
}

export const toasts = new Toasts();
