/**
 * Suffix array construction using the qsufsort algorithm.
 *
 * This is a simplified O(n log n) suffix sort based on the approach used
 * in the original bsdiff by Colin Percival. It sorts suffixes of the input
 * byte array and returns an array of indices representing the sorted order.
 */

/**
 * Build a suffix array for the given data.
 * Returns an Int32Array where SA[i] is the starting index of the i-th
 * smallest suffix in lexicographic order.
 */
export function buildSuffixArray(data: Uint8Array): Int32Array {
  const n = data.length;
  if (n === 0) return new Int32Array(0);

  const sa = new Int32Array(n + 1);
  const rank = new Int32Array(n + 1);
  const tmp = new Int32Array(n + 1);

  // Initial ranking based on single bytes
  for (let i = 0; i < n; i++) {
    sa[i] = i;
    rank[i] = data[i]!;
  }
  sa[n] = n;
  rank[n] = -1;

  // Iteratively double the prefix length used for comparison
  for (let k = 1; k < n; k *= 2) {
    // Sort sa by (rank[i], rank[i + k])
    compareSortSA(sa, rank, k, n);

    // Compute new ranks
    tmp[sa[0]!] = 0;
    for (let i = 1; i <= n; i++) {
      const prev = sa[i - 1]!;
      const curr = sa[i]!;
      if (
        rank[prev] === rank[curr] &&
        prev + k <= n &&
        curr + k <= n &&
        rank[prev + k] === rank[curr + k]
      ) {
        tmp[curr] = tmp[prev]!;
      } else {
        tmp[curr] = i;
      }
    }

    for (let i = 0; i <= n; i++) {
      rank[i] = tmp[i]!;
    }

    // If all ranks are unique, we're done
    if (rank[sa[n]!] === n) break;
  }

  // Return without the sentinel
  return sa.subarray(0, n);
}

/**
 * Sort suffix array entries by (rank[i], rank[i+k]) using a simple
 * comparison-based sort. For the sizes we handle (typical file patches),
 * the built-in sort is fast enough.
 */
function compareSortSA(
  sa: Int32Array,
  rank: Int32Array,
  k: number,
  n: number,
): void {
  const len = n + 1;

  // Extract into a regular array for sort, since Int32Array.sort
  // doesn't accept a comparator in all environments
  const arr: number[] = new Array(len);
  for (let i = 0; i < len; i++) arr[i] = sa[i]!;

  arr.sort((a, b) => {
    if (rank[a] !== rank[b]) return rank[a]! - rank[b]!;
    const ra = a + k <= n ? rank[a + k]! : -1;
    const rb = b + k <= n ? rank[b + k]! : -1;
    return ra - rb;
  });

  for (let i = 0; i < len; i++) sa[i] = arr[i]!;
}

/**
 * Binary search on the suffix array to find the longest match of
 * `newData[newPos..]` in `oldData`.
 *
 * Returns [matchOffset, matchLength] where matchOffset is the position
 * in oldData and matchLength is the number of matching bytes.
 */
export function findLongestMatch(
  oldData: Uint8Array,
  sa: Int32Array,
  newData: Uint8Array,
  newPos: number,
): [offset: number, length: number] {
  const n = oldData.length;
  if (n === 0) return [0, 0];

  let lo = 0;
  let hi = n - 1;
  let bestOffset = 0;
  let bestLength = 0;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const suffixStart = sa[mid]!;

    // Compare newData[newPos..] with oldData[suffixStart..]
    const maxLen = Math.min(n - suffixStart, newData.length - newPos);
    let matchLen = 0;
    let cmp = 0;

    while (matchLen < maxLen) {
      const a = newData[newPos + matchLen]!;
      const b = oldData[suffixStart + matchLen]!;
      if (a !== b) {
        cmp = a - b;
        break;
      }
      matchLen++;
    }

    if (matchLen > bestLength) {
      bestLength = matchLen;
      bestOffset = suffixStart;
    }

    if (cmp === 0 && matchLen === maxLen) {
      // newData[newPos..] is a prefix of oldData[suffixStart..] or vice versa
      // Check neighbors for potentially longer matches
      // But we already recorded this match, search both sides
      // Try to improve by checking neighbors
      break;
    } else if (cmp < 0) {
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  // Check immediate neighbors of the final position for better matches
  // The binary search may not land exactly on the best match
  for (
    let i = Math.max(0, lo - 1);
    i <= Math.min(n - 1, lo + 1);
    i++
  ) {
    const suffixStart = sa[i]!;
    const maxLen = Math.min(n - suffixStart, newData.length - newPos);
    let matchLen = 0;
    while (
      matchLen < maxLen &&
      newData[newPos + matchLen] === oldData[suffixStart + matchLen]
    ) {
      matchLen++;
    }
    if (matchLen > bestLength) {
      bestLength = matchLen;
      bestOffset = suffixStart;
    }
  }

  return [bestOffset, bestLength];
}
