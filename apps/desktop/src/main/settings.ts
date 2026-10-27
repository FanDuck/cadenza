/**
 * Tiny JSON store for app settings. Writes are debounced and atomic
 * (write to a temp file, then rename) so a crash never leaves half a file.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { AppSettings } from "@fanduck/cadenza-core";

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "midnight",
  accent: "violet",
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: "off",
  libraryRoots: [],
  resumeSession: true,
  mediaKeys: true,
};

export class SettingsStore {
  private data: Record<string, unknown> = {};
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const raw = await fsp.readFile(this.file, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") this.data = parsed as Record<string, unknown>;
    } catch {
      this.data = {};
    }
  }

  all(): Record<string, unknown> {
    return { ...this.data };
  }

  get<T>(key: string, fallback: T): T {
    const value = this.data[key];
    return (value === undefined ? fallback : (value as T));
  }

  /** Settings are merged with the defaults so a new version can add keys safely. */
  settings(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...(this.data as Partial<AppSettings>) };
  }

  set(key: string, value: unknown): void {
    this.data[key] = value;
    this.scheduleFlush();
  }

  setMany(patch: Record<string, unknown>): void {
    Object.assign(this.data, patch);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 250);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.writing = this.writing.then(async () => {
      const tmp = `${this.file}.tmp`;
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      await fsp.writeFile(tmp, JSON.stringify(this.data, null, 2), "utf8");
      await fsp.rename(tmp, this.file).catch(async () => {
        // Windows can refuse the rename while another handle is open; retry once.
        await new Promise((r) => setTimeout(r, 50));
        await fsp.rename(tmp, this.file);
      });
    });
    return this.writing;
  }

  flushSync(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), "utf8");
    } catch {
      /* best effort on quit */
    }
  }
}
