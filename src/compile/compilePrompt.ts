/**
 * Port of OpenMOSS/MOSS-Image
 * skills/moss-image-prompt-enhancer/scripts/compile_prompt.py
 * from commit a211e398a33cbf4dd7a1cc52aba0dfdbac3b0281
 * (Apache-2.0). That file's blob is ff7aaa85fa1b0ae4e97bb1ca5b698093dfdd5aee,
 * unchanged since 20f5592077916ec8d439bed7b34d18e45c20d657.
 *
 * https://github.com/OpenMOSS/MOSS-Image
 */
import { CompileError, formatPyList } from "./errors.ts";
import { isPyFloat } from "./json.ts";

const ROOT_FIELDS = ["width", "height", "bbox_coord_space", "bbox_format", "summary", "items"];
const SUMMARY_FIELDS = ["caption", "meta", "canvas", "palette"];
const ITEM_FIELDS = ["label", "caption", "bbox", "text", "tags", "palette"];
const LABELS = new Set(["object", "character", "text"]);
const CANVASES = new Set(["single", "multi_panel", "collage"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (isPyFloat(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function fields(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  location: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw new CompileError(`${location} must be an object`);
  const keys = Object.keys(value);
  const allowedSet = new Set(allowed);
  const unknown = keys.filter((key) => !allowedSet.has(key)).sort();
  const present = new Set(keys);
  const missing = required.filter((key) => !present.has(key)).sort();
  if (unknown.length > 0) {
    throw new CompileError(`${location}: unknown fields ${formatPyList(unknown)}`);
  }
  if (missing.length > 0) {
    throw new CompileError(`${location}: missing fields ${formatPyList(missing)}`);
  }
  return value;
}

function text(value: unknown, location: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CompileError(`${location} must be nonempty text`);
  }
}

function strings(value: unknown, location: string): void {
  if (!Array.isArray(value)) throw new CompileError(`${location} must be an array`);
  value.forEach((item, index) => text(item, `${location}[${index}]`));
}

function readFinite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isPyFloat(value) && Number.isFinite(value.value)) return value.value;
  return null;
}

/**
 * floor/ceil of Python `round(x, 9)`.
 *
 * CPython rounds a binary64 value half-even to 9 decimal places via its
 * correctly rounded decimal conversion. The same integer result is the
 * half-even rounding of the exact rational value of the double, in units
 * of 1e-9. That matches `math.floor(round(x, 9))` / `math.ceil` for the
 * coordinates this compiler accepts.
 */
function floorAndCeilOfRound9(x: number): { floor: number; ceil: number } {
  if (x === 0) return { floor: 0, ceil: 0 };
  const sign = x < 0 ? -1 : 1;
  const magnitude = Math.abs(x);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, magnitude);
  const bits = (BigInt(view.getUint32(0)) << 32n) | BigInt(view.getUint32(4));
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  let mantissa: bigint;
  let binaryExponent: number;
  if (exponentBits === 0) {
    if (fraction === 0n) return { floor: 0, ceil: 0 };
    mantissa = fraction;
    binaryExponent = -1074;
  } else {
    mantissa = fraction | (1n << 52n);
    binaryExponent = exponentBits - 1023 - 52;
  }

  let lower: bigint;
  let upper: bigint;
  if (binaryExponent >= 0) {
    const integer = mantissa << BigInt(binaryExponent);
    lower = integer;
    upper = integer;
  } else {
    const denominator = 1n << BigInt(-binaryExponent);
    const numerator = mantissa * 1_000_000_000n;
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    const twice = remainder * 2n;
    let scaled: bigint;
    if (twice < denominator) scaled = quotient;
    else if (twice > denominator) scaled = quotient + 1n;
    else scaled = quotient % 2n === 0n ? quotient : quotient + 1n;
    const scale = 1_000_000_000n;
    const whole = scaled / scale;
    const fractionPart = scaled % scale;
    if (fractionPart === 0n) {
      lower = whole;
      upper = whole;
    } else {
      lower = whole;
      upper = whole + 1n;
    }
  }

  const floor = sign < 0 ? -upper : lower;
  const ceil = sign < 0 ? -lower : upper;
  if (floor > BigInt(Number.MAX_SAFE_INTEGER) || ceil > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CompileError("coordinate is outside the safe integer range");
  }
  return { floor: Number(floor), ceil: Number(ceil) };
}

