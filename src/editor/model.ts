import { formatPyList } from "../compile/errors.ts";
import { isPyFloat } from "../compile/json.ts";

export type Label = "object" | "character" | "text";
export type CanvasKind = "single" | "multi_panel" | "collage";
export type Box = [number, number, number, number];

export interface EditorItem {
  id: string;
  label: Label;
  caption: string;
  text: string;
  tags: string[];
  palette: string[];
  bbox: Box;
}

export interface EditorState {
  width: number;
  height: number;
  summary: {
    caption: string;
    meta: string[];
    canvas: CanvasKind | "";
    palette: string[];
  };
  items: EditorItem[];
  selectedId: string | null;
}

export const MAX_EDGE = 4096;

const ROOT_FIELDS = ["width", "height", "bbox_coord_space", "bbox_format", "summary", "items"];
const SUMMARY_FIELDS = ["caption", "meta", "canvas", "palette"];
const ITEM_FIELDS = ["label", "caption", "bbox", "text", "tags", "palette"];
const LABELS = new Set<Label>(["object", "character", "text"]);
const CANVASES = new Set<CanvasKind>(["single", "multi_panel", "collage"]);

let fallbackId = 1;

export function nextId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  fallbackId += 1;
  return `item-${fallbackId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isPyFloat(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], location: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
  if (unknown.length > 0) {
    throw new Error(`${location}: unknown fields ${formatPyList(unknown)}`);
  }
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isPyFloat(value) && Number.isFinite(value.value)) return value.value;
  return null;
}

function readEdge(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a positive integer multiple of 16`);
  }
  if (value <= 0 || value > MAX_EDGE) {
    throw new Error(`${name} must be between 1 and ${MAX_EDGE}`);
  }
  return value;
}

