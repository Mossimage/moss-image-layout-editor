import "@fontsource/figtree/latin-400.css";
import "@fontsource/figtree/latin-500.css";
import "@fontsource/figtree/latin-600.css";
import "@fontsource/fraunces/latin-600.css";
import "@fontsource/fraunces/latin-600-italic.css";
import "./styles.css";
import { boxError, compilePrompt } from "./compile/compilePrompt.ts";
import { parseDraftJson } from "./compile/json.ts";
import { createExample, exampleLabels, type ExampleName } from "./examples.ts";
import { History } from "./editor/history.ts";
import {
  MAX_EDGE,
  cloneState,
  defaultPlacement,
  draftFromEditor,
  editorFromCompiled,
  editorFromDraft,
  formatDraft,
  isCompiledPrompt,
  nextId,
  resizeBox,
  translateBox,
  type Box,
  type CanvasKind,
  type EditorItem,
  type EditorState,
  type Handle,
  type Label,
} from "./editor/model.ts";

const STORAGE_KEY = "moss-image-layout-editor/v1";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

interface Gesture {
  kind: "move" | "resize" | "draw";
  pointerId: number;
  startX: number;
  startY: number;
  before: EditorState;
  id?: string;
  handle?: Handle;
  startBbox?: Box;
  label?: Label;
  created: boolean;
}

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) throw new Error("Missing #app");