export function centeredBox(box: unknown, width: number, height: number, location: string): number[] {
  if (!Array.isArray(box) || box.length !== 4) {
    throw new CompileError(`${location} must be [x1,y1,x2,y2]`);
  }
  const numbers = box.map(readFinite);
  if (numbers.some((value) => value === null)) {
    throw new CompileError(`${location} must contain four finite numbers`);
  }
  const [x1, y1, x2, y2] = numbers as number[];
  if (!(x1 < x2 && y1 < y2)) {
    throw new CompileError(`${location} must have positive width and height`);
  }
  if (!(0 <= x1 && x1 < x2 && x2 <= width && 0 <= y1 && y1 < y2 && y2 <= height)) {
    throw new CompileError(`${location} exceeds the ${width}x${height} canvas`);
  }
  const result = [
    floorAndCeilOfRound9(y1).floor - Math.floor(height / 2),
    floorAndCeilOfRound9(x1).floor - Math.floor(width / 2),
    floorAndCeilOfRound9(y2).ceil - Math.floor(height / 2),
    floorAndCeilOfRound9(x2).ceil - Math.floor(width / 2),
  ];
  if (!(result[0] < result[2] && result[1] < result[3])) {
    throw new CompileError(`${location} is too small at export precision`);
  }
  return result;
}

function requireDimension(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value % 16 !== 0) {
    throw new CompileError(`${name} must be a positive integer multiple of 16`);
  }
  return value;
}

/**
 * Compile a caption draft or an absolute-pixel layout draft.
 * Caption drafts return the caption string. Layout drafts return one line of JSON.
 */
export function compilePrompt(draft: unknown): string {
  if (!isRecord(draft)) throw new CompileError("Draft must be a JSON object");
  if (Object.hasOwn(draft, "caption")) {
    fields(draft, ["caption"], ["caption"], "Caption draft");
    text(draft.caption, "caption");
    return draft.caption as string;
  }

  fields(draft, ROOT_FIELDS, ROOT_FIELDS, "Layout draft");
  const width = requireDimension(draft.width, "width");
  const height = requireDimension(draft.height, "height");
  if (draft.bbox_coord_space !== "abs") throw new CompileError("Draft bbox_coord_space must be abs");
  if (draft.bbox_format !== "xyxy") throw new CompileError("Draft bbox_format must be xyxy");

  const summary = fields(draft.summary, SUMMARY_FIELDS, ["caption"], "summary");
  text(summary.caption, "summary.caption");
  if (Object.hasOwn(summary, "canvas") && !CANVASES.has(String(summary.canvas))) {
    throw new CompileError("summary.canvas must be single, multi_panel or collage");
  }
  for (const key of ["meta", "palette"] as const) {
    if (Object.hasOwn(summary, key)) strings(summary[key], `summary.${key}`);
  }

  const items = draft.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new CompileError("items must be a nonempty flat array");
  }

  const compiledItems = items.map((item, index) => {
    const location = `items[${index}]`;
    const record = fields(item, ITEM_FIELDS, ["label", "caption", "bbox"], location);
    if (!LABELS.has(String(record.label))) {
      throw new CompileError(`${location}.label must be object, character or text`);
    }
    text(record.caption, `${location}.caption`);
    if (record.label === "text" && !Object.hasOwn(record, "text")) {
      throw new CompileError(`${location}: text items require literal text`);
    }
    if (Object.hasOwn(record, "text")) text(record.text, `${location}.text`);
    for (const key of ["tags", "palette"] as const) {
      if (Object.hasOwn(record, key)) strings(record[key], `${location}.${key}`);
    }
    const compiled: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      compiled[key] = key === "bbox"
        ? centeredBox(record.bbox, width, height, `${location}.bbox`)
        : record[key];
    }
    return compiled;
  });

  const summaryOut: Record<string, unknown> = {};
  for (const key of Object.keys(summary)) summaryOut[key] = summary[key];
  return JSON.stringify({
    summary: summaryOut,
    items: compiledItems,
    bbox_coord_space: "abs_centralized",
    bbox_format: "yxyx",
  });
}

export function boxError(box: unknown, width: number, height: number): string | null {
  try {
    centeredBox(box, width, height, "bbox");
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
