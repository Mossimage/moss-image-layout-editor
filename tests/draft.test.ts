import { describe, expect, it } from "vitest";
import { compilePrompt } from "../src/compile/compilePrompt.ts";
import { parseDraftJson } from "../src/compile/json.ts";
import { createExample, exampleDrafts, type ExampleName } from "../src/examples.ts";
import {
  draftFromEditor,
  editorFromCompiled,
  editorFromDraft,
  isCompiledPrompt,
  resizeBox,
  translateBox,
} from "../src/editor/model.ts";

const names = Object.keys(exampleDrafts) as ExampleName[];

describe("built-in drafts", () => {
  it.each(names)("compiles %s in the official layout schema", (name) => {
    const draft = exampleDrafts[name];
    const serialized = compilePrompt(draft);
    expect(serialized).not.toContain("\n");
    const compiled = JSON.parse(serialized) as {
      bbox_coord_space: string;
      bbox_format: string;
      items: { label: string; text?: string; bbox: number[] }[];
    };
    expect(compiled.bbox_coord_space).toBe("abs_centralized");
    expect(compiled.bbox_format).toBe("yxyx");
    expect(compiled).not.toHaveProperty("width");
    expect(compiled).not.toHaveProperty("height");
    const sourceText = draft.items.filter((item) => item.label === "text").map((item) => item.text);
    const compiledText = compiled.items.filter((item) => item.label === "text").map((item) => item.text);
    expect(compiledText).toEqual(sourceText);
    for (const item of compiled.items) {
      expect(item.bbox).toHaveLength(4);
      expect(item.bbox[0]).toBeLessThan(item.bbox[2]!);
      expect(item.bbox[1]).toBeLessThan(item.bbox[3]!);
    }
  });

  it("round-trips a draft through the editor and keeps boxes", () => {
    for (const name of names) {
      const loaded = editorFromDraft(exampleDrafts[name]);
      const exported = draftFromEditor(loaded);
      expect(exported.width).toBe(exampleDrafts[name].width);
      expect(exported.height).toBe(exampleDrafts[name].height);
      expect(exported.bbox_coord_space).toBe("abs");
      expect(exported.bbox_format).toBe("xyxy");
      const again = editorFromDraft(parseDraftJson(JSON.stringify(exported)));
      expect(again.items.map((item) => item.bbox)).toEqual(loaded.items.map((item) => item.bbox));
      expect(again.items.map((item) => item.text)).toEqual(loaded.items.map((item) => item.text));
      expect(compilePrompt(exported)).toBe(compilePrompt(exampleDrafts[name]));
    }
  });

  it("does not rescale boxes when the canvas size changes", () => {
    const state = createExample("poster");
    const before = state.items.map((item) => [...item.bbox]);
    state.width = 768;
    expect(state.items.map((item) => item.bbox)).toEqual(before);
  });

  it("turns a compiled prompt back into the integer draft boxes", () => {
    const draft = exampleDrafts.poster;
    const compiled = JSON.parse(compilePrompt(draft));
    expect(isCompiledPrompt(compiled)).toBe(true);
    const restored = editorFromCompiled(compiled, draft.width, draft.height);
    expect(restored.items.map((item) => item.bbox)).toEqual(draft.items.map((item) => item.bbox));
    expect(restored.items.map((item) => item.text)).toEqual(
      draft.items.map((item) => ("text" in item ? item.text : "")),
    );
  });

  it("refuses unknown draft fields instead of dropping them", () => {
    const draft = structuredClone(exampleDrafts.cover);
    (draft as { id?: string }).id = "editor-1";
    expect(() => editorFromDraft(draft)).toThrow(/unknown fields/);
  });

  it("clamps a move that would leave the canvas", () => {
    expect(translateBox([10, 20, 110, 80], -40, -50, 1024, 1024, true, null)).toEqual([0, 0, 100, 60]);
    expect(translateBox([900, 20, 1000, 80], 80, 0, 1024, 1024, true, null)).toEqual([924, 20, 1024, 80]);
  });

  it("resizes from the east edge and keeps the box inside", () => {
    expect(resizeBox([10, 20, 110, 80], "e", 15.2, 0, 1024, 1024, true, null)).toEqual([10, 20, 125, 80]);
    expect(resizeBox([10, 20, 110, 80], "e", 5000, 0, 200, 200, true, null)).toEqual([10, 20, 200, 80]);
  });
});