root.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark">Moss</span>
      <span class="brand-sub">Layout</span>
    </div>
    <div class="size">
      <label>Width <input id="canvas-width" type="number" min="1" max="${MAX_EDGE}" step="16" /></label>
      <label>Height <input id="canvas-height" type="number" min="1" max="${MAX_EDGE}" step="16" /></label>
      <select id="size-preset" aria-label="Canvas size presets">
        <option value="">Preset</option>
        <option value="1024x1024">1024 × 1024</option>
        <option value="1024x1536">1024 × 1536</option>
        <option value="1536x1024">1536 × 1024</option>
        <option value="768x1152">768 × 1152</option>
        <option value="768x1344">768 × 1344</option>
        <option value="1344x768">1344 × 768</option>
      </select>
    </div>
    <div class="top-actions">
      <select id="example-select" aria-label="Example layouts">
        <option value="">Examples</option>
        <option value="poster">Poster</option>
        <option value="menu">Menu</option>
        <option value="comic">Comic</option>
        <option value="cover">Book cover</option>
        <option value="blank">Blank canvas</option>
      </select>
      <button id="undo" type="button">Undo</button>
      <button id="redo" type="button">Redo</button>
      <button id="import-open" type="button">Import</button>
      <button id="export-draft" type="button">Export draft</button>
      <button id="copy-prompt" type="button" class="primary">Copy prompt</button>
    </div>
    <div id="status" class="status" role="status"></div>
  </header>
  <aside class="panel left">
    <section>
      <h2>Summary</h2>
      <label class="field">Caption
        <textarea id="summary-caption" rows="5"></textarea>
      </label>
      <label class="field">Canvas
        <select id="summary-canvas">
          <option value="">Unspecified</option>
          <option value="single">single</option>
          <option value="multi_panel">multi_panel</option>
          <option value="collage">collage</option>
        </select>
      </label>
      <div class="field"><span>Meta</span><div id="meta-chips" class="chips"></div></div>
      <div class="field"><span>Palette</span><div id="summary-palette" class="chips"></div></div>
    </section>
    <section>
      <div class="list-head">Items, back to front</div>
      <div id="item-list" class="item-list"></div>
      <div class="add-row">
        <button id="add-object" type="button">Add object</button>
        <button id="add-character" type="button">Add character</button>
        <button id="add-text" type="button">Add text</button>
      </div>
    </section>
    <section id="inspector" class="inspector">
      <h2>Box</h2>
      <p id="inspector-empty" class="hint">Select a box, or drag on the canvas.</p>
      <div id="inspector-form">
        <label class="field">Label
          <select id="item-label">
            <option value="object">object</option>
            <option value="character">character</option>
            <option value="text">text</option>
          </select>
        </label>
        <label class="field">Caption
          <textarea id="item-caption" rows="4"></textarea>
        </label>
        <label class="field">Literal text
          <textarea id="item-text" rows="3" spellcheck="false" placeholder="Required for text boxes. Use real line breaks."></textarea>
        </label>
        <p id="text-hint" class="hint"></p>
        <div class="field"><span>Tags</span><div id="item-tags" class="chips"></div></div>
        <div class="field"><span>Palette</span><div id="item-palette" class="chips"></div></div>
        <div class="bbox-grid">
          <label>X <input id="box-x" type="number" step="1" /></label>
          <label>Y <input id="box-y" type="number" step="1" /></label>
          <label>W <input id="box-w" type="number" step="1" /></label>
          <label>H <input id="box-h" type="number" step="1" /></label>
        </div>
        <p id="box-compiled" class="hint"></p>
        <div class="inspector-actions">
          <button id="send-back" type="button">Send backward</button>
          <button id="bring-forward" type="button">Bring forward</button>
          <button id="duplicate" type="button">Duplicate</button>
          <button id="delete-item" type="button" class="danger">Delete</button>
        </div>
      </div>
    </section>
    <details class="shortcuts">
      <summary>Shortcuts</summary>
      <p class="hint">Drag empty canvas to draw. Shift draws text, Alt draws a character. Arrows nudge by 1px, Shift+arrows by 16. Delete removes. Ctrl+Z undoes, Ctrl+Shift+Z redoes, Ctrl+D duplicates. [ and ] reorder.</p>
    </details>
  </aside>
  <main class="center">
    <div class="toolbar">
      <span class="hint">Boxes mark placement. They are not instructions to draw a frame.</span>
      <label class="check"><input id="snap" type="checkbox" /> Snap 16</label>
      <label class="check"><input id="clamp" type="checkbox" checked /> Clamp</label>
      <div class="zoom">
        <button id="zoom-out" type="button" aria-label="Zoom out">−</button>
        <span id="zoom-label">100%</span>
        <button id="zoom-in" type="button" aria-label="Zoom in">+</button>
        <button id="zoom-fit" type="button">Fit</button>
      </div>
    </div>
    <div id="viewport" class="viewport">
      <div class="viewport-inner">
        <div id="world" class="world">
          <div id="canvas" class="canvas"></div>
        </div>
      </div>
      <div id="hud" class="hud"></div>
    </div>
  </main>
  <aside class="panel right">
    <h2>Compiled prompt</h2>
    <p id="prompt-meta" class="hint"></p>
    <p id="prompt-error" class="error" hidden></p>
    <textarea id="prompt-out" class="prompt-text" readonly spellcheck="false" aria-label="Compiled prompt"></textarea>
    <div class="row">
      <button id="copy-prompt-side" type="button" class="primary">Copy prompt</button>
      <button id="copy-draft" type="button">Copy draft JSON</button>
    </div>
    <details>
      <summary>Draft JSON</summary>
      <textarea id="draft-out" readonly spellcheck="false" rows="12" aria-label="Draft JSON"></textarea>
    </details>
  </aside>
  <dialog id="import-dialog">
    <h2>Import JSON</h2>
    <p id="import-help" class="hint">Paste a layout draft (<code>abs</code> / <code>xyxy</code>) or a compiled prompt (<code>abs_centralized</code> / <code>yxyx</code>).</p>
    <p id="import-error" class="error" hidden></p>
    <textarea id="import-text" spellcheck="false" placeholder='{"width": 1024, "height": 1024, ...}'></textarea>
    <div id="compiled-size" hidden>
      <p class="hint">This file is a compiled prompt, so width and height are not in it. Enter the canvas those boxes were centered on. Reversing floor/ceil can grow an edge by up to a pixel.</p>
      <div class="row">
        <label>Width <input id="compiled-width" type="number" min="16" step="16" /></label>
        <label>Height <input id="compiled-height" type="number" min="16" step="16" /></label>
      </div>
    </div>
    <div class="row">
      <label class="file-btn">Choose file <input id="import-file" type="file" accept="application/json,.json" /></label>
      <button id="import-cancel" type="button">Cancel</button>
      <button id="import-apply" type="button" class="primary">Import</button>
    </div>
  </dialog>
