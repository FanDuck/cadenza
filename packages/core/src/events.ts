/**
 * A tiny, dependency-free typed event bus.
 *
 * Every part of the core (player, library, plugin host) communicates through
 * this class instead of importing each other, which keeps the modules testable
 * and lets a host share one bus between all of them.
 */

/** Wrapper around a listener so `off()` can find listeners registered via `once()`. */
interface ListenerEntry {
  /** The function that is actually invoked. */
  readonly fn: (payload: unknown) => void;
  /** The listener the caller passed in; used by {@link EventBus.off}. */
  readonly original: (payload: unknown) => void;
  /** When true the entry is removed right before it is invoked. */
  readonly once: boolean;
}

/**
 * Typed publish/subscribe hub.
 *
 * @typeParam E - Event map, e.g. `CoreEvents`. It is constrained to `object`
 * rather than `Record<string, unknown>` so that plain interfaces (which have no
 * index signature) such as `CoreEvents` can be used as the map.
 */
export class EventBus<E extends object> {
  private readonly listeners = new Map<keyof E, Set<ListenerEntry>>();
  private readonly onError?: (error: unknown, event: keyof E) => void;

  /**
   * @param onError - Called when a listener throws. When omitted, listener
   * errors are swallowed: an exception must never escape {@link emit}.
   */
  constructor(onError?: (error: unknown, event: keyof E) => void) {
    this.onError = onError;
  }

  /** Subscribe to an event. Returns a function that unsubscribes. */
  on<K extends keyof E>(event: K, listener: (payload: E[K]) => void): () => void {
    return this.add(event, listener as unknown as (payload: unknown) => void, false);
  }

  /** Subscribe to the next emission only. Returns a function that unsubscribes. */
  once<K extends keyof E>(event: K, listener: (payload: E[K]) => void): () => void {
    return this.add(event, listener as unknown as (payload: unknown) => void, true);
  }

  /** Remove a listener registered with {@link on} or {@link once}. */
  off<K extends keyof E>(event: K, listener: (payload: E[K]) => void): void {
    const entries = this.listeners.get(event);
    if (!entries) return;
    const target = listener as unknown as (payload: unknown) => void;
    for (const entry of entries) {
      if (entry.original === target || entry.fn === target) entries.delete(entry);
    }
    if (entries.size === 0) this.listeners.delete(event);
  }

  /**
   * Emit `payload` to every listener of `event`.
   *
   * The listener set is copied first, so listeners may subscribe or unsubscribe
   * (even themselves) while the event is being dispatched. Exceptions thrown by
   * listeners are caught and reported through `onError`.
   */
  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const entries = this.listeners.get(event);
    if (!entries || entries.size === 0) return;
    const snapshot = [...entries];
    for (const entry of snapshot) {
      if (entry.once) {
        entries.delete(entry);
        if (entries.size === 0) this.listeners.delete(event);
      }
      try {
        entry.fn(payload);
      } catch (error) {
        this.reportError(error, event);
      }
    }
  }

  /** Remove every listener for every event. */
  clear(): void {
    this.listeners.clear();
  }

  /** Number of listeners currently registered for `event`. */
  listenerCount<K extends keyof E>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  private add(event: keyof E, fn: (payload: unknown) => void, once: boolean): () => void {
    let entries = this.listeners.get(event);
    if (!entries) {
      entries = new Set<ListenerEntry>();
      this.listeners.set(event, entries);
    }
    const entry: ListenerEntry = { fn, original: fn, once };
    entries.add(entry);
    return () => {
      const current = this.listeners.get(event);
      if (!current) return;
      current.delete(entry);
      if (current.size === 0) this.listeners.delete(event);
    };
  }

  private reportError(error: unknown, event: keyof E): void {
    if (!this.onError) return;
    try {
      this.onError(error, event);
    } catch {
      // An error reporter is not allowed to break event dispatch either.
    }
  }
}
