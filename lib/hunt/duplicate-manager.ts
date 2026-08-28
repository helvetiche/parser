/**
 * Central duplicate manager for the Hunt scraper.
 *
 * Handles:
 * - Canonical URL normalization (host+pathname, strip query/hash/trailing slash, case-insensitive host)
 * - In-page, cross-page, and cross-run deduplication
 * - Optional row-level dedupe via candidate id (which is the profile URL)
 *
 * Used both server-side (lib/hunt/automation.ts) and client-side (HuntAutomation.tsx).
 */

export function normalizeCandidateUrl(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  try {
    // Handle already-trimmed LinkedIn match (https://www.linkedin.com/in/...); ensure absolute URL
    const u = new URL(raw.trim());
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    // Keep pathname case-sensitive for slug uniqueness, but lower host; trim trailing slash
    let path = u.pathname.replace(/\/+$/, "");
    // Normalize duplicate slashes
    path = path.replace(/\/{2,}/g, "/");
    // For LinkedIn, lower-case the prefix but preserve slug case for display? For dedupe we lower everything
    // to avoid case-variant duplicates.
    path = path.toLowerCase();
    if (!path) path = "/";
    return `${host}${path}`;
  } catch {
    // Fallback: strip query/hash/trailing slash, lower host-like prefix
    return raw
      .trim()
      .split("?")[0]
      .split("#")[0]
      .replace(/\/+$/, "")
      .replace(/^https?:\/\/(www\.)?/i, "")
      .toLowerCase();
  }
}

/** Extra normalization for display/storage: keep original URL but dedupe via normalized key */
export function candidateKey(url: string): string {
  return normalizeCandidateUrl(url);
}

export type DuplicateFilterResult<T extends { url: string }> = {
  unique: T[];
  duplicates: T[];
  duplicateCount: number;
};

export class DuplicateManager {
  private seen = new Set<string>();
  private duplicateCount = 0;

  constructor(initialUrls?: string[]) {
    if (initialUrls) {
      for (const u of initialUrls) this.add(u);
    }
  }

  /** Normalized key for a URL */
  key(url: string): string {
    return normalizeCandidateUrl(url);
  }

  has(url: string): boolean {
    return this.seen.has(this.key(url));
  }

  /** Add URL to set. Returns true if newly added, false if duplicate */
  add(url: string): boolean {
    const k = this.key(url);
    if (!k) return false;
    if (this.seen.has(k)) {
      this.duplicateCount++;
      return false;
    }
    this.seen.add(k);
    return true;
  }

  addAll(urls: string[]): number {
    let added = 0;
    for (const u of urls) if (this.add(u)) added++;
    return added;
  }

  /**
   * Filter a list of candidate-like objects, keeping only first occurrence
   * of each normalized URL. Mutates `seen` to remember uniques.
   */
  filter<T extends { url: string }>(items: T[]): DuplicateFilterResult<T> {
    const unique: T[] = [];
    const duplicates: T[] = [];
    for (const item of items) {
      const k = this.key(item.url);
      if (!k || this.seen.has(k)) {
        duplicates.push(item);
        if (k) this.duplicateCount++;
        continue;
      }
      this.seen.add(k);
      unique.push(item);
    }
    return { unique, duplicates, duplicateCount: duplicates.length };
  }

  /** Non-mutating check: return unique/duplicates without adding to `seen` */
  partition<T extends { url: string }>(items: T[]): DuplicateFilterResult<T> {
    const unique: T[] = [];
    const duplicates: T[] = [];
    for (const item of items) {
      const k = this.key(item.url);
      if (!k || this.seen.has(k)) duplicates.push(item);
      else unique.push(item);
    }
    return { unique, duplicates, duplicateCount: duplicates.length };
  }

  get size(): number {
    return this.seen.size;
  }

  get totalDuplicates(): number {
    return this.duplicateCount;
  }

  clear(): void {
    this.seen.clear();
    this.duplicateCount = 0;
  }

  hasSeen(url: string): boolean {
    return this.has(url);
  }

  toArray(): string[] {
    return Array.from(this.seen);
  }

  /** Seed from candidate rows (id is url) or raw profile results */
  seedFromRows(rows: Array<{ id?: string; url?: string }>): void {
    for (const r of rows) {
      const u = (r as { id?: string }).id || (r as { url?: string }).url;
      if (u) this.add(u);
    }
  }

  /** Seed from arbitrary url strings */
  seedFromUrls(urls: string[]): void {
    this.addAll(urls);
  }
}

/** Convenience: one-shot dedupe without retaining manager */
export function dedupeCandidates<T extends { url: string }>(
  items: T[],
  manager = new DuplicateManager()
): DuplicateFilterResult<T> {
  return manager.filter(items);
}
