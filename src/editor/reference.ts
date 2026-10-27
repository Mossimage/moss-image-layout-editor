import { MAX_EDGE, type Box } from "./model.ts";

export interface CanvasSizeForImage {
  width: number;
  height: number;
  clamped: boolean;
}

/**
 * Pixel size to offer when the user matches the canvas to a reference image.
 * Natural pixels are rounded first. If either edge is above `maxEdge`, both
 * are scaled by the same factor and rounded again so neither exceeds the cap.
 */
export function canvasSizeForImage(
  naturalWidth: number,
  naturalHeight: number,
  maxEdge = MAX_EDGE,
): CanvasSizeForImage {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    throw new Error("Image size must be positive");
  }
  if (!Number.isFinite(maxEdge) || maxEdge < 1) throw new Error("Image size must be positive");
  let width = Math.max(1, Math.round(naturalWidth));
  let height = Math.max(1, Math.round(naturalHeight));
  let clamped = false;
  if (width > maxEdge || height > maxEdge) {
    const scale = maxEdge / Math.max(width, height);
    width = Math.min(maxEdge, Math.max(1, Math.round(width * scale)));
    height = Math.min(maxEdge, Math.max(1, Math.round(height * scale)));
    clamped = true;
  }
  return { width, height, clamped };
}

/** Scale a top-left box by the ratio of two canvas sizes. Axes scale independently. */
export function scaleBox(
  box: Box,
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number,
): Box {
  if (!(fromWidth > 0) || !(fromHeight > 0) || !Number.isFinite(fromWidth) || !Number.isFinite(fromHeight)) {
    throw new Error("Canvas size must be positive");
  }
  if (!Number.isFinite(toWidth) || !Number.isFinite(toHeight)) {
    throw new Error("Canvas size must be positive");
  }
  const sx = toWidth / fromWidth;
  const sy = toHeight / fromHeight;
  return [box[0] * sx, box[1] * sy, box[2] * sx, box[3] * sy];
}
