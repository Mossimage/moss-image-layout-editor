import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/cli.ts";
import { centeredBox, compilePrompt } from "../src/compile/compilePrompt.ts";
import { CompileError } from "../src/compile/errors.ts";
import { parseDraftJson, PyFloat } from "../src/compile/json.ts";

/**
 * Port of OpenMOSS/MOSS-Image
 * skills/moss-image-prompt-enhancer/scripts/test_compile_prompt.py
 * at commit a211e398a33cbf4dd7a1cc52aba0dfdbac3b0281.
 */

function landscapeDraft() {
  return {
    width: 1536,
    height: 1024,
    bbox_coord_space: "abs",
    bbox_format: "xyxy",
    summary: { meta: ["poster"], canvas: "single", caption: "A ceramic campaign." },
    items: [{
      label: "text",
      caption: "Dark-green lettering.",
      text: "把日常，过成诗。\n\"MOSS\" 🪴",
      bbox: [928, 272, 1408, 448],
    }],
  };
}

const GOLDEN = "{\"summary\":{\"meta\":[\"poster\"],\"canvas\":\"single\",\"caption\":\"A ceramic campaign.\"},\"items\":[{\"label\":\"text\",\"caption\":\"Dark-green lettering.\",\"text\":\"把日常，过成诗。\\n\\\"MOSS\\\" 🪴\",\"bbox\":[-240,160,-64,640]}],\"bbox_coord_space\":\"abs_centralized\",\"bbox_format\":\"yxyx\"}";

function capture(): { io: CliIo; text(): { stdout: string; stderr: string } } {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: { write(chunk: string) { stdout += chunk; } },
      stderr: { write(chunk: string) { stderr += chunk; } },
    },
    text: () => ({ stdout, stderr }),
  };
}

describe("compile_prompt.py cases", () => {
  it("converts a landscape draft without changing the source", () => {
    const draft = landscapeDraft();
    const before = structuredClone(draft);
    const serialized = compilePrompt(draft);
    const result = JSON.parse(serialized) as {
      items: { bbox: number[]; text: string }[];
      summary: unknown;
      bbox_coord_space: string;
      bbox_format: string;
    };
    expect(result.items[0]?.bbox).toEqual([-240, 160, -64, 640]);
    expect(result.items[0]?.text).toBe(draft.items[0]?.text);
    expect(result.summary).toEqual(draft.summary);
    expect(result.bbox_coord_space).toBe("abs_centralized");
    expect(result.bbox_format).toBe("yxyx");
    expect(result).not.toHaveProperty("width");
    expect(result).not.toHaveProperty("height");
    expect(serialized).not.toContain("\n");
    expect(serialized).toBe(GOLDEN);
    expect(draft).toEqual(before);
  });

  it("encloses portrait edges and fractional edges the way CPython round(x, 9) does", () => {
    expect(centeredBox([0, 0, 768, 1344], 768, 1344, "box")).toEqual([-672, -384, 672, 384]);
    expect(centeredBox([10.9, 20.1, 100.01, 200.99], 768, 1344, "box")).toEqual([-652, -374, -471, -283]);
    expect(centeredBox([1.00000000001, 2, 100, 200], 768, 1344, "box")).toEqual([-670, -383, -472, -284]);
    // These two differ from a binary round(x * 1e9) / 1e9 implementation.
    expect(centeredBox([0, 0, 1.0000000005, 10], 768, 1024, "box")).toEqual([-512, -384, -502, -382]);
    expect(centeredBox([0, 8.9999999995, 10, 10], 768, 1024, "box")).toEqual([-504, -384, -502, -374]);
  });

  it("matches the cup conversion documented in layout.md", () => {
    const serialized = compilePrompt({
      width: 1536,
      height: 1024,
      bbox_coord_space: "abs",
      bbox_format: "xyxy",
      summary: { caption: "A warm studio campaign for a handmade ceramic cup." },
      items: [{
        label: "object",
        caption: "An ivory ceramic cup with a rounded handle.",
        bbox: [176, 224, 800, 864],
      }],
    });
    expect(JSON.parse(serialized).items[0].bbox).toEqual([-288, -592, 352, 32]);
  });

  it("rejects invalid geometry", () => {
    const cases = [
      [-1, 0, 100, 100],
      [0, 0, 1537, 100],
      [0, 0, 100, 1025],
      [100, 0, 50, 100],
      [0, 0, 0, 100],
      [0, 0, 100],
      [true, 0, 100, 100],
      [0, 0, Number.NaN, 100],
      [0, 0, Number.POSITIVE_INFINITY, 100],
      [0, 0, "100", 100],
      [0, 0, 0.00000000001, 100],
    ];
    for (const box of cases) {
      expect(() => centeredBox(box, 1536, 1024, "box"), JSON.stringify(box)).toThrow(CompileError);
    }
  });

  it("rejects invalid dimensions and coordinate conventions", () => {
    const replacements: [string, unknown][] = [
      ["width", 1023],
      ["height", 0],
      ["width", true],
      ["bbox_coord_space", "abs_centralized"],
      ["bbox_coord_space", "normalized_1000"],
      ["bbox_format", "yxyx"],
    ];
    for (const [field, value] of replacements) {
      const draft = landscapeDraft() as Record<string, unknown>;
      draft[field] = value;
      expect(() => compilePrompt(draft), `${field}=${String(value)}`).toThrow(CompileError);
    }

    // Python `1024.0` is a float. JSON text keeps that distinction; JS numbers do not.
    const parsed = parseDraftJson(JSON.stringify(landscapeDraft()).replace("\"height\":1024", "\"height\":1024.0"));
    expect((parsed as { height: unknown }).height).toBeInstanceOf(PyFloat);
    expect(() => compilePrompt(parsed)).toThrow(/height must be a positive integer multiple of 16/);
  });

  it("does not drop fields the compiler cannot represent", () => {
    for (const [field, value] of [
      ["children", [{ bbox: [0, 0, 20, 20] }]],
      ["font_size", 32],
      ["parent", "cup"],
    ] as const) {
      const draft = landscapeDraft();
      (draft.items[0] as Record<string, unknown>)[field] = value;
      expect(() => compilePrompt(draft), field).toThrow(CompileError);
    }
    const missing = landscapeDraft();
    delete (missing.items[0] as { text?: string }).text;
    expect(() => compilePrompt(missing)).toThrow(/literal text/);
  });

  it("returns caption drafts as plain text and keeps the wording", () => {
    const caption = "An ivory cup marked \"茶\".\nPreserve this second line.";
    expect(compilePrompt({ caption })).toBe(caption);
    for (const draft of [{ caption: "" }, { caption, items: [] }]) {
      expect(() => compilePrompt(draft)).toThrow(CompileError);
    }
  });

  it("keeps optional tags and palette in input order", () => {
    const draft = landscapeDraft();
    draft.summary = {
      meta: ["poster"],
      canvas: "single",
      caption: "A ceramic campaign.",
      palette: ["ivory", "dark green"],
    } as typeof draft.summary & { palette: string[] };
    const item = {
      label: "text" as const,
      caption: "Dark-green lettering.",
      text: draft.items[0]!.text,
      tags: ["handwritten"],
      palette: ["dark green"],
      bbox: [928, 272, 1408, 448] as [number, number, number, number],
    };
    draft.items[0] = item;
    const serialized = compilePrompt(draft);
    expect(serialized).not.toContain("\n");
    const parsed = JSON.parse(serialized);
    expect(parsed.summary.palette).toEqual(["ivory", "dark green"]);
    expect(parsed.items[0].tags).toEqual(["handwritten"]);
    expect(parsed.items[0].palette).toEqual(["dark green"]);
    expect(parsed.items[0].bbox).toEqual([-240, 160, -64, 640]);
    expect(serialized.indexOf("\"tags\"")).toBeGreaterThan(serialized.indexOf("\"text\""));
  });
});

