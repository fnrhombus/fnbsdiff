import { describe, it, expect } from "vitest";
import { diff, patch } from "fnbsdiff";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Helper: round-trip old -> new through diff+patch and assert equality. */
function roundTrip(oldData: Uint8Array, newData: Uint8Array): Uint8Array {
  const patchData = diff(oldData, newData);
  const result = patch(oldData, patchData);
  expect(result).toEqual(newData);
  return patchData;
}

describe("fnbsdiff", () => {
  it("round-trips: small text change", () => {
    const old = enc.encode("hello");
    const neu = enc.encode("hello world");
    roundTrip(old, neu);
  });

  it("round-trips: identical files produce a small patch", () => {
    const data = enc.encode("the quick brown fox jumps over the lazy dog");
    const patchData = roundTrip(data, data);
    // Patch should be small — just header + controls, minimal diff/extra
    expect(patchData.length).toBeLessThan(data.length + 50);
  });

  it("round-trips: completely different files", () => {
    const old = enc.encode("aaaaaaaaaaaaaaaa");
    const neu = enc.encode("bbbbbbbbbbbbbbbb");
    roundTrip(old, neu);
  });

  it("round-trips: empty old file", () => {
    const old = new Uint8Array(0);
    const neu = enc.encode("brand new content");
    const patchData = roundTrip(old, neu);
    // Patch is essentially the new file plus overhead
    expect(patchData.length).toBeGreaterThanOrEqual(neu.length);
  });

  it("round-trips: empty new file", () => {
    const old = enc.encode("this will be deleted");
    const neu = new Uint8Array(0);
    roundTrip(old, neu);
  });

  it("round-trips: both files empty", () => {
    roundTrip(new Uint8Array(0), new Uint8Array(0));
  });

  it("round-trips: binary data with random bytes", () => {
    const size = 1024;
    const old = new Uint8Array(size);
    const neu = new Uint8Array(size);
    // Use a simple PRNG for reproducibility
    let seed = 42;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed & 0xff;
    };
    for (let i = 0; i < size; i++) old[i] = rng();
    // Make new data 80% similar to old
    for (let i = 0; i < size; i++) {
      neu[i] = rng() < 50 ? rng() : old[i]!;
    }
    roundTrip(old, neu);
  });

  it("round-trips: larger similar data (10KB)", () => {
    const size = 10240;
    const old = new Uint8Array(size);
    let seed = 123;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed & 0xff;
    };
    for (let i = 0; i < size; i++) old[i] = rng();

    // New data: copy old with ~5% of bytes changed
    const neu = new Uint8Array(old);
    for (let i = 0; i < size; i++) {
      if (rng() < 13) neu[i] = rng(); // ~5% chance of change
    }
    const patchData = roundTrip(old, neu);
    // Without compression, the diff block is ~newSize bytes (mostly zeros for
    // matching regions). Patch should be reasonable — less than 2x the file.
    // Real savings come when the output is gzip'd (diff block compresses well).
    expect(patchData.length).toBeLessThan(size * 2);
  });

  it("patch format: header starts with FNBD magic bytes", () => {
    const old = enc.encode("foo");
    const neu = enc.encode("bar");
    const patchData = diff(old, neu);
    expect(patchData[0]).toBe(0x46); // 'F'
    expect(patchData[1]).toBe(0x4e); // 'N'
    expect(patchData[2]).toBe(0x42); // 'B'
    expect(patchData[3]).toBe(0x44); // 'D'
  });

  it("patch format: header contains correct new file size", () => {
    const old = enc.encode("hello");
    const neu = enc.encode("hello world!!");
    const patchData = diff(old, neu);
    const view = new DataView(
      patchData.buffer,
      patchData.byteOffset,
      patchData.byteLength,
    );
    expect(view.getUint32(4, true)).toBe(neu.length);
  });

  it("patch rejects invalid magic bytes", () => {
    const badPatch = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => patch(new Uint8Array(0), badPatch)).toThrow("invalid patch magic");
  });

  it("patch rejects truncated data", () => {
    const old = enc.encode("hello");
    const neu = enc.encode("world");
    const patchData = diff(old, neu);
    // Truncate the patch
    const truncated = patchData.subarray(0, 12);
    // This may or may not throw depending on whether there are controls
    // but if there are controls, reading diff/extra will fail
    // At minimum it shouldn't produce the correct output silently
    try {
      const result = patch(old, truncated);
      // If it doesn't throw, the result should NOT match
      expect(result).not.toEqual(neu);
    } catch {
      // Expected — truncated patch should throw
    }
  });

  it("round-trips: single byte change in the middle", () => {
    const text = "the quick brown fox jumps over the lazy dog and some more text to make it longer";
    const old = enc.encode(text);
    const neu = enc.encode(text.replace("fox", "cat"));
    roundTrip(old, neu);
  });

  it("round-trips: appending data", () => {
    const old = enc.encode("base content");
    const neu = enc.encode("base content plus some appended data");
    roundTrip(old, neu);
  });

  it("round-trips: prepending data", () => {
    const old = enc.encode("original text");
    const neu = enc.encode("prepended stuff original text");
    roundTrip(old, neu);
  });

  it("diff block is highly compressible for similar files", () => {
    // For 95%-similar files, the diff block is mostly 0x00 bytes.
    // This test verifies the patch compresses well (the value proposition
    // of bsdiff: the delta is compressible even without built-in compression).
    const size = 10240;
    const old = new Uint8Array(size);
    let seed = 456;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed & 0xff;
    };
    for (let i = 0; i < size; i++) old[i] = rng();
    const neu = new Uint8Array(old);
    for (let i = 0; i < size; i++) {
      if (rng() < 13) neu[i] = rng();
    }
    const patchData = diff(old, neu);

    // Count zero bytes in the patch (after the header) — most diff bytes
    // should be 0x00 for matching regions
    let zeros = 0;
    for (let i = 12; i < patchData.length; i++) {
      if (patchData[i] === 0) zeros++;
    }
    // At least 50% of post-header bytes should be zero for similar files
    // (control tuples add non-zero overhead; the diff block itself is mostly zeros)
    expect(zeros / (patchData.length - 12)).toBeGreaterThan(0.5);
  });
});
