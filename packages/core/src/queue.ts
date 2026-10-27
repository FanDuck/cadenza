/**
 * The playback queue: an ordered list of tracks plus a cursor, a shuffle order
 * and a repeat mode. It is deliberately free of any player or sink dependency.
 */

import type { QueueState, RepeatMode, Track } from "./types.js";

export interface QueueOptions {
  /** Source of randomness used to build the shuffle order. Defaults to `Math.random`. */
  random?: () => number;
  /** Called after every mutation; the player uses it to emit `queue:change`. */
  onChange?: (state: QueueState) => void;
}

/**
 * Playback queue.
 *
 * The queue never clones the whole item array for reads. Mutating methods are
 * O(n) at worst (list splices and bookkeeping), which is fine because they run
 * on user gestures, never on playback ticks.
 */
export class Queue {
  items: Track[] = [];
  /** Index of the current track in {@link items}, or `-1` when the queue is empty. */
  index = -1;
  shuffle = false;
  repeat: RepeatMode = "off";

  private readonly random: () => number;
  private readonly onChange?: (state: QueueState) => void;
  /** Item indices in shuffled play order. Empty while shuffle is off. */
  private order: number[] = [];
  /** Position of the current track inside {@link order}, or `-1`. */
  private orderPos = -1;

  constructor(options?: QueueOptions) {
    this.random = options?.random ?? Math.random;
    this.onChange = options?.onChange;
  }

  /** Current track, or `null` when nothing is selected. */
  get current(): Track | null {
    return this.items[this.index] ?? null;
  }

  /** Number of tracks in the queue. */
  get length(): number {
    return this.items.length;
  }

  /** Replace the queue contents. `startIndex` is clamped to a valid position. */
  setTracks(tracks: Track[], startIndex = 0): void {
    this.items = tracks.slice();
    this.index = this.items.length === 0 ? -1 : clampIndex(startIndex, this.items.length);
    this.rebuildOrder();
    this.changed();
  }

  /**
   * Append tracks. When the queue was empty the first appended track becomes
   * current.
   */
  add(tracks: Track[]): void {
    if (tracks.length === 0) return;
    const oldLength = this.items.length;
    for (const track of tracks) this.items.push(track);
    if (this.index < 0) this.index = 0;
    if (this.shuffle) {
      const offsetBase = oldLength;
      for (const position of this.shuffledIndices(tracks.length)) this.order.push(position + offsetBase);
      this.syncOrderPos();
    }
    this.changed();
  }

  /** Insert tracks at `at` (0..length). New tracks are played next while shuffling. */
  insertAt(tracks: Track[], at: number): void {
    if (tracks.length === 0) return;
    const position = clampInsert(at, this.items.length);
    this.items.splice(position, 0, ...tracks);
    if (this.index < 0) {
      this.index = 0;
    } else if (position <= this.index) {
      this.index += tracks.length;
    }
    if (this.shuffle) {
      this.order = this.order.map((itemIndex) => (itemIndex >= position ? itemIndex + tracks.length : itemIndex));
      const insertPosition = this.orderPos >= 0 ? this.orderPos + 1 : 0;
      const newIndices = this.shuffledIndices(tracks.length).map((offset) => offset + position);
      this.order.splice(insertPosition, 0, ...newIndices);
      this.syncOrderPos();
    }
    this.changed();
  }

  /**
   * Remove the track at `index` and return it (or `null` for an invalid index).
   *
   * The cursor keeps pointing at the same track when it is before the removed
   * one. Removing the current track moves the cursor to the next track (or to
   * the new last track when the removed one was last).
   */
  removeAt(index: number): Track | null {
    if (!isIndexInRange(index, this.items.length)) return null;
    const removed = this.items.splice(index, 1)[0] ?? null;
    if (this.items.length === 0) {
      this.index = -1;
    } else if (index < this.index) {
      this.index -= 1;
    } else if (index === this.index) {
      this.index = Math.min(this.index, this.items.length - 1);
    }
    if (this.shuffle) {
      const orderIndex = this.order.indexOf(index);
      if (orderIndex >= 0) this.order.splice(orderIndex, 1);
      for (let i = 0; i < this.order.length; i++) {
        const value = this.order[i];
        if (value !== undefined && value > index) this.order[i] = value - 1;
      }
      this.syncOrderPos();
    }
    this.changed();
    return removed;
  }

  /** Move the track at `from` so it ends up at `to`, keeping the current track current. */
  move(from: number, to: number): void {
    if (!isIndexInRange(from, this.items.length)) return;
    if (from === to) return;
    const currentTrack = this.items[this.index];
    const removed = this.items.splice(from, 1)[0];
    if (!removed) return;
    const destination = clampInsert(to, this.items.length);
    this.items.splice(destination, 0, removed);
    if (currentTrack) this.index = this.items.indexOf(currentTrack);
    if (this.shuffle) {
      this.order = this.order.map((itemIndex) => mapMovedIndex(itemIndex, from, destination));
      this.syncOrderPos();
    }
    this.changed();
  }

  /** Remove every track and reset the cursor. */
  clear(): void {
    this.items = [];
    this.index = -1;
    this.order = [];
    this.orderPos = -1;
    this.changed();
  }

  /** Replace the track at `index`; the cursor stays where it is. */
  replaceAt(index: number, track: Track): void {
    if (!isIndexInRange(index, this.items.length)) return;
    this.items[index] = track;
    this.changed();
  }

  /** Move the cursor to `index` (clamped). Used by the player after selecting a track. */
  setIndex(index: number): void {
    const next = this.items.length === 0 ? -1 : clampIndex(index, this.items.length);
    if (next === this.index) return;
    this.index = next;
    this.syncOrderPos();
    this.changed();
  }

