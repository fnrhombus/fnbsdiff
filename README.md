# fnbsdiff

**Binary patches for the browser. Finally.**

[![npm version](https://img.shields.io/npm/v/fnbsdiff)](https://www.npmjs.com/package/fnbsdiff)
[![bundle size](https://img.shields.io/bundlephobia/minzip/fnbsdiff)](https://bundlephobia.com/package/fnbsdiff)
[![license](https://img.shields.io/npm/l/fnbsdiff)](https://github.com/fnrhombus/fnbsdiff/blob/main/LICENSE)

```ts
import { diff, patch } from "fnbsdiff";

// Create a patch
const patchData = diff(oldFile, newFile);

// Apply it later
const restored = patch(oldFile, patchData);
// restored is identical to newFile
```

## The problem

You need binary delta compression in JavaScript. Your options are:

- **bsdiff-node** — Native addon. Node.js only. No browser support. Breaks on every OS update.
- **xdelta3-wasm** — WASM build of xdelta3. Different algorithm, different tradeoffs. Complex build chain.
- **Roll your own** — You have better things to do.

**fnbsdiff** is a pure TypeScript implementation of the bsdiff/bspatch algorithm. Zero native dependencies. Works in the browser. Works in Node.js. Works in Deno. Works in Bun.

## Use cases

- **OTA updates for PWAs** — Ship binary diffs instead of full bundles
- **Game asset patching** — Update textures, levels, and data files incrementally
- **Offline sync** — Transmit only what changed in binary data stores
- **Electron auto-updates** — Smaller downloads, faster updates

## API

### `diff(oldData: Uint8Array, newData: Uint8Array): Uint8Array`

Create a binary patch that transforms `oldData` into `newData`.

### `patch(oldData: Uint8Array, patchData: Uint8Array): Uint8Array`

Apply a patch to `oldData` to reconstruct the original `newData`.

Throws if the patch is malformed or truncated.

## Comparison

| Feature | fnbsdiff | bsdiff-node | xdelta3-wasm |
|---|---|---|---|
| Browser support | :white_check_mark: | :x: | :white_check_mark: |
| Node.js support | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| Pure JS/TS (no native) | :white_check_mark: | :x: | :x: |
| Zero dependencies | :white_check_mark: | :x: | :x: |
| TypeScript types | :white_check_mark: | :x: | :x: |
| ESM + CJS | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| Algorithm | bsdiff | bsdiff | xdelta3 |

## Patch format

fnbsdiff uses a simple binary format (not compatible with the original bsdiff format):

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | Magic bytes: `FNBD` |
| 4 | 4 | New file size (uint32 LE) |
| 8 | 4 | Control tuple count (uint32 LE) |
| 12 | 12n | Control tuples: `(diffLen: u32, extraLen: u32, seekOffset: i32)` |
| 12+12n | ... | Diff block (raw bytes) |
| ... | ... | Extra block (raw bytes) |

Each control tuple describes:
1. **diffLen** bytes where `new[i] = old[i] + diff[i]` (bytewise addition)
2. **extraLen** bytes copied verbatim from the extra block
3. **seekOffset** to advance the old-file read cursor

## Install

```bash
npm install fnbsdiff
```

## Support

If fnbsdiff saves you time, consider supporting development:

- [GitHub Sponsors](https://github.com/sponsors/fnrhombus)
- [Buy Me a Coffee](https://buymeacoffee.com/fnrhombus)

## License

MIT