`;

const $ = <T extends Element>(selector: string) => {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`Missing ${selector}`);
  return node as T;
};

const widthInput = $<HTMLInputElement>("#canvas-width");
const heightInput = $<HTMLInputElement>("#canvas-height");
const presetSelect = $<HTMLSelectElement>("#size-preset");
const exampleSelect = $<HTMLSelectElement>("#example-select");
const undoButton = $<HTMLButtonElement>("#undo");
const redoButton = $<HTMLButtonElement>("#redo");
const status = $<HTMLElement>("#status");
const summaryCaption = $<HTMLTextAreaElement>("#summary-caption");
const summaryCanvas = $<HTMLSelectElement>("#summary-canvas");
const metaChips = $<HTMLElement>("#meta-chips");
const summaryPalette = $<HTMLElement>("#summary-palette");
const itemList = $<HTMLElement>("#item-list");
const inspectorForm = $<HTMLElement>("#inspector-form");
const inspectorEmpty = $<HTMLElement>("#inspector-empty");
const itemLabel = $<HTMLSelectElement>("#item-label");
const itemCaption = $<HTMLTextAreaElement>("#item-caption");
const itemText = $<HTMLTextAreaElement>("#item-text");
const textHint = $<HTMLElement>("#text-hint");
const itemTags = $<HTMLElement>("#item-tags");
const itemPalette = $<HTMLElement>("#item-palette");
const boxX = $<HTMLInputElement>("#box-x");
const boxY = $<HTMLInputElement>("#box-y");
const boxW = $<HTMLInputElement>("#box-w");
const boxH = $<HTMLInputElement>("#box-h");
const boxCompiled = $<HTMLElement>("#box-compiled");
const canvas = $<HTMLElement>("#canvas");
const world = $<HTMLElement>("#world");
const viewport = $<HTMLElement>("#viewport");
const hud = $<HTMLElement>("#hud");
const zoomLabel = $<HTMLElement>("#zoom-label");
const snapInput = $<HTMLInputElement>("#snap");
const clampInput = $<HTMLInputElement>("#clamp");
const promptOut = $<HTMLTextAreaElement>("#prompt-out");
const promptError = $<HTMLElement>("#prompt-error");
const promptMeta = $<HTMLElement>("#prompt-meta");
const draftOut = $<HTMLTextAreaElement>("#draft-out");
const copyPromptButtons = [
  $<HTMLButtonElement>("#copy-prompt"),
  $<HTMLButtonElement>("#copy-prompt-side"),
];
const importDialog = $<HTMLDialogElement>("#import-dialog");
const importText = $<HTMLTextAreaElement>("#import-text");
const importError = $<HTMLElement>("#import-error");
const importHelp = $<HTMLElement>("#import-help");
const compiledSize = $<HTMLElement>("#compiled-size");
const compiledWidth = $<HTMLInputElement>("#compiled-width");
const compiledHeight = $<HTMLInputElement>("#compiled-height");

let state = loadInitial();
const history = new History();
let zoom = 1;
let zoomMode: "fit" | "manual" = "fit";
let gesture: Gesture | null = null;
let typingBefore: EditorState | null = null;
let saveTimer = 0;

function loadInitial(): EditorState {
  const param = new URLSearchParams(location.search).get("example");
  if (param === "blank" || param === "poster" || param === "menu" || param === "comic" || param === "cover") {
    return createExample(param);
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as { draft?: unknown; selectedIndex?: number };
      const revived = editorFromDraft(stored.draft);
      if (typeof stored.selectedIndex === "number" && revived.items[stored.selectedIndex]) {
        revived.selectedId = revived.items[stored.selectedIndex]!.id;
      }
      return revived;
    }
  } catch {
    /* keep the poster if storage is unreadable */
  }
  return createExample("poster");
}

function selected(): EditorItem | undefined {
  return state.items.find((item) => item.id === state.selectedId);
}

function signature(value: EditorState): string {
  return JSON.stringify(draftFromEditor(value));
}

function commitTyping(): void {
  if (!typingBefore) return;
  const before = typingBefore;
  typingBefore = null;
  if (signature(before) !== signature(state)) history.push(before);
}

function edit(mutator: () => void): void {
  commitTyping();
  const before = cloneState(state);
  mutator();
  if (signature(before) !== signature(state)) history.push(before);
  sync();
}

function onType(mutator: () => void): void {
  if (!typingBefore) typingBefore = cloneState(state);
  mutator();
  sync();
}

function flash(message: string): void {
  status.textContent = message;
  window.setTimeout(() => {
    if (status.textContent === message) status.textContent = "";
  }, 1600);
}

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      const selectedIndex = state.items.findIndex((item) => item.id === state.selectedId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        draft: draftFromEditor(state),
        selectedIndex,
      }));
    } catch {
      /* private mode and full storage can reject writes */
    }
  }, 150);
}

function clampOn(): boolean {
  return clampInput.checked;
}

function grid(): number | null {
  return snapInput.checked ? 16 : null;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1000) / 1000);
}

function setIfIdle(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  if (document.activeElement === input) return;
  if (input.value !== value) input.value = value;
}

function mountChips(container: HTMLElement, getValues: () => string[], setValues: (values: string[]) => void): () => void {
  return () => {
    const values = getValues();
    const sig = JSON.stringify(values);
    if (container.dataset.sig === sig) return;
    const wasFocused = container.contains(document.activeElement);
    container.dataset.sig = sig;
    container.replaceChildren();
    values.forEach((value, index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = value;
      chip.setAttribute("aria-label", `Remove ${value}`);
      chip.addEventListener("click", () => {
        setValues(getValues().filter((_, chipIndex) => chipIndex !== index));
      });
      container.append(chip);
    });
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Add";
    input.setAttribute("aria-label", "Add value");
    input.spellcheck = false;
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === ",") {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        setValues([...getValues(), text]);
      } else if (event.key === "Backspace" && input.value === "") {
        const current = getValues();
        if (current.length > 0) setValues(current.slice(0, -1));
      }
    });
    container.append(input);
    if (wasFocused && container.offsetParent !== null) input.focus();
  };
}

const syncMeta = mountChips(metaChips, () => state.summary.meta, (meta) => {
  edit(() => { state.summary.meta = meta; });
});
const syncSummaryPalette = mountChips(summaryPalette, () => state.summary.palette, (palette) => {
  edit(() => { state.summary.palette = palette; });
});
const syncTags = mountChips(itemTags, () => selected()?.tags ?? [], (tags) => {
  const item = selected();
  if (!item) return;
  edit(() => { item.tags = tags; });
});
const syncItemPalette = mountChips(itemPalette, () => selected()?.palette ?? [], (palette) => {
  const item = selected();
  if (!item) return;
  edit(() => { item.palette = palette; });
});

function fitZoom(): void {
  const pad = 48;
  const availableWidth = viewport.clientWidth - pad;
  const availableHeight = viewport.clientHeight - pad;
  if (availableWidth <= 0 || availableHeight <= 0) return;
  zoom = Math.min(8, Math.max(0.05, Math.min(availableWidth / state.width, availableHeight / state.height)));
}

function layoutWorld(): void {
  world.style.width = `${state.width * zoom}px`;
  world.style.height = `${state.height * zoom}px`;
  canvas.style.width = `${state.width}px`;
  canvas.style.height = `${state.height}px`;
  canvas.style.transform = `scale(${zoom})`;
  canvas.style.setProperty("--zoom", String(zoom));
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function previewFontSize(item: EditorItem): number {
  const width = Math.max(1, item.bbox[2] - item.bbox[0]);
  const height = Math.max(1, item.bbox[3] - item.bbox[1] - 24);
  const lines = (item.text || " ").split("\n");
  const longest = Math.max(1, ...lines.map((line) => line.length));
  return Math.max(8, Math.min(height / lines.length * 0.72, (width / longest) * 1.55, 160));
}

function renderBoxes(): void {
  const fragment = document.createDocumentFragment();
  for (const item of state.items) {
    const element = document.createElement("div");
    element.className = `box box-${item.label}`;
    element.dataset.id = item.id;
    if (item.id === state.selectedId) element.classList.add("is-selected");
    if (boxError(item.bbox, state.width, state.height)) element.classList.add("is-invalid");
    const [x1, y1, x2, y2] = item.bbox;
    element.style.left = `${x1}px`;
    element.style.top = `${y1}px`;
    element.style.width = `${Math.max(0, x2 - x1)}px`;
    element.style.height = `${Math.max(0, y2 - y1)}px`;
    const label = document.createElement("span");
    label.className = "box-label";
    label.textContent = item.label;
    element.append(label);
    if (item.label === "text") {
      const text = document.createElement("div");
      text.className = "box-text-body";
      text.textContent = item.text;
      text.style.fontSize = `${previewFontSize(item)}px`;
      element.append(text);
    } else if (item.caption) {
      const caption = document.createElement("div");
      caption.className = "box-caption";
      caption.textContent = item.caption;
      element.append(caption);
    }
    if (item.id === state.selectedId) {
      for (const handle of HANDLES) {
        const node = document.createElement("span");
        node.className = `handle handle-${handle}`;
        element.append(node);
      }
    }
    fragment.append(element);
  }
  canvas.replaceChildren(fragment);
  if (state.items.length === 0 && gesture === null) {
    const hint = document.createElement("div");
    hint.className = "canvas-hint";
    hint.textContent = "Drag to place a box. Hold Shift for text, Alt for a character.";
    canvas.append(hint);
  }
}

function renderList(): void {
  itemList.replaceChildren();
  state.items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `item-row item-${item.label}`;
    if (item.id === state.selectedId) button.classList.add("is-selected");
    const title = document.createElement("strong");
    title.textContent = `${index + 1}  ${item.label}`;
    const preview = document.createElement("span");
    const source = item.label === "text" && item.text ? item.text : item.caption;
    preview.textContent = source.replace(/\s+/g, " ").slice(0, 72) || "Empty";
    button.append(title, preview);
    button.addEventListener("click", () => {
      state.selectedId = item.id;
      sync();
    });
    itemList.append(button);
  });
}

function renderInspector(): void {
  const item = selected();
  inspectorForm.hidden = item === undefined;
  inspectorEmpty.hidden = item !== undefined;
  if (!item) return;
  setIfIdle(itemLabel, item.label);
  setIfIdle(itemCaption, item.caption);
  setIfIdle(itemText, item.text);
  textHint.textContent = item.label === "text"
    ? "This string is the text to render, including line breaks."
    : "Optional on object and character boxes. Leave it empty to omit it.";
  setIfIdle(boxX, formatNumber(item.bbox[0]));
  setIfIdle(boxY, formatNumber(item.bbox[1]));
  setIfIdle(boxW, formatNumber(item.bbox[2] - item.bbox[0]));
  setIfIdle(boxH, formatNumber(item.bbox[3] - item.bbox[1]));
  const issue = boxError(item.bbox, state.width, state.height);
  boxCompiled.textContent = issue ?? `Centered yxyx: ${centeredPreview(item.bbox)}`;
}

function centeredPreview(bbox: Box): string {
  try {
    const draft = draftFromEditor({
      ...state,
      summary: { ...state.summary, caption: state.summary.caption || "x" },
      items: [{
        id: "preview",
        label: "object",
        caption: "x",
        text: "",
        tags: [],
        palette: [],
        bbox,
      }],
    });
    const compiled = JSON.parse(compilePrompt(draft)) as { items: { bbox: number[] }[] };
    return `[${compiled.items[0]?.bbox.join(", ")}]`;
  } catch {
    return "unavailable";
  }
}

function renderOutput(): void {
  const draft = draftFromEditor(state);
  draftOut.value = JSON.stringify(draft, null, 2);
  const preset = `${state.width}x${state.height}`;
  setIfIdle(presetSelect, [...presetSelect.options].some((option) => option.value === preset) ? preset : "");
  setIfIdle(widthInput, String(state.width));
  setIfIdle(heightInput, String(state.height));
  try {
    const prompt = compilePrompt(draft);
    promptOut.value = prompt;
    promptError.hidden = true;
    promptMeta.textContent = `${state.width}×${state.height} · ${state.items.length} item${state.items.length === 1 ? "" : "s"}. Set that size in the image workflow. It is not part of the prompt.`;
    for (const button of copyPromptButtons) button.disabled = false;
  } catch (error) {
    promptOut.value = "";
    promptError.hidden = false;
    promptError.textContent = error instanceof Error ? error.message : String(error);
    promptMeta.textContent = "The draft is not ready to compile.";
    for (const button of copyPromptButtons) button.disabled = true;
  }
  undoButton.disabled = !history.canUndo;
  redoButton.disabled = !history.canRedo;
}

function sync(): void {
  if (zoomMode === "fit") fitZoom();
  layoutWorld();
  renderBoxes();
  renderList();
  setIfIdle(summaryCaption, state.summary.caption);
  setIfIdle(summaryCanvas, state.summary.canvas);
  syncMeta();
  syncSummaryPalette();
  syncTags();
  syncItemPalette();
  renderInspector();
  renderOutput();
  scheduleSave();
}

function eventToCanvas(event: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * state.width,
    y: ((event.clientY - rect.top) / rect.height) * state.height,
  };
}

function hitHandle(x: number, y: number): Handle | null {
  const item = selected();
  if (!item) return null;
  const [x1, y1, x2, y2] = item.bbox;
  const tolerance = 8 / zoom;
  const corners: [Handle, number, number][] = [
    ["nw", x1, y1], ["ne", x2, y1], ["se", x2, y2], ["sw", x1, y2],
  ];
  const edges: [Handle, number, number][] = [
    ["n", (x1 + x2) / 2, y1], ["e", x2, (y1 + y2) / 2],
    ["s", (x1 + x2) / 2, y2], ["w", x1, (y1 + y2) / 2],
  ];
  for (const [handle, hx, hy] of [...corners, ...edges]) {
    if (Math.abs(x - hx) <= tolerance && Math.abs(y - hy) <= tolerance) return handle;
  }
  return null;
}

function hitBox(x: number, y: number): string | null {
  for (let index = state.items.length - 1; index >= 0; index -= 1) {
    const item = state.items[index];
    if (!item) continue;
    const [x1, y1, x2, y2] = item.bbox;
    if (x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && y >= Math.min(y1, y2) && y <= Math.max(y1, y2)) {
      return item.id;
    }
  }
  return null;
}

function makeItem(label: Label, bbox: Box): EditorItem {
  return {
    id: nextId(),
    label,
    caption: label === "text"
      ? "Describe the lettering."
      : label === "character" ? "Describe this character." : "Describe this object.",
    text: label === "text" ? "Text" : "",
    tags: [],
    palette: [],
    bbox,
  };
}

function normalizeDraw(x0: number, y0: number, x1: number, y1: number): Box {
  const step = grid();
  const quantize = (value: number, limit: number) => {
    const snapped = step ? Math.round(value / step) * step : Math.round(value);
    return clampOn() ? Math.min(limit, Math.max(0, snapped)) : snapped;
  };
  let left = quantize(Math.min(x0, x1), state.width);
  let right = quantize(Math.max(x0, x1), state.width);
  let top = quantize(Math.min(y0, y1), state.height);
  let bottom = quantize(Math.max(y0, y1), state.height);
  const minimum = step ?? 1;
  if (right <= left) right = Math.min(state.width, left + minimum);
  if (bottom <= top) bottom = Math.min(state.height, top + minimum);
  return [left, top, right, bottom];
}

function finishGesture(): void {
  const current = gesture;
  if (!current) return;
  gesture = null;
  if (current.kind === "draw" && !current.created) state.selectedId = null;
  if (current.kind === "draw" && current.created && current.id) {
    const item = state.items.find((entry) => entry.id === current.id);
    if (item && (item.bbox[2] - item.bbox[0] < 4 || item.bbox[3] - item.bbox[1] < 4)) {
      state.items = state.items.filter((entry) => entry.id !== item.id);
      state.selectedId = current.before.selectedId;
      current.created = false;
    }
  }
  if (signature(current.before) !== signature(state)) history.push(current.before);
  sync();
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  commitTyping();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  const point = eventToCanvas(event);
  const handle = hitHandle(point.x, point.y);
  const id = handle ? state.selectedId : hitBox(point.x, point.y);
  canvas.setPointerCapture(event.pointerId);
  const before = cloneState(state);
  if (handle && state.selectedId) {
    const item = selected();
    gesture = {
      kind: "resize",
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      before,
      id: state.selectedId,
      handle,
      startBbox: item ? [...item.bbox] : undefined,
      created: false,
    };
    return;
  }
  if (id) {
    state.selectedId = id;
    const item = selected();
    gesture = {
      kind: "move",
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      before,
      id,
      startBbox: item ? [...item.bbox] : undefined,
      created: false,
    };
    sync();
    return;
  }
  const label: Label = event.shiftKey ? "text" : event.altKey ? "character" : "object";
  gesture = {
    kind: "draw",
    pointerId: event.pointerId,
    startX: point.x,
    startY: point.y,
    before,
    label,
    created: false,
  };
}

function onPointerMove(event: PointerEvent): void {
  const point = eventToCanvas(event);
  hud.textContent = `${Math.round(point.x)}, ${Math.round(point.y)}`;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const dx = point.x - gesture.startX;
  const dy = point.y - gesture.startY;
  if (gesture.kind === "move" && gesture.id && gesture.startBbox) {
    const item = state.items.find((entry) => entry.id === gesture?.id);
    if (!item) return;
    item.bbox = translateBox(gesture.startBbox, dx, dy, state.width, state.height, clampOn(), grid());
    sync();
    return;
  }
  if (gesture.kind === "resize" && gesture.id && gesture.handle && gesture.startBbox) {
    const item = state.items.find((entry) => entry.id === gesture?.id);
    if (!item) return;
    item.bbox = resizeBox(gesture.startBbox, gesture.handle, dx, dy, state.width, state.height, clampOn(), grid());
    sync();
    return;
  }
  if (gesture.kind === "draw" && gesture.label) {
    const moved = Math.abs(dx) > 3 || Math.abs(dy) > 3;
    if (!gesture.created && !moved) return;
    const bbox = normalizeDraw(gesture.startX, gesture.startY, point.x, point.y);
    if (!gesture.created) {
      const item = makeItem(gesture.label, bbox);
      state.items.push(item);
      state.selectedId = item.id;
      gesture.id = item.id;
      gesture.created = true;
    } else {
      const item = state.items.find((entry) => entry.id === gesture?.id);
      if (item) item.bbox = bbox;
    }
    sync();
  }
}

function applyBoxInputs(): void {
  const item = selected();
  if (!item) return;
  const x = Number(boxX.value);
  const y = Number(boxY.value);
  const w = Number(boxW.value);
  const h = Number(boxH.value);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return;
  onType(() => { item.bbox = [x, y, x + w, y + h]; });
}

function readEdge(input: HTMLInputElement, fallback: number): number | null {
  const value = Number(input.value);
  if (!Number.isInteger(value) || value < 1 || value > MAX_EDGE) return null;
  if (value === fallback) return null;
  return value;
}

function replaceState(next: EditorState): void {
  commitTyping();
  const before = cloneState(state);
  state = next;
  if (signature(before) !== signature(state)) history.push(before);
  zoomMode = "fit";
  sync();
}

function addItem(label: Label): void {
  edit(() => {
    const item = makeItem(label, defaultPlacement(state, state.items.length));
    state.items.push(item);
    state.selectedId = item.id;
  });
}

function reorder(direction: -1 | 1): void {
  const index = state.items.findIndex((item) => item.id === state.selectedId);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= state.items.length) return;
  edit(() => {
    const [item] = state.items.splice(index, 1);
    if (item) state.items.splice(next, 0, item);
  });
}

function duplicate(): void {
  const index = state.items.findIndex((item) => item.id === state.selectedId);
  const item = state.items[index];
  if (!item) return;
  edit(() => {
    const copy = cloneState({ ...state, items: [item] }).items[0];
    if (!copy) return;
    copy.id = nextId();
    copy.bbox = translateBox(copy.bbox, 16, 16, state.width, state.height, true, null);
    state.items.splice(index + 1, 0, copy);
    state.selectedId = copy.id;
  });
}

function removeSelected(): void {
  const index = state.items.findIndex((item) => item.id === state.selectedId);
  if (index < 0) return;
  edit(() => {
    state.items.splice(index, 1);
    state.selectedId = (state.items[index] ?? state.items[index - 1])?.id ?? null;
  });
}

async function copyText(text: string, message: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  flash(message);
}

function currentPrompt(): string | null {
  try {
    return compilePrompt(draftFromEditor(state));
  } catch {
    return null;
  }
}

function showImportError(message: string): void {
  importError.hidden = false;
  importError.textContent = message;
}

function applyImport(): void {
  importError.hidden = true;
  let value: unknown;
  try {
    value = parseDraftJson(importText.value);
  } catch (error) {
    showImportError(error instanceof Error ? error.message : String(error));
    return;
  }
  if (isCompiledPrompt(value)) {
    if (compiledSize.hidden) {
      compiledSize.hidden = false;
      compiledWidth.value = String(state.width);
      compiledHeight.value = String(state.height);
      importHelp.textContent = "Compiled prompt detected. Confirm the canvas size, then import again.";
      return;
    }
    try {
      replaceState(editorFromCompiled(value, Number(compiledWidth.value), Number(compiledHeight.value)));
      importDialog.close();
      flash("Imported compiled prompt");
    } catch (error) {
      showImportError(error instanceof Error ? error.message : String(error));
    }
    return;
  }
  compiledSize.hidden = true;
  try {
    replaceState(editorFromDraft(value));
    importDialog.close();
    flash("Imported draft");
  } catch (error) {
    showImportError(error instanceof Error ? error.message : String(error));
  }
}

summaryCaption.addEventListener("input", () => onType(() => { state.summary.caption = summaryCaption.value; }));
summaryCaption.addEventListener("blur", commitTyping);
summaryCanvas.addEventListener("change", () => {
  edit(() => { state.summary.canvas = summaryCanvas.value as CanvasKind | ""; });
});
itemLabel.addEventListener("change", () => {
  const item = selected();
  if (!item) return;
  edit(() => { item.label = itemLabel.value as Label; });
});
itemCaption.addEventListener("input", () => {
  const item = selected();
  if (!item) return;
  onType(() => { item.caption = itemCaption.value; });
});
itemText.addEventListener("input", () => {
  const item = selected();
  if (!item) return;
  onType(() => { item.text = itemText.value; });
});
itemCaption.addEventListener("blur", commitTyping);
itemText.addEventListener("blur", commitTyping);
for (const input of [boxX, boxY, boxW, boxH]) {
  input.addEventListener("input", applyBoxInputs);
  input.addEventListener("blur", commitTyping);
}

function applyDimension(input: HTMLInputElement, axis: "width" | "height"): void {
  const value = readEdge(input, state[axis]);
  if (value === null) {
    input.value = String(state[axis]);
    return;
  }
  edit(() => { state[axis] = value; });
  if (zoomMode === "fit") fitZoom();
  sync();
}

widthInput.addEventListener("change", () => applyDimension(widthInput, "width"));
heightInput.addEventListener("change", () => applyDimension(heightInput, "height"));
presetSelect.addEventListener("change", () => {
  const [width, height] = presetSelect.value.split("x").map(Number);
  if (!width || !height) return;
  edit(() => {
    state.width = width;
    state.height = height;
  });
  zoomMode = "fit";
  sync();
});
exampleSelect.addEventListener("change", () => {
  const value = exampleSelect.value as ExampleName | "blank" | "";
  exampleSelect.value = "";
  if (!value) return;
  replaceState(createExample(value));
  flash(value === "blank" ? "Blank canvas" : exampleLabels[value]);
});

$<HTMLButtonElement>("#add-object").addEventListener("click", () => addItem("object"));
$<HTMLButtonElement>("#add-character").addEventListener("click", () => addItem("character"));
$<HTMLButtonElement>("#add-text").addEventListener("click", () => addItem("text"));
$<HTMLButtonElement>("#send-back").addEventListener("click", () => reorder(-1));
$<HTMLButtonElement>("#bring-forward").addEventListener("click", () => reorder(1));
$<HTMLButtonElement>("#duplicate").addEventListener("click", duplicate);
$<HTMLButtonElement>("#delete-item").addEventListener("click", removeSelected);
undoButton.addEventListener("click", () => {
  commitTyping();
  const previous = history.undo(state);
  if (!previous) return;
  state = previous;
  sync();
});
redoButton.addEventListener("click", () => {
  commitTyping();
  const next = history.redo(state);
  if (!next) return;
  state = next;
  sync();
});

for (const button of copyPromptButtons) {
  button.addEventListener("click", () => {
    const prompt = currentPrompt();
    if (prompt) void copyText(prompt, "Copied prompt");
  });
}
$<HTMLButtonElement>("#copy-draft").addEventListener("click", () => {
  void copyText(formatDraft(state), "Copied draft");
});
$<HTMLButtonElement>("#export-draft").addEventListener("click", () => {
  const blob = new Blob([formatDraft(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "moss-layout-draft.json";
  link.click();
  URL.revokeObjectURL(url);
});

$<HTMLButtonElement>("#import-open").addEventListener("click", () => {
  importError.hidden = true;
  compiledSize.hidden = true;
  importText.value = "";
  importHelp.textContent = "Paste a layout draft (abs / xyxy) or a compiled prompt (abs_centralized / yxyx).";
  importDialog.showModal();
});
$<HTMLButtonElement>("#import-cancel").addEventListener("click", () => importDialog.close());
$<HTMLButtonElement>("#import-apply").addEventListener("click", applyImport);
$<HTMLInputElement>("#import-file").addEventListener("change", async (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
  importText.value = await input.files[0].text();
  input.value = "";
  applyImport();
});

$<HTMLButtonElement>("#zoom-out").addEventListener("click", () => {
  zoomMode = "manual";
  zoom = Math.max(0.05, zoom / 1.1);
  layoutWorld();
});
$<HTMLButtonElement>("#zoom-in").addEventListener("click", () => {
  zoomMode = "manual";
  zoom = Math.min(8, zoom * 1.1);
  layoutWorld();
});
$<HTMLButtonElement>("#zoom-fit").addEventListener("click", () => {
  zoomMode = "fit";
  fitZoom();
  layoutWorld();
});
viewport.addEventListener("wheel", (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  zoomMode = "manual";
  zoom = Math.min(8, Math.max(0.05, zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
  layoutWorld();
}, { passive: false });

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", finishGesture);
canvas.addEventListener("pointercancel", finishGesture);
canvas.addEventListener("pointerleave", () => {
  if (!gesture) hud.textContent = "";
});

window.addEventListener("keydown", (event) => {
  if (importDialog.open) return;
  const target = event.target;
  const typing = target instanceof HTMLElement && Boolean(target.closest("input, textarea, select"));
  if (typing) {
    if (event.key === "Escape" && target instanceof HTMLElement) target.blur();
    return;
  }
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "z") {
    event.preventDefault();
    commitTyping();
    const next = event.shiftKey ? history.redo(state) : history.undo(state);
    if (next) {
      state = next;
      sync();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === "y") {
    event.preventDefault();
    const next = history.redo(state);
    if (next) {
      state = next;
      sync();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === "d") {
    event.preventDefault();
    duplicate();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    removeSelected();
    return;
  }
  if (event.key === "[") reorder(-1);
  if (event.key === "]") reorder(1);
  if (event.key.startsWith("Arrow") && state.selectedId) {
    event.preventDefault();
    const step = event.shiftKey || snapInput.checked ? 16 : 1;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    if (!typingBefore) typingBefore = cloneState(state);
    const item = selected();
    if (!item) return;
    item.bbox = translateBox(item.bbox, dx, dy, state.width, state.height, clampOn(), grid());
    sync();
  }
});
window.addEventListener("keyup", (event) => {
  if (event.key.startsWith("Arrow")) commitTyping();
});
window.addEventListener("resize", () => {
  if (zoomMode === "fit") {
    fitZoom();
    layoutWorld();
  }
});

sync();
requestAnimationFrame(() => {
  if (zoomMode === "fit") {
    fitZoom();
    layoutWorld();
  }
});
