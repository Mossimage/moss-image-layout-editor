import { describe, expect, it } from "vitest";
import { compilePrompt } from "../src/compile/compilePrompt.ts";
import { createExample, exampleDrafts, type ExampleName } from "../src/examples.ts";
import { draftFromEditor } from "../src/editor/model.ts";
import { canvasSizeForImage, scaleBox } from "../src/editor/reference.ts";

const DRAFT_KEYS = ["width", "height", "bbox_coord_space", "bbox_format", "summary", "items"];
const names = Object.keys(exampleDrafts) as ExampleName[];

describe("canvasSizeForImage", () => {
  it("uses the rounded natural size when both edges fit", () => {
    expect(canvasSizeForImage(1024.2, 1535.6)).toEqual({ width: 1024, height: 1536, clamped: false });
    expect(canvasSizeForImage(4096, 4096)).toEqual({ width: 4096, height: 4096, clamped: false });
  });

  it("scales both edges by the same factor when one is past the cap", () => {
    expect(canvasSizeForImage(8000, 2000)).toEqual({ width: 4096, height: 1024, clamped: true });
    expect(canvasSizeForImage(5000, 3000)).toEqual({ width: 4096, height: 2458, clamped: true });
  });

  it("keeps a rounded edge inside the cap", () => {
    const size = canvasSizeForImage(4096.6, 100);
    expect(size.clamped).toBe(true);
    expect(size.width).toBeLessThanOrEqual(4096);
    expect(size.height).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeLessThanOrEqual(4096);
  });

  it("rejects a non-positive size", () => {
    expect(() => canvasSizeForImage(0, 10)).toThrow(/positive/);
    expect(() => canvasSizeForImage(-4, 10)).toThrow(/positive/);
    expect(() => canvasSizeForImage(Number.NaN, 10)).toThrow(/positive/);
    expect(() => canvasSizeForImage(10, Number.POSITIVE_INFINITY)).toThrow(/positive/);
  });
});

describe("scaleBox", () => {
  it("scales each edge by the canvas ratio", () => {
    expect(scaleBox([10, 20, 30, 40], 100, 200, 300, 100)).toEqual([30, 10, 90, 20]);
  });

  it("rejects a non-positive source canvas", () => {
    expect(() => scaleBox([0, 0, 10, 10], 0, 100, 50, 50)).toThrow(/positive/);
  });
});

describe("reference images stay out of the draft", () => {
  it("exports official keys only, including after a proportional scale", () => {
    for (const name of names) {
      const state = createExample(name);
      const fromWidth = state.width;
      const fromHeight = state.height;
      const next = canvasSizeForImage(640, 480);
      state.width = next.width;
      state.height = next.height;
      for (const item of state.items) {
        item.bbox = scaleBox(item.bbox, fromWidth, fromHeight, next.width, next.height);
      }
      const exported = draftFromEditor(state);
      expect(Object.keys(exported)).toEqual(DRAFT_KEYS);
      const serialized = JSON.stringify(exported);
      expect(serialized).not.toContain("reference");
      expect(serialized).not.toContain("opacity");
      expect(serialized).not.toContain("data:");
      expect(compilePrompt(draftFromEditor(createExample(name)))).toBe(compilePrompt(exampleDrafts[name]));
    }
  });
});
