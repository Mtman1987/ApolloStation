import { deflateSync } from "node:zlib";
import { MOSAIC_COLORS, MOSAIC_HEIGHT, MOSAIC_PALETTES, MOSAIC_WIDTH, validateMosaicTemplate } from "./mosaic-core.js";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function crc32(value: Buffer) {
  let crc = 0xffffffff;
  for (const byte of value) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

/** Render a validated Nebula Mosaic project to a dependency-free 800x1000 PNG. */
export function mosaicTemplatePng(value: unknown): Buffer {
  const template = validateMosaicTemplate(value);
  const width = MOSAIC_WIDTH * 20, height = MOSAIC_HEIGHT * 20, rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  const palette = MOSAIC_PALETTES[template.paletteId];
  const colors = Object.fromEntries(Object.entries(palette).map(([code, hex]) => [code, [
    Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16), 255,
  ]])) as Record<keyof typeof MOSAIC_COLORS, number[]>;
  for (let y = 0; y < height; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0;
    const mosaicRow = Math.floor(y / 20) * MOSAIC_WIDTH;
    for (let x = 0; x < width; x++) {
      const color = colors[template.target[mosaicRow + Math.floor(x / 20)]!]!;
      const offset = rowStart + 1 + x * 4;
      raw[offset] = color[0]!; raw[offset + 1] = color[1]!;
      raw[offset + 2] = color[2]!; raw[offset + 3] = color[3]!;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