function readStringArray(value: unknown, location: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${location} must be an array of strings`);
  }
  return [...value];
}

function readItem(value: unknown, index: number): EditorItem {
  if (!isRecord(value)) throw new Error(`items[${index}] must be an object`);
  rejectUnknown(value, ITEM_FIELDS, `items[${index}]`);
  for (const key of ["label", "caption", "bbox"]) {
    if (!Object.hasOwn(value, key)) throw new Error(`items[${index}]: missing fields ['${key}']`);
  }
  if (!LABELS.has(value.label as Label)) {
    throw new Error(`items[${index}].label must be object, character or text`);
  }
  if (typeof value.caption !== "string") throw new Error(`items[${index}].caption must be text`);
  if (!Array.isArray(value.bbox) || value.bbox.length !== 4) {
    throw new Error(`items[${index}].bbox must be [x1,y1,x2,y2]`);
  }
  const coords = value.bbox.map(finiteNumber);
  if (coords.some((coord) => coord === null)) {
    throw new Error(`items[${index}].bbox must contain four finite numbers`);
  }
  const text = Object.hasOwn(value, "text") ? value.text : "";
  if (typeof text !== "string") throw new Error(`items[${index}].text must be text`);
  return {
    id: nextId(),
    label: value.label as Label,
    caption: value.caption,
    text,
    tags: Object.hasOwn(value, "tags") ? readStringArray(value.tags, `items[${index}].tags`) : [],
    palette: Object.hasOwn(value, "palette") ? readStringArray(value.palette, `items[${index}].palette`) : [],
    bbox: coords as Box,
  };
}

function readSummary(value: unknown): EditorState["summary"] {
  if (!isRecord(value)) throw new Error("summary must be an object");
  rejectUnknown(value, SUMMARY_FIELDS, "summary");
  if (typeof value.caption !== "string") throw new Error("summary.caption must be text");
  let canvas: CanvasKind | "" = "";
  if (Object.hasOwn(value, "canvas")) {
    if (!CANVASES.has(value.canvas as CanvasKind)) {
      throw new Error("summary.canvas must be single, multi_panel or collage");
    }
    canvas = value.canvas as CanvasKind;
  }
  return {
    caption: value.caption,
    meta: Object.hasOwn(value, "meta") ? readStringArray(value.meta, "summary.meta") : [],
    canvas,
    palette: Object.hasOwn(value, "palette") ? readStringArray(value.palette, "summary.palette") : [],
  };
}

export function blankState(): EditorState {
  return {
    width: 1024,
    height: 1024,
    summary: { caption: "", meta: [], canvas: "single", palette: [] },
    items: [],
    selectedId: null,
  };
}

/** Load an official layout draft. Empty captions and out-of-range boxes are kept for editing. */
export function editorFromDraft(value: unknown): EditorState {
  if (!isRecord(value)) throw new Error("Draft must be a JSON object");
  if (Object.hasOwn(value, "caption") && !Object.hasOwn(value, "summary")) {
    throw new Error("This JSON is a caption draft, not a layout draft. Layout drafts keep the caption inside summary.");
  }
  rejectUnknown(value, ROOT_FIELDS, "Layout draft");
  for (const key of ROOT_FIELDS) {
    if (!Object.hasOwn(value, key)) throw new Error(`Layout draft: missing fields ['${key}']`);
  }
  if (value.bbox_coord_space !== "abs") throw new Error("Draft bbox_coord_space must be abs");
  if (value.bbox_format !== "xyxy") throw new Error("Draft bbox_format must be xyxy");
  if (!Array.isArray(value.items)) throw new Error("items must be a nonempty flat array");
  const items = value.items.map((item, index) => readItem(item, index));
  const selected = items.find((item) => item.label === "text") ?? items[0] ?? null;
  return {
    width: readEdge(value.width, "width"),
    height: readEdge(value.height, "height"),
    summary: readSummary(value.summary),
    items,
    selectedId: selected?.id ?? null,
  };
}

export function isCompiledPrompt(value: unknown): boolean {
  return isRecord(value)
    && value.bbox_coord_space === "abs_centralized"
    && value.bbox_format === "yxyx";
}

function requireGenerationSize(width: number, height: number): void {
  for (const [name, value] of [["width", width], ["height", height]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0 || value % 16 !== 0) {
      throw new Error(`${name} must be a positive integer multiple of 16`);
    }
    if (value > MAX_EDGE) throw new Error(`${name} must be between 1 and ${MAX_EDGE}`);
  }
}

/**
 * Turn a compiled prompt back into a draft.
 * Center reversal uses the same integer half as the compiler (`width // 2`).
 * Edges that were enclosed with floor/ceil can grow by up to a pixel.
 */
export function editorFromCompiled(value: unknown, width: number, height: number): EditorState {
  if (!isRecord(value)) throw new Error("Compiled prompt must be a JSON object");
  if (value.bbox_coord_space !== "abs_centralized") {
    throw new Error("Compiled bbox_coord_space must be abs_centralized");
  }
  if (value.bbox_format !== "yxyx") throw new Error("Compiled bbox_format must be yxyx");
  requireGenerationSize(width, height);
  rejectUnknown(value, ["summary", "items", "bbox_coord_space", "bbox_format"], "Compiled prompt");
  if (!Array.isArray(value.items)) throw new Error("items must be a nonempty flat array");
  const originX = Math.floor(width / 2);
  const originY = Math.floor(height / 2);
  const items = value.items.map((item, index) => {
    if (!isRecord(item) || !Array.isArray(item.bbox) || item.bbox.length !== 4) {
      return readItem(item, index);
    }
    const [y1, x1, y2, x2] = item.bbox.map(finiteNumber);
    if (y1 == null || x1 == null || y2 == null || x2 == null) {
      throw new Error(`items[${index}].bbox must contain four finite numbers`);
    }
    return readItem({
      ...item,
      bbox: [x1 + originX, y1 + originY, x2 + originX, y2 + originY],
    }, index);
  });
  const selected = items.find((item) => item.label === "text") ?? items[0] ?? null;
  return {
    width,
    height,
    summary: readSummary(value.summary),
    items,
    selectedId: selected?.id ?? null,
  };
}

export function draftFromEditor(state: EditorState): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  if (state.summary.meta.length > 0) summary.meta = [...state.summary.meta];
  if (state.summary.canvas) summary.canvas = state.summary.canvas;
  if (state.summary.palette.length > 0) summary.palette = [...state.summary.palette];
  summary.caption = state.summary.caption;

  const items = state.items.map((item) => {
    const record: Record<string, unknown> = {
      label: item.label,
      caption: item.caption,
    };
    if (item.label === "text" || item.text.trim().length > 0) record.text = item.text;
    if (item.tags.length > 0) record.tags = [...item.tags];
    if (item.palette.length > 0) record.palette = [...item.palette];
    record.bbox = [...item.bbox];
    return record;
  });

  return {
    width: state.width,
    height: state.height,
    bbox_coord_space: "abs",
    bbox_format: "xyxy",
    summary,
    items,
  };
}

