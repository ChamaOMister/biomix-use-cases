/**
 * Seeded pseudo-random numbers (sfc32, seeded through splitmix32). Only 32-bit integer
 * operations and exact divisions by 2^32 are used, so a seed yields the same sequence on every
 * platform and time zone. Not for security.
 */

function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** FNV-1a over UTF-16 code units; used to derive independent streams from labels. */
function hashLabel(label: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i += 1) {
    hash = Math.imul(hash ^ label.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash;
}

export class Random {
  private readonly seed: number;
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError("Seed must be an integer from 0 to 4294967295");
    }
    this.seed = seed;
    const next = splitmix32(seed);
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    for (let i = 0; i < 12; i += 1) this.uint32();
  }

  /**
   * An independent stream for one part of the generator, so changing how one part draws numbers
   * does not reshuffle the others.
   */
  fork(label: string): Random {
    return new Random((Math.imul(this.seed ^ hashLabel(label), 0x9e3779b1) ^ hashLabel(`${label}#`)) >>> 0);
  }

  uint32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Uniform in [0, 1). */
  float(): number {
    return this.uint32() / 0x100000000;
  }

  /** Uniform in [min, max). */
  between(min: number, max: number): number {
    return min + (max - min) * this.float();
  }

  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.float() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("Cannot pick from an empty list");
    return items[this.int(0, items.length - 1)]!;
  }

  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const item of items) total += weight(item);
    if (!(total > 0)) throw new RangeError("Weighted pick needs a positive total weight");
    let target = this.float() * total;
    for (const item of items) {
      target -= weight(item);
      if (target < 0) return item;
    }
    return items[items.length - 1]!;
  }

  /** Fisher–Yates on a copy. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  }

  /** A UUID-shaped identifier (version 4 layout) drawn from this stream. */
  uuid(): string {
    const hex = [this.uint32(), this.uint32(), this.uint32(), this.uint32()]
      .map((word) => word.toString(16).padStart(8, "0"))
      .join("");
    const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
}
