/**
 * bspatch — apply a binary patch to reconstruct the new file.
 *
 * For each control tuple (diffLength, extraLength, seekOffset):
 * 1. Copy diffLength bytes: new[i] = old[oldPos+i] + diff[i]
 * 2. Copy extraLength bytes verbatim from the extra block
 * 3. Advance oldPos by diffLength + seekOffset
 */

import { decodePatch } from "./format.js";

export function patch(
  oldData: Uint8Array,
  patchData: Uint8Array,
): Uint8Array {
  const { newSize, controls, diffBlock, extraBlock } = decodePatch(patchData);

  const result = new Uint8Array(newSize);
  const oldSize = oldData.length;

  let newPos = 0;
  let oldPos = 0;
  let diffOffset = 0;
  let extraOffset = 0;

  for (const ctrl of controls) {
    // Apply diff: result[i] = old[oldPos+i] + diffBlock[i]
    for (let i = 0; i < ctrl.diffLength; i++) {
      const oldByte = oldPos + i >= 0 && oldPos + i < oldSize
        ? oldData[oldPos + i]!
        : 0;
      result[newPos + i] = (oldByte + diffBlock[diffOffset + i]!) & 0xff;
    }
    newPos += ctrl.diffLength;
    diffOffset += ctrl.diffLength;

    // Copy extra bytes verbatim
    for (let i = 0; i < ctrl.extraLength; i++) {
      result[newPos + i] = extraBlock[extraOffset + i]!;
    }
    newPos += ctrl.extraLength;
    extraOffset += ctrl.extraLength;

    // Advance old pointer
    oldPos += ctrl.diffLength + ctrl.seekOffset;
  }

  if (newPos !== newSize) {
    throw new Error(
      `fnbsdiff: patch produced ${newPos} bytes, expected ${newSize}`,
    );
  }

  return result;
}
