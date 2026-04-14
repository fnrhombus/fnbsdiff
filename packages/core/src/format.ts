/**
 * Patch format for fnbsdiff.
 *
 * Layout:
 *   Header (12 bytes):
 *     - Magic: "FNBD" (4 bytes, ASCII)
 *     - New file size: uint32 LE (4 bytes)
 *     - Control tuple count: uint32 LE (4 bytes)
 *
 *   Control block (12 bytes per tuple):
 *     - diffLength: uint32 LE — bytes to copy from old+diff
 *     - extraLength: uint32 LE — bytes to copy verbatim from extra
 *     - seekOffset: int32 LE — signed offset to advance the old pointer
 *
 *   Diff block: raw bytes (sum of all diffLength values)
 *   Extra block: raw bytes (sum of all extraLength values)
 */

export const MAGIC = new Uint8Array([0x46, 0x4e, 0x42, 0x44]); // "FNBD"
export const HEADER_SIZE = 12;
export const CONTROL_TUPLE_SIZE = 12;

export interface ControlTuple {
  diffLength: number;
  extraLength: number;
  seekOffset: number;
}

/** Encode a patch from its components into a single Uint8Array. */
export function encodePatch(
  newSize: number,
  controls: ControlTuple[],
  diffBlock: Uint8Array,
  extraBlock: Uint8Array,
): Uint8Array {
  const controlSize = controls.length * CONTROL_TUPLE_SIZE;
  const totalSize = HEADER_SIZE + controlSize + diffBlock.length + extraBlock.length;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  // Header
  out.set(MAGIC, 0);
  view.setUint32(4, newSize, true);
  view.setUint32(8, controls.length, true);

  // Control block
  let offset = HEADER_SIZE;
  for (const ctrl of controls) {
    view.setUint32(offset, ctrl.diffLength, true);
    view.setUint32(offset + 4, ctrl.extraLength, true);
    view.setInt32(offset + 8, ctrl.seekOffset, true);
    offset += CONTROL_TUPLE_SIZE;
  }

  // Diff block
  out.set(diffBlock, offset);
  offset += diffBlock.length;

  // Extra block
  out.set(extraBlock, offset);

  return out;
}

/** Decode a patch into its components. Throws on invalid format. */
export function decodePatch(
  patchData: Uint8Array,
): {
  newSize: number;
  controls: ControlTuple[];
  diffBlock: Uint8Array;
  extraBlock: Uint8Array;
} {
  if (patchData.length < HEADER_SIZE) {
    throw new Error("fnbsdiff: patch too small to contain header");
  }

  // Verify magic
  for (let i = 0; i < 4; i++) {
    if (patchData[i] !== MAGIC[i]) {
      throw new Error("fnbsdiff: invalid patch magic bytes");
    }
  }

  const view = new DataView(
    patchData.buffer,
    patchData.byteOffset,
    patchData.byteLength,
  );
  const newSize = view.getUint32(4, true);
  const controlCount = view.getUint32(8, true);

  const controlSize = controlCount * CONTROL_TUPLE_SIZE;
  if (patchData.length < HEADER_SIZE + controlSize) {
    throw new Error("fnbsdiff: patch truncated in control block");
  }

  const controls: ControlTuple[] = [];
  let offset = HEADER_SIZE;
  let totalDiff = 0;
  let totalExtra = 0;

  for (let i = 0; i < controlCount; i++) {
    const diffLength = view.getUint32(offset, true);
    const extraLength = view.getUint32(offset + 4, true);
    const seekOffset = view.getInt32(offset + 8, true);
    controls.push({ diffLength, extraLength, seekOffset });
    totalDiff += diffLength;
    totalExtra += extraLength;
    offset += CONTROL_TUPLE_SIZE;
  }

  if (patchData.length < offset + totalDiff + totalExtra) {
    throw new Error("fnbsdiff: patch truncated in data blocks");
  }

  const diffBlock = patchData.subarray(offset, offset + totalDiff);
  offset += totalDiff;
  const extraBlock = patchData.subarray(offset, offset + totalExtra);

  return { newSize, controls, diffBlock, extraBlock };
}