export function formatDraft(state: EditorState): string {
  return `${JSON.stringify(draftFromEditor(state), null, 2)}\n`;
}

export function cloneState(state: EditorState): EditorState {
  return structuredClone(state);
}

export function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

export function translateBox(
  bbox: Box,
  dx: number,
  dy: number,
  width: number,
  height: number,
  clamp: boolean,
  grid: number | null,
): Box {
  const boxWidth = bbox[2] - bbox[0];
  const boxHeight = bbox[3] - bbox[1];
  let x1 = bbox[0] + dx;
  let y1 = bbox[1] + dy;
  if (grid !== null && grid > 0) {
    x1 = snap(x1, grid);
    y1 = snap(y1, grid);
  } else {
    x1 = Math.round(x1);
    y1 = Math.round(y1);
  }
  let x2 = x1 + boxWidth;
  let y2 = y1 + boxHeight;
  if (grid === null) {
    x2 = Math.round(x2);
    y2 = Math.round(y2);
  }
  if (clamp && boxWidth <= width && boxHeight <= height) {
    if (x1 < 0) {
      x2 -= x1;
      x1 = 0;
    }
    if (y1 < 0) {
      y2 -= y1;
      y1 = 0;
    }
    if (x2 > width) {
      x1 -= x2 - width;
      x2 = width;
    }
    if (y2 > height) {
      y1 -= y2 - height;
      y2 = height;
    }
  }
  return [x1, y1, x2, y2];
}

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type Handle = (typeof HANDLES)[number];

export function resizeBox(
  start: Box,
  handle: Handle,
  dx: number,
  dy: number,
  width: number,
  height: number,
  clamp: boolean,
  grid: number | null,
): Box {
  const quantize = (value: number, limit: number) => {
    const snapped = grid !== null && grid > 0 ? snap(value, grid) : Math.round(value);
    if (!clamp) return snapped;
    return Math.min(limit, Math.max(0, snapped));
  };
  let x1 = start[0];
  let y1 = start[1];
  let x2 = start[2];
  let y2 = start[3];
  if (handle.includes("w")) x1 = quantize(start[0] + dx, width);
  if (handle.includes("e")) x2 = quantize(start[2] + dx, width);
  if (handle.includes("n")) y1 = quantize(start[1] + dy, height);
  if (handle.includes("s")) y2 = quantize(start[3] + dy, height);
  const minimum = grid !== null && grid > 0 ? grid : 1;
  if (x2 < x1 + minimum) {
    if (handle.includes("w") && !handle.includes("e")) x1 = x2 - minimum;
    else x2 = x1 + minimum;
  }
  if (y2 < y1 + minimum) {
    if (handle.includes("n") && !handle.includes("s")) y1 = y2 - minimum;
    else y2 = y1 + minimum;
  }
  if (clamp) {
    if (x1 < 0) x1 = 0;
    if (y1 < 0) y1 = 0;
    if (x2 > width) x2 = width;
    if (y2 > height) y2 = height;
    if (x2 < x1 + 1) x1 = Math.max(0, x2 - 1);
    if (y2 < y1 + 1) y1 = Math.max(0, y2 - 1);
  }
  return [x1, y1, x2, y2];
}

export function defaultPlacement(state: EditorState, slot: number): Box {
  const boxWidth = Math.max(32, Math.round(state.width * 0.28));
  const boxHeight = Math.max(32, Math.round(state.height * 0.12));
  const x1 = Math.min(state.width - boxWidth, 32 + (slot % 5) * 24);
  const y1 = Math.min(state.height - boxHeight, 32 + (slot % 5) * 24);
  return [x1, y1, x1 + boxWidth, y1 + boxHeight];
}
