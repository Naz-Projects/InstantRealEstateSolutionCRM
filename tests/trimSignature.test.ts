import { describe, it, expect } from "vitest";
import { findOpaqueBounds } from "../src/scraper/trimSignature";

// Allocate an all-transparent RGBA buffer (every byte 0 → alpha 0).
function makeBuffer(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4);
}

// Set the alpha byte of pixel (x, y) so the helper treats it as drawn-on.
function setAlpha(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  alpha: number,
): void {
  data[(y * width + x) * 4 + 3] = alpha;
}

describe("findOpaqueBounds", () => {
  it("returns null for a fully transparent buffer", () => {
    expect(findOpaqueBounds(makeBuffer(10, 8), 10, 8)).toBeNull();
  });

  it("returns a 1x1 box for a single opaque pixel", () => {
    const data = makeBuffer(10, 8);
    setAlpha(data, 10, 4, 3, 255);
    expect(findOpaqueBounds(data, 10, 8)).toEqual({
      minX: 4,
      minY: 3,
      maxX: 4,
      maxY: 3,
    });
  });

  it("spans the extremes of several opaque pixels", () => {
    const data = makeBuffer(20, 20);
    setAlpha(data, 20, 2, 5, 255);
    setAlpha(data, 20, 17, 11, 255);
    setAlpha(data, 20, 9, 1, 255);
    expect(findOpaqueBounds(data, 20, 20)).toEqual({
      minX: 2,
      minY: 1,
      maxX: 17,
      maxY: 11,
    });
  });

  it("includes pixels in the buffer corners", () => {
    const data = makeBuffer(6, 6);
    setAlpha(data, 6, 0, 0, 255);
    setAlpha(data, 6, 5, 5, 255);
    expect(findOpaqueBounds(data, 6, 6)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 5,
      maxY: 5,
    });
  });

  it("treats any non-zero alpha as opaque", () => {
    const data = makeBuffer(5, 5);
    setAlpha(data, 5, 2, 2, 1);
    expect(findOpaqueBounds(data, 5, 5)).toEqual({
      minX: 2,
      minY: 2,
      maxX: 2,
      maxY: 2,
    });
  });
});
