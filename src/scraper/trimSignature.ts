export interface SignatureBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Scan RGBA pixel data for the tight bounding box of every non-transparent
 * pixel. Used to crop a signature canvas to just the drawn strokes, so the
 * exported PNG fills the PDF signature line instead of sitting tiny inside a
 * mostly-empty box. Returns null when every pixel is fully transparent.
 */
export function findOpaqueBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): SignatureBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}
