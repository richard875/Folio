export function boundedInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (!value || !/^\d+$/.test(value.trim())) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= maximum ? number : fallback;
}

/** Reject overload immediately instead of retaining a queue of requests in RAM. */
export class WorkLimit {
  private active = 0;
  private readonly maximum: () => number;
  constructor(maximum: () => number) { this.maximum = maximum; }
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximum()) {
      throw Object.assign(new Error("Server is busy. Please retry later."), { status: 429 });
    }
    this.active++;
    try { return await work(); } finally { this.active--; }
  }
}

export const extractionLimit = new WorkLimit(() => boundedInteger(process.env.READ_CONCURRENCY, 1, 10));
export const agentLimit = new WorkLimit(() => 1);

/** Count AND size bounds; expired data is removed on access, without background timers. */
export class BoundedCache<T> {
  private entries = new Map<string, { value: T; expires: number; bytes: number }>();
  private bytes = 0;
  private readonly maximumEntries: number;
  private readonly maximumBytes: number;
  private readonly ttl: number;
  constructor(maximumEntries: number, maximumBytes: number, ttl: number) {
    this.maximumEntries = maximumEntries;
    this.maximumBytes = maximumBytes;
    this.ttl = ttl;
  }
  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
  get(key: string): T | undefined {
    const now = Date.now();
    for (const [name, entry] of this.entries) if (entry.expires <= now) this.remove(name);
    return this.entries.get(key)?.value;
  }
  set(key: string, value: T, bytes: number) {
    this.remove(key);
    if (bytes > this.maximumBytes) return;
    while (this.entries.size >= this.maximumEntries || this.bytes + bytes > this.maximumBytes) {
      this.remove(this.entries.keys().next().value!);
    }
    this.entries.set(key, { value, bytes, expires: Date.now() + this.ttl });
    this.bytes += bytes;
  }
}