  /**
   * Index the queue would move to for a user action (`next()` / `previous()`),
   * honouring shuffle and repeat, without moving the cursor.
   *
   * `null` means the user action cannot move anywhere (end of queue with
   * `repeat = "off"`).
   */
  nextIndex(direction: 1 | -1): number | null {
    if (this.items.length === 0) return null;
    if (this.index < 0) return 0;
    return this.step(direction, false);
  }

  /**
   * Move the cursor one track forward. Returns the new index, or `null` when
   * playback should stop.
   *
   * `auto = true` is used by the player when a track ends: with
   * `repeat = "one"` it stays on the same track, while an explicit user
   * `next()` (auto = false) still advances.
   */
  advanceIndex(auto: boolean): number | null {
    if (this.items.length === 0) return null;
    if (this.index < 0) {
      this.index = 0;
      this.syncOrderPos();
      this.changed();
      return 0;
    }
    if (auto && this.repeat === "one") return this.index;
    const next = this.step(1, auto);
    if (next === null) return null;
    this.index = next;
    this.syncOrderPos();
    this.changed();
    return next;
  }

  setShuffle(shuffle: boolean): void {
    if (this.shuffle === shuffle) return;
    this.shuffle = shuffle;
    if (shuffle) {
      this.rebuildOrder();
    } else {
      this.order = [];
      this.orderPos = -1;
    }
    this.changed();
  }

  setRepeat(mode: RepeatMode): void {
    if (this.repeat === mode) return;
    this.repeat = mode;
    this.changed();
  }

  /** Plain snapshot of the queue state (safe to hand to consumers). */
  toJSON(): QueueState {
    return {
      items: this.items.slice(),
      index: this.index,
      shuffle: this.shuffle,
      repeat: this.repeat,
    };
  }

  /* ------------------------------------------------------------ internals */

  private changed(): void {
    this.onChange?.(this.toJSON());
  }

  /** One step in `direction`, honouring the shuffle order and repeat mode. */
  private step(direction: 1 | -1, auto: boolean): number | null {
    const count = this.items.length;
    if (count === 0) return null;
    // Repeat "one" only affects automatic advance; a user next/previous still
    // moves (and wraps) like "repeat all".
    const wrap = this.repeat !== "off";

    if (this.shuffle && this.order.length === count) {
      const position = this.orderPos >= 0 ? this.orderPos : this.order.indexOf(this.index);
      let targetPos = position + direction;
      if (targetPos < 0) {
        if (!wrap) return null;
        targetPos = count - 1;
      } else if (targetPos >= count) {
        if (!wrap) return null;
        targetPos = 0;
      }
      let candidate = this.order[targetPos];
      if (candidate === undefined) return null;
      // Never return the current track while another one exists.
      let guard = 0;
      while (candidate === this.index && count > 1 && guard <= count) {
        targetPos += direction;
        if (targetPos < 0) {
          if (!wrap) return null;
          targetPos = count - 1;
        } else if (targetPos >= count) {
          if (!wrap) return null;
          targetPos = 0;
        }
        candidate = this.order[targetPos];
        if (candidate === undefined) return null;
        guard++;
      }
      return candidate;
    }

    let candidate = this.index + direction;
    if (candidate < 0) {
      if (!wrap) return null;
      candidate = count - 1;
    } else if (candidate >= count) {
      if (!wrap) return null;
      candidate = 0;
    }
    if (candidate === this.index && count > 1) {
      candidate += direction;
      if (candidate < 0) candidate = count - 1;
      else if (candidate >= count) candidate = 0;
    }
    return candidate;
  }

  /** Build a fresh shuffled order and put the current track first. */
  private rebuildOrder(): void {
    if (!this.shuffle) {
      this.order = [];
      this.orderPos = -1;
      return;
    }
    this.order = this.shuffledIndices(this.items.length);
    if (this.index >= 0) {
      const position = this.order.indexOf(this.index);
      if (position > 0) {
        const first = this.order[0];
        const current = this.order[position];
        if (first !== undefined && current !== undefined) {
          this.order[0] = current;
          this.order[position] = first;
        }
      }
      this.orderPos = 0;
    } else {
      this.orderPos = -1;
    }
  }

  private syncOrderPos(): void {
    if (!this.shuffle) {
      this.orderPos = -1;
      return;
    }
    this.orderPos = this.index >= 0 ? this.order.indexOf(this.index) : -1;
  }

  /** Fisher-Yates shuffle of `0..count-1` driven by the injected random source. */
  private shuffledIndices(count: number): number[] {
    const indices: number[] = [];
    for (let i = 0; i < count; i++) indices.push(i);
    for (let i = count - 1; i > 0; i--) {
      const raw = Math.floor(this.random() * (i + 1));
      const j = raw < 0 ? 0 : raw > i ? i : raw;
      const left = indices[i];
      const right = indices[j];
      if (left === undefined || right === undefined) continue;
      indices[i] = right;
      indices[j] = left;
    }
    return indices;
  }
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return 0;
  const floored = Math.trunc(index);
  return Math.min(Math.max(floored, 0), length - 1);
}

function clampInsert(index: number, length: number): number {
  if (!Number.isFinite(index)) return 0;
  const floored = Math.trunc(index);
  return Math.min(Math.max(floored, 0), length);
}

function isIndexInRange(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

/** Map an old item index to its new position after removing `from` and inserting at `destination`. */
function mapMovedIndex(index: number, from: number, destination: number): number {
  if (index === from) return destination;
  const afterRemoval = index > from ? index - 1 : index;
  return afterRemoval >= destination ? afterRemoval + 1 : afterRemoval;
}
