/**
 * In-memory `KeyValueStore`, used by tests and by the browser demo when no
 * persistent store is available.
 */

import type { KeyValueStore } from "../types.js";

function clone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    // Not every value is structured-cloneable (functions, DOM nodes, ...);
    // such values are stored by reference, mirroring normal JS semantics.
    return value;
  }
}

/** Map-backed {@link KeyValueStore} whose `flush()` resolves immediately. */
export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, unknown>();

  /** @param initial - Optional record copied into the store on construction. */
  constructor(initial?: Record<string, unknown>) {
    if (!initial) return;
    for (const [key, value] of Object.entries(initial)) this.data.set(key, clone(value));
  }

  get<T>(key: string, fallback: T): T {
    if (!this.data.has(key)) return fallback;
    // Copy on the way out too, so callers cannot mutate persisted state.
    return clone(this.data.get(key)) as T;
  }

  set<T>(key: string, value: T): void {
    // Clone on the way in so callers cannot mutate persisted state by accident.
    this.data.set(key, clone(value));
  }

  delete(key: string): void {
    this.data.delete(key);
  }

  /** Values are already "persisted" in memory. */
  flush(): Promise<void> {
    return Promise.resolve();
  }
}
