/**
 * bsdiff — generate a binary patch from oldData to newData.
 *
 * Closely follows the original bsdiff algorithm by Colin Percival:
 *
 * 1. Build a suffix array of oldData
 * 2. Scan newData, finding the best match at each position
 * 3. When a new match is sufficiently better than extending the current
 *    alignment, emit a control tuple for the intervening region
 * 4. The region is split into "diff" (bytewise delta against old at current
 *    alignment) and "extra" (new bytes with no correspondence in old)
 */

import { buildSuffixArray, findLongestMatch } from "./suffix-array.js";
import { encodePatch, type ControlTuple } from "./format.js";

export function diff(oldData: Uint8Array, newData: Uint8Array): Uint8Array {
  const oldSize = oldData.length;
  const newSize = newData.length;

  if (newSize === 0) {
    return encodePatch(0, [], new Uint8Array(0), new Uint8Array(0));
  }

  // Build suffix array of old data
  const sa = buildSuffixArray(oldData);

  const controls: ControlTuple[] = [];
  const diffBytes: number[] = [];
  const extraBytes: number[] = [];

  let scan = 0;
  let lastScan = 0;
  let lastPos = 0;
  let lastOffset = 0;

  while (scan < newSize) {
    // Find the best match for newData[scan..] in oldData
    const [matchPos, matchLen] = oldSize > 0
      ? findLongestMatch(oldData, sa, newData, scan)
      : [0, 0] as [number, number];

    // Count how many bytes at scan match using the previous offset
    // (i.e., continuing the current alignment)
    let oldscore = 0;
    if (oldSize > 0) {
      for (let i = 0; i < matchLen && scan + i < newSize; i++) {
        const oi = scan + i + lastOffset;
        if (oi >= 0 && oi < oldSize && oldData[oi] === newData[scan + i]) {
          oldscore++;
        }
      }
    }

    // If the new match isn't significantly better than continuing the
    // current alignment, skip forward
    if (matchLen <= oldscore + 8 || matchLen < 8) {
      scan++;
      continue;
    }

    // We have a good new match. Emit the region from lastScan to scan.

    // Forward scan from lastScan: extend using lastOffset
    // Find how far the previous alignment is still useful
    let lenf = 0;
    {
      let s = 0;
      let best = 0;
      const maxI = Math.min(scan - lastScan, oldSize - lastPos);
      for (let i = 0; i < maxI; i++) {
        if (oldData[lastPos + i] === newData[lastScan + i]) s++;
        i++; // count processed bytes
        // Check: is extending the diff to length i better than cutting it shorter?
        // Use: s matches out of i bytes => extend if match density is good
        i--; // undo the extra increment
        if (s * 2 - (i + 1) > best * 2 - lenf) {
          best = s;
          lenf = i + 1;
        }
      }
    }

    // Backward scan from scan: extend using new offset (matchPos - scan)
    let lenb = 0;
    {
      let s = 0;
      let best = 0;
      const maxI = Math.min(scan - lastScan - lenf, matchPos);
      for (let i = 1; i <= maxI && scan - i >= lastScan + lenf; i++) {
        if (oldData[matchPos - i] === newData[scan - i]) s++;
        if (s * 2 - i > best * 2 - lenb) {
          best = s;
          lenb = i;
        }
      }
    }

    // Handle overlap
    if (lastScan + lenf > scan - lenb) {
      const overlap = (lastScan + lenf) - (scan - lenb);
      let s = 0;
      let best = 0;
      let splitAt = 0;
      for (let i = 0; i < overlap; i++) {
        if (
          lastPos + lenf - overlap + i < oldSize &&
          newData[lastScan + lenf - overlap + i] === oldData[lastPos + lenf - overlap + i]
        ) {
          s++;
        }
        if (
          matchPos - lenb + i >= 0 &&
          newData[scan - lenb + i] === oldData[matchPos - lenb + i]
        ) {
          s--;
        }
        if (s > best) {
          best = s;
          splitAt = i + 1;
        }
      }
      lenf = lenf - overlap + splitAt;
      lenb -= splitAt;
    }

    // Emit diff bytes for forward extension
    for (let i = 0; i < lenf; i++) {
      const newByte = newData[lastScan + i]!;
      const oldIdx = lastPos + i;
      const oldByte = oldIdx >= 0 && oldIdx < oldSize ? oldData[oldIdx]! : 0;
      diffBytes.push((newByte - oldByte + 256) & 0xff);
    }

    // Emit extra bytes for the gap
    const extraStart = lastScan + lenf;
    const extraEnd = scan - lenb;
    for (let i = extraStart; i < extraEnd; i++) {
      extraBytes.push(newData[i]!);
    }

    controls.push({
      diffLength: lenf,
      extraLength: extraEnd - extraStart,
      seekOffset: (matchPos - lenb) - (lastPos + lenf),
    });

    lastScan = scan - lenb;
    lastPos = matchPos - lenb;
    lastOffset = matchPos - scan;
    scan += matchLen;
  }

  // Handle remaining bytes
  if (lastScan < newSize) {
    let lenf = 0;
    {
      let s = 0;
      let best = 0;
      const maxI = Math.min(newSize - lastScan, oldSize - lastPos);
      for (let i = 0; i < maxI; i++) {
        if (oldData[lastPos + i] === newData[lastScan + i]) s++;
        if (s * 2 - (i + 1) > best * 2 - lenf) {
          best = s;
          lenf = i + 1;
        }
      }
    }

    for (let i = 0; i < lenf; i++) {
      const newByte = newData[lastScan + i]!;
      const oldIdx = lastPos + i;
      const oldByte = oldIdx >= 0 && oldIdx < oldSize ? oldData[oldIdx]! : 0;
      diffBytes.push((newByte - oldByte + 256) & 0xff);
    }

    const extraLen = newSize - lastScan - lenf;
    for (let i = 0; i < extraLen; i++) {
      extraBytes.push(newData[lastScan + lenf + i]!);
    }

    if (lenf > 0 || extraLen > 0) {
      controls.push({
        diffLength: lenf,
        extraLength: extraLen,
        seekOffset: 0,
      });
    }
  }

  return encodePatch(
    newSize,
    controls,
    new Uint8Array(diffBytes),
    new Uint8Array(extraBytes),
  );
}