describe("compile_prompt.py CLI cases", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function tempDir(): string {
    const directory = mkdtempSync(path.join(tmpdir(), "moss-layout-"));
    directories.push(directory);
    return directory;
  }

  it("writes output without overwriting the draft", () => {
    const directory = tempDir();
    const source = path.join(directory, "draft.json");
    const target = path.join(directory, "prompt.txt");
    const draft = landscapeDraft();
    const original = JSON.stringify(draft, null, 2);
    writeFileSync(source, original, "utf-8");
    const logs = capture();
    const code = runCli([source, "--output", target], logs.io);
    expect(code, logs.text().stderr).toBe(0);
    expect(logs.text().stdout).toBe("");
    expect(JSON.parse(readFileSync(target, "utf-8")).items[0].text).toBe(draft.items[0]?.text);
    expect(readFileSync(source, "utf-8")).toBe(original);

    const again = capture();
    const blocked = runCli([source, "--output", source], again.io);
    expect(blocked).not.toBe(0);
    expect(readFileSync(source, "utf-8")).toBe(original);
  });

  it("rejects duplicate keys and nonfinite constants without touching the output", () => {
    const cases = [
      "{\"caption\":\"one\",\"caption\":\"two\"}",
      "{\"caption\":NaN}",
      "{\"caption\":Infinity}",
    ];
    const directory = tempDir();
    const source = path.join(directory, "draft.json");
    const target = path.join(directory, "prompt.txt");
    writeFileSync(target, "existing result", "utf-8");
    for (const value of cases) {
      writeFileSync(source, value, "utf-8");
      const logs = capture();
      const code = runCli([source, "--output", target], logs.io);
      expect(code, value).not.toBe(0);
      expect(readFileSync(target, "utf-8")).toBe("existing result");
    }
  });

  it("runs as a script the way the Python module does", () => {
    const directory = tempDir();
    const source = path.join(directory, "draft.json");
    const target = path.join(directory, "prompt.txt");
    writeFileSync(source, JSON.stringify(landscapeDraft()), "utf-8");
    const root = fileURLToPath(new URL("..", import.meta.url));
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", path.join(root, "src/cli.ts"), source, "--output", target],
      { cwd: root, encoding: "utf-8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("");
    expect(readFileSync(target, "utf-8").trim()).toBe(GOLDEN);
  });
});
