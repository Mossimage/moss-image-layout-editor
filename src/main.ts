import "@fontsource/figtree/latin-400.css";
import "@fontsource/figtree/latin-500.css";
import "@fontsource/figtree/latin-600.css";
import "@fontsource/fraunces/latin-600.css";
import "@fontsource/fraunces/latin-600-italic.css";
import "./styles.css";
import { boxError, compilePrompt } from "./compile/compilePrompt.ts";
import { parseDraftJson } from "./compile/json.ts";
import { createExample, type ExampleName } from "./examples.ts";
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
import { canvasSizeForImage, scaleBox, type CanvasSizeForImage } from "./editor/reference.ts";
import { LANG_STORAGE_KEY, messages, parseLocale, pickLocale, t, type Locale, type MessageKey } from "./i18n.ts";

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
      <span class="brand-sub" data-i18n="brand.sub">Layout</span>
    </div>
    <div class="size">
      <label><span class="label-text" data-i18n="width">Width</span> <input id="canvas-width" type="number" min="1" max="${MAX_EDGE}" step="16" /></label>
      <label><span class="label-text" data-i18n="height">Height</span> <input id="canvas-height" type="number" min="1" max="${MAX_EDGE}" step="16" /></label>
      <select id="size-preset" data-i18n-aria="preset.aria" aria-label="Canvas size presets">
        <option value="" data-i18n="preset.empty">Preset</option>
        <option value="1024x1024">1024 × 1024</option>
        <option value="1024x1536">1024 × 1536</option>
        <option value="1536x1024">1536 × 1024</option>
        <option value="768x1152">768 × 1152</option>
        <option value="768x1344">768 × 1344</option>
        <option value="1344x768">1344 × 768</option>
      </select>
    </div>
    <div class="top-actions">
      <div class="lang-switch" role="group" data-i18n-aria="lang.group" aria-label="Language">
        <button id="lang-en" type="button" data-lang="en" data-i18n="lang.en">EN</button>
        <button id="lang-zh" type="button" data-lang="zh" data-i18n="lang.zh">中文</button>
      </div>
      <select id="example-select" data-i18n-aria="examples.aria" aria-label="Example layouts">
        <option value="" data-i18n="examples.empty">Examples</option>
        <option value="poster" data-i18n="example.poster">Poster</option>
        <option value="menu" data-i18n="example.menu">Menu</option>
        <option value="comic" data-i18n="example.comic">Comic</option>
        <option value="cover" data-i18n="example.cover">Book cover</option>
        <option value="blank" data-i18n="example.blank">Blank canvas</option>
      </select>
      <button id="undo" type="button" data-i18n="undo">Undo</button>
      <button id="redo" type="button" data-i18n="redo">Redo</button>
      <button id="import-open" type="button" data-i18n="import">Import</button>
      <button id="export-draft" type="button" data-i18n="export">Export draft</button>
      <button id="copy-prompt" type="button" class="primary" data-i18n="copyPrompt">Copy prompt</button>
    </div>
    <div id="status" class="status" role="status"></div>
  </header>
  <aside class="panel left">
    <section>
      <h2 data-i18n="summary">Summary</h2>
      <label class="field"><span class="label-text" data-i18n="caption">Caption</span>
        <textarea id="summary-caption" rows="5"></textarea>
      </label>
      <label class="field"><span class="label-text" data-i18n="canvas">Canvas</span>
        <select id="summary-canvas">
          <option value="" data-i18n="canvas.unspecified">Unspecified</option>
          <option value="single" data-i18n="canvas.single">single</option>
          <option value="multi_panel" data-i18n="canvas.multi_panel">multi_panel</option>
          <option value="collage" data-i18n="canvas.collage">collage</option>
        </select>
      </label>
      <div class="field"><span data-i18n="meta">Meta</span><div id="meta-chips" class="chips"></div></div>
      <div class="field"><span data-i18n="palette">Palette</span><div id="summary-palette" class="chips"></div></div>
    </section>
    <section>
      <div class="list-head" data-i18n="itemsHead">Items, back to front</div>
      <div id="item-list" class="item-list"></div>
      <div class="add-row">
        <button id="add-object" type="button" data-i18n="addObject">Add object</button>
        <button id="add-character" type="button" data-i18n="addCharacter">Add character</button>
        <button id="add-text" type="button" data-i18n="addText">Add text</button>
      </div>
    </section>
    <section id="inspector" class="inspector">
      <h2 data-i18n="box">Box</h2>
      <p id="inspector-empty" class="hint" data-i18n="inspectorEmpty">Select a box, or drag on the canvas.</p>
      <div id="inspector-form">
        <label class="field"><span class="label-text" data-i18n="label">Label</span>
          <select id="item-label">
            <option value="object" data-i18n="label.object">object</option>
            <option value="character" data-i18n="label.character">character</option>
            <option value="text" data-i18n="label.text">text</option>
          </select>
        </label>
        <label class="field"><span class="label-text" data-i18n="caption">Caption</span>
          <textarea id="item-caption" rows="4"></textarea>
        </label>
        <label class="field"><span class="label-text" data-i18n="literal">Literal text</span>
          <textarea id="item-text" rows="3" spellcheck="false" data-i18n-placeholder="literal.placeholder" placeholder="Required for text boxes. Use real line breaks."></textarea>
        </label>
        <p id="text-hint" class="hint"></p>
        <div class="field"><span data-i18n="tags">Tags</span><div id="item-tags" class="chips"></div></div>
        <div class="field"><span data-i18n="palette">Palette</span><div id="item-palette" class="chips"></div></div>
        <div class="bbox-grid">
          <label>X <input id="box-x" type="number" step="1" /></label>
          <label>Y <input id="box-y" type="number" step="1" /></label>
          <label>W <input id="box-w" type="number" step="1" /></label>
          <label>H <input id="box-h" type="number" step="1" /></label>
        </div>
        <p id="box-compiled" class="hint"></p>
        <div class="inspector-actions">
          <button id="send-back" type="button" data-i18n="sendBack">Send backward</button>
          <button id="bring-forward" type="button" data-i18n="bringForward">Bring forward</button>
          <button id="duplicate" type="button" data-i18n="duplicate">Duplicate</button>
          <button id="delete-item" type="button" class="danger" data-i18n="delete">Delete</button>
        </div>
      </div>
    </section>
    <details class="shortcuts">
      <summary data-i18n="shortcuts">Shortcuts</summary>
      <p class="hint" data-i18n="shortcuts.body">Drag empty canvas to draw. Shift draws text, Alt draws a character. Arrows nudge by 1px, Shift+arrows by 16. Delete removes. Ctrl+Z undoes, Ctrl+Shift+Z redoes, Ctrl+D duplicates. [ and ] reorder.</p>
    </details>
  </aside>
  <main class="center">
    <div class="toolbar">
      <span class="hint" data-i18n="toolbar.hint">Boxes mark placement. They are not instructions to draw a frame.</span>
      <label class="file-btn"><span data-i18n="reference">Reference</span> <input id="reference-file" type="file" accept="image/*" /></label>
      <label class="check"><input id="snap" type="checkbox" /> <span data-i18n="snap">Snap 16</span></label>
      <label class="check"><input id="clamp" type="checkbox" checked /> <span data-i18n="clamp">Clamp</span></label>
      <div class="zoom">
        <button id="zoom-out" type="button" data-i18n-aria="zoomOut" aria-label="Zoom out">−</button>
        <span id="zoom-label">100%</span>
        <button id="zoom-in" type="button" data-i18n-aria="zoomIn" aria-label="Zoom in">+</button>
        <button id="zoom-fit" type="button" data-i18n="fit">Fit</button>
      </div>
    </div>
    <div id="reference-bar" class="reference-bar" hidden>
      <span id="reference-name" class="reference-name"></span>
      <label class="check"><input id="reference-visible" type="checkbox" checked /> <span data-i18n="show">Show</span></label>
      <label class="opacity"><span data-i18n="opacity">Opacity</span>
        <input id="reference-opacity" type="range" min="0" max="100" value="50" />
        <span id="reference-opacity-label">50%</span>
      </label>
      <button id="reference-size" type="button" data-i18n="useImageSize">Use image size</button>
      <button id="reference-remove" type="button" data-i18n="remove">Remove</button>
      <span class="hint" data-i18n="notExported">Not exported</span>
    </div>
    <div id="viewport" class="viewport">
      <div class="viewport-inner">
        <div id="world" class="world">
          <div id="canvas" class="canvas">
            <img id="reference-image" class="reference-layer" alt="" hidden />
            <div id="box-layer" class="box-layer"></div>
            <textarea id="inline-editor" class="inline-editor" hidden spellcheck="false" data-i18n-aria="box.editorAria" aria-label="Edit box content"></textarea>
          </div>
        </div>
      </div>
      <div id="hud" class="hud"></div>
    </div>
  </main>
  <aside class="panel right">
    <h2 data-i18n="compiled">Compiled prompt</h2>
    <p id="prompt-meta" class="hint"></p>
    <p id="prompt-error" class="error" hidden></p>
    <textarea id="prompt-out" class="prompt-text" readonly spellcheck="false" data-i18n-aria="prompt.aria" aria-label="Compiled prompt"></textarea>
    <div class="row">
      <button id="copy-prompt-side" type="button" class="primary" data-i18n="copyPrompt">Copy prompt</button>
      <button id="copy-draft" type="button" data-i18n="copyDraft">Copy draft JSON</button>
    </div>
    <details>
      <summary data-i18n="draftJson">Draft JSON</summary>
      <textarea id="draft-out" readonly spellcheck="false" rows="12" data-i18n-aria="draft.aria" aria-label="Draft JSON"></textarea>
    </details>
  </aside>
  <dialog id="import-dialog">
    <h2 data-i18n="import.title">Import JSON</h2>
    <p id="import-help" class="hint" data-i18n="import.help">Paste a layout draft (abs / xyxy) or a compiled prompt (abs_centralized / yxyx).</p>
    <p id="import-error" class="error" hidden></p>
    <textarea id="import-text" spellcheck="false" data-i18n-placeholder="import.placeholder" placeholder='{"width": 1024, "height": 1024, ...}'></textarea>
    <div id="compiled-size" hidden>
      <p class="hint" data-i18n="import.compiledHint">This file is a compiled prompt, so width and height are not in it. Enter the canvas those boxes were centered on. Reversing floor/ceil can grow an edge by up to a pixel.</p>
      <div class="row">
        <label><span class="label-text" data-i18n="width">Width</span> <input id="compiled-width" type="number" min="16" step="16" /></label>
        <label><span class="label-text" data-i18n="height">Height</span> <input id="compiled-height" type="number" min="16" step="16" /></label>
      </div>
    </div>
    <div class="row">
      <label class="file-btn"><span data-i18n="chooseFile">Choose file</span> <input id="import-file" type="file" accept="application/json,.json" /></label>
      <button id="import-cancel" type="button" data-i18n="cancel">Cancel</button>
      <button id="import-apply" type="button" class="primary" data-i18n="import">Import</button>
    </div>
  </dialog>
  <dialog id="reference-size-dialog">
    <h2 data-i18n="referenceSize.title">Match canvas to image</h2>
    <p id="reference-size-copy" class="hint"></p>
    <div class="row">
      <button id="reference-size-cancel" type="button" data-i18n="cancel">Cancel</button>
      <button id="reference-size-keep" type="button" data-i18n="keepPositions">Keep box positions</button>
      <button id="reference-size-scale" type="button" class="primary" data-i18n="scaleBoxes">Scale boxes</button>
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
const boxLayer = $<HTMLElement>("#box-layer");
const inlineEditor = $<HTMLTextAreaElement>("#inline-editor");
const referenceImage = $<HTMLImageElement>("#reference-image");
const referenceBar = $<HTMLElement>("#reference-bar");
const referenceName = $<HTMLElement>("#reference-name");
const referenceVisible = $<HTMLInputElement>("#reference-visible");
const referenceOpacity = $<HTMLInputElement>("#reference-opacity");
const referenceOpacityLabel = $<HTMLElement>("#reference-opacity-label");
const referenceFile = $<HTMLInputElement>("#reference-file");
const referenceSizeDialog = $<HTMLDialogElement>("#reference-size-dialog");
const referenceSizeCopy = $<HTMLElement>("#reference-size-copy");
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

interface ReferenceLayer {
  url: string;
  name: string;
  naturalWidth: number;
  naturalHeight: number;
  visible: boolean;
  opacity: number;
}

let state = loadInitial();
const history = new History();
const langParam = new URLSearchParams(location.search).get("lang");
let locale: Locale = pickLocale(langParam, readLang(), navigator.language);
if (parseLocale(langParam)) writeLang(locale);

function readLang(): string | null {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLang(next: Locale): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, next);
  } catch {
    /* private mode can reject the write */
  }
}

function tr(key: MessageKey, vars?: Record<string, string | number>): string {
  return t(locale, key, vars);
}

function exampleMessage(name: ExampleName | "blank"): MessageKey {
  switch (name) {
    case "poster": return "example.poster";
    case "menu": return "example.menu";
    case "comic": return "example.comic";
    case "cover": return "example.cover";
    case "blank": return "example.blank";
  }
}

function labelName(label: Label): string {
  if (label === "object") return tr("label.object");
  if (label === "character") return tr("label.character");
  return tr("label.text");
}

function applyMessage(key: string, assign: (text: string) => void): void {
  if (!(key in messages.en)) throw new Error(`Unknown message ${key}`);
  assign(tr(key as MessageKey));
}

function applyI18n(): void {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  document.title = tr("doc.title");
  document.querySelector('meta[name="description"]')?.setAttribute("content", tr("doc.description"));
  for (const node of root!.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = node.dataset.i18n;
    if (key) applyMessage(key, (text) => { node.textContent = text; });
  }
  for (const node of root!.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-i18n-placeholder]")) {
    const key = node.getAttribute("data-i18n-placeholder");
    if (key) applyMessage(key, (text) => { node.placeholder = text; });
  }
  for (const node of root!.querySelectorAll<HTMLElement>("[data-i18n-aria]")) {
    const key = node.getAttribute("data-i18n-aria");
    if (key) applyMessage(key, (text) => { node.setAttribute("aria-label", text); });
  }
  if (!compiledSize.hidden) importHelp.textContent = tr("import.helpCompiled");
  if (referenceSizeDialog.open && pendingImageSize && reference) {
    referenceSizeCopy.textContent = imageSizeMessage(pendingImageSize, reference.naturalWidth, reference.naturalHeight);
  }
  for (const button of root!.querySelectorAll<HTMLButtonElement>("[data-lang]")) {
    const active = button.dataset.lang === locale;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function setLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  writeLang(next);
  const url = new URL(location.href);
  url.searchParams.set("lang", next);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  applyI18n();
  sync();
}
let reference: ReferenceLayer | null = null;
let referenceLoad = 0;
let pendingImageSize: CanvasSizeForImage | null = null;
let zoom = 1;
let zoomMode: "fit" | "manual" = "fit";
let gesture: Gesture | null = null;
let typingBefore: EditorState | null = null;
let saveTimer = 0;
/** The box whose words are being edited on the canvas, if any. Text boxes edit `text`, others edit `caption`. */
let editing: { id: string; field: "text" | "caption" } | null = null;
let lastPress: { id: string; time: number } | null = null;

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
    const sig = `${locale}:${JSON.stringify(values)}`;
    if (container.dataset.sig === sig) return;
    const wasFocused = container.contains(document.activeElement);
    container.dataset.sig = sig;
    container.replaceChildren();
    values.forEach((value, index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = value;
      chip.setAttribute("aria-label", tr("chip.remove", { value }));
      chip.addEventListener("click", () => {
        setValues(getValues().filter((_, chipIndex) => chipIndex !== index));
      });
      container.append(chip);
    });
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = tr("chip.add");
    input.setAttribute("aria-label", tr("chip.addAria"));
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
  const height = Math.max(1, item.bbox[3] - item.bbox[1] - 8);
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
    element.title = tr("box.editHint");
    const label = document.createElement("span");
    label.className = "box-label";
    label.textContent = labelName(item.label);
    element.append(label);
    if (editing?.id === item.id) {
      element.classList.add("is-editing");
    } else if (item.label === "text") {
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
      if (gesture === null && editing === null) element.append(boxToolbar(item));
    }
    fragment.append(element);
  }
  boxLayer.replaceChildren(fragment);
  if (state.items.length === 0 && gesture === null) {
    const hint = document.createElement("div");
    hint.className = "canvas-hint";
    hint.textContent = tr("canvasHint");
    boxLayer.append(hint);
  }
}

const ICONS = {
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  delete: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};

function toolButton(icon: keyof typeof ICONS, label: string, onClick: () => void, extraClass = ""): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `box-tool ${extraClass}`.trim();
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg><span>${label}</span>`;
  button.addEventListener("click", onClick);
  return button;
}

/** Floating actions on the selected box. Sized in screen pixels, so it stays readable at any zoom. */
function boxToolbar(item: EditorItem): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "box-toolbar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", tr("box.toolbar"));
  // Flip below the box when there is no room above it on screen.
  if (item.bbox[1] * zoom < 44) bar.classList.add("is-below");
  // Keep pointer presses here from starting a canvas move or draw.
  bar.addEventListener("pointerdown", (event) => event.stopPropagation());
  bar.addEventListener("dblclick", (event) => event.stopPropagation());
  bar.append(
    toolButton("edit", tr(item.label === "text" ? "box.editText" : "box.editCaption"), () => openEditor(item.id), "is-labelled"),
    toolButton("duplicate", tr("duplicate"), duplicate),
    toolButton("delete", tr("delete"), removeSelected, "is-danger"),
  );
  return bar;
}

function openEditor(id: string): void {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  commitTyping();
  state.selectedId = id;
  editing = { id, field: item.label === "text" ? "text" : "caption" };
  inlineEditor.value = item[editing.field];
  inlineEditor.hidden = false;
  sync();
  inlineEditor.focus();
  inlineEditor.select();
}

function closeEditor(): void {
  if (!editing) return;
  editing = null;
  inlineEditor.hidden = true;
  commitTyping();
  sync();
}

function positionEditor(): void {
  if (!editing) return;
  const item = state.items.find((entry) => entry.id === editing?.id);
  if (!item) {
    editing = null;
    inlineEditor.hidden = true;
    return;
  }
  const [x1, y1, x2, y2] = item.bbox;
  inlineEditor.style.left = `${x1}px`;
  inlineEditor.style.top = `${y1}px`;
  inlineEditor.style.width = `${Math.max(1, x2 - x1)}px`;
  inlineEditor.style.height = `${Math.max(1, y2 - y1)}px`;
  inlineEditor.classList.toggle("is-text", editing.field === "text");
  inlineEditor.style.fontSize = editing.field === "text" ? `${previewFontSize(item)}px` : "";
}

function fitReference(): void {
  renderReference();
  if (zoomMode === "fit") {
    fitZoom();
    layoutWorld();
  }
}

function renderReference(): void {
  referenceBar.hidden = reference === null;
  if (!reference) {
    referenceImage.hidden = true;
    referenceImage.removeAttribute("src");
    referenceName.textContent = "";
    referenceName.removeAttribute("title");
    return;
  }
  if (referenceImage.getAttribute("src") !== reference.url) referenceImage.src = reference.url;
  referenceImage.hidden = !reference.visible;
  referenceImage.style.opacity = String(reference.opacity);
  referenceName.textContent = reference.name;
  referenceName.title = reference.name;
  referenceVisible.checked = reference.visible;
  const percent = String(Math.round(reference.opacity * 100));
  if (document.activeElement !== referenceOpacity) referenceOpacity.value = percent;
  referenceOpacityLabel.textContent = `${referenceOpacity.value}%`;
}

function renderList(): void {
  itemList.replaceChildren();
  state.items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `item-row item-${item.label}`;
    if (item.id === state.selectedId) button.classList.add("is-selected");
    const title = document.createElement("strong");
    title.textContent = `${index + 1}  ${labelName(item.label)}`;
    const preview = document.createElement("span");
    const source = item.label === "text" && item.text ? item.text : item.caption;
    preview.textContent = source.replace(/\s+/g, " ").slice(0, 72) || tr("list.empty");
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
  textHint.textContent = item.label === "text" ? tr("textHint.required") : tr("textHint.optional");
  setIfIdle(boxX, formatNumber(item.bbox[0]));
  setIfIdle(boxY, formatNumber(item.bbox[1]));
  setIfIdle(boxW, formatNumber(item.bbox[2] - item.bbox[0]));
  setIfIdle(boxH, formatNumber(item.bbox[3] - item.bbox[1]));
  const issue = boxError(item.bbox, state.width, state.height);
  boxCompiled.textContent = issue ?? tr("centered", { box: centeredPreview(item.bbox) });
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
    return tr("unavailable");
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
    const count = state.items.length;
    promptMeta.textContent = tr("prompt.meta", {
      width: state.width,
      height: state.height,
      count,
      unit: tr(count === 1 ? "unit.one" : "unit.other"),
    });
    for (const button of copyPromptButtons) button.disabled = false;
  } catch (error) {
    promptOut.value = "";
    promptError.hidden = false;
    promptError.textContent = error instanceof Error ? error.message : String(error);
    promptMeta.textContent = tr("prompt.notReady");
    for (const button of copyPromptButtons) button.disabled = true;
  }
  undoButton.disabled = !history.canUndo;
  redoButton.disabled = !history.canRedo;
}

function sync(): void {
  if (zoomMode === "fit") fitZoom();
  layoutWorld();
  renderReference();
  renderBoxes();
  positionEditor();
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

function eventToCanvas(event: MouseEvent): { x: number; y: number } {
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
  if (signature(current.before) !== signature(state)) {
    history.push(current.before);
    lastPress = null;
  }
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
    // Two presses on the same box count as a double-click. The native dblclick is unreliable here
    // because every press re-renders the box layer.
    const now = performance.now();
    if (lastPress && lastPress.id === id && now - lastPress.time < 450) {
      lastPress = null;
      canvas.releasePointerCapture(event.pointerId);
      event.preventDefault();
      window.setTimeout(() => openEditor(id), 0);
      return;
    }
    lastPress = { id, time: now };
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

function clearReference(): void {
  if (reference) URL.revokeObjectURL(reference.url);
  reference = null;
  referenceLoad += 1;
  pendingImageSize = null;
  if (referenceSizeDialog.open) referenceSizeDialog.close();
  fitReference();
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(file.name);
}

function loadReferenceFile(file: File): void {
  if (!isImageFile(file)) {
    flash(tr("flash.chooseImage"));
    return;
  }
  const url = URL.createObjectURL(file);
  const token = ++referenceLoad;
  const image = new Image();
  image.onload = () => {
    if (token !== referenceLoad) {
      URL.revokeObjectURL(url);
      return;
    }
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      URL.revokeObjectURL(url);
      flash(tr("flash.unreadable"));
      return;
    }
    const opacity = reference?.opacity ?? 0.5;
    if (reference) URL.revokeObjectURL(reference.url);
    reference = {
      url,
      name: file.name || "reference",
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      visible: true,
      opacity,
    };
    fitReference();
    flash(tr("flash.referenceLocal"));
  };
  image.onerror = () => {
    if (token === referenceLoad) flash(tr("flash.unreadable"));
    URL.revokeObjectURL(url);
  };
  image.src = url;
}

function imageSizeMessage(size: CanvasSizeForImage, naturalWidth: number, naturalHeight: number): string {
  const fit = size.clamped
    ? tr("size.clamped", { naturalWidth, naturalHeight, max: MAX_EDGE, width: size.width, height: size.height })
    : tr("size.exact", { width: size.width, height: size.height });
  const compiles = size.width % 16 === 0 && size.height % 16 === 0
    ? tr("size.compiles")
    : tr("size.wontCompile");
  return `${fit} ${compiles} ${tr("size.choice")}`;
}

function applyImageSize(scale: boolean): void {
  const size = pendingImageSize;
  const layer = reference;
  pendingImageSize = null;
  if (!size || !layer) return;
  const fromWidth = state.width;
  const fromHeight = state.height;
  edit(() => {
    if (scale) {
      for (const item of state.items) {
        item.bbox = scaleBox(item.bbox, fromWidth, fromHeight, size.width, size.height);
      }
    }
    state.width = size.width;
    state.height = size.height;
  });
  zoomMode = "fit";
  sync();
  if (size.clamped) {
    flash(tr("flash.canvasClamped", { width: size.width, height: size.height, max: MAX_EDGE }));
  } else if (size.width % 16 !== 0 || size.height % 16 !== 0) {
    flash(tr("flash.canvasMultiple"));
  } else {
    flash(tr("flash.canvasSet", { width: size.width, height: size.height }));
  }
}

function requestImageSize(): void {
  if (!reference) return;
  let size: CanvasSizeForImage;
  try {
    size = canvasSizeForImage(reference.naturalWidth, reference.naturalHeight);
  } catch (error) {
    flash(error instanceof Error ? error.message : String(error));
    return;
  }
  pendingImageSize = size;
  if (state.items.length === 0) {
    applyImageSize(false);
    return;
  }
  referenceSizeCopy.textContent = imageSizeMessage(size, reference.naturalWidth, reference.naturalHeight);
  referenceSizeDialog.showModal();
}

function dragHasFiles(event: DragEvent): boolean {
  return Boolean(event.dataTransfer && [...event.dataTransfer.types].includes("Files"));
}

function droppedFile(event: DragEvent): File | null {
  if (!dragHasFiles(event)) return null;
  return event.dataTransfer?.files[0] ?? null;
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
      importHelp.textContent = tr("import.helpCompiled");
      return;
    }
    try {
      replaceState(editorFromCompiled(value, Number(compiledWidth.value), Number(compiledHeight.value)));
      importDialog.close();
      flash(tr("flash.importedCompiled"));
    } catch (error) {
      showImportError(error instanceof Error ? error.message : String(error));
    }
    return;
  }
  compiledSize.hidden = true;
  try {
    replaceState(editorFromDraft(value));
    importDialog.close();
    flash(tr("flash.importedDraft"));
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
  flash(tr(exampleMessage(value)));
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
    if (prompt) void copyText(prompt, tr("flash.copiedPrompt"));
  });
}
$<HTMLButtonElement>("#copy-draft").addEventListener("click", () => {
  void copyText(formatDraft(state), tr("flash.copiedDraft"));
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
  importHelp.textContent = tr("import.help");
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

referenceFile.addEventListener("change", () => {
  const file = referenceFile.files?.[0];
  referenceFile.value = "";
  if (file) loadReferenceFile(file);
});
referenceVisible.addEventListener("change", () => {
  if (!reference) return;
  reference.visible = referenceVisible.checked;
  renderReference();
});
referenceOpacity.addEventListener("input", () => {
  if (!reference) return;
  reference.opacity = Number(referenceOpacity.value) / 100;
  referenceOpacityLabel.textContent = `${referenceOpacity.value}%`;
  referenceImage.style.opacity = String(reference.opacity);
});
$<HTMLButtonElement>("#reference-size").addEventListener("click", requestImageSize);
$<HTMLButtonElement>("#reference-remove").addEventListener("click", clearReference);
$<HTMLButtonElement>("#reference-size-cancel").addEventListener("click", () => {
  pendingImageSize = null;
  referenceSizeDialog.close();
});
$<HTMLButtonElement>("#reference-size-keep").addEventListener("click", () => {
  applyImageSize(false);
  referenceSizeDialog.close();
});
$<HTMLButtonElement>("#reference-size-scale").addEventListener("click", () => {
  applyImageSize(true);
  referenceSizeDialog.close();
});
referenceSizeDialog.addEventListener("close", () => {
  pendingImageSize = null;
});
viewport.addEventListener("dragenter", (event) => {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  viewport.classList.add("is-file-drag");
});
viewport.addEventListener("dragover", (event) => {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  viewport.classList.add("is-file-drag");
});
viewport.addEventListener("dragleave", (event) => {
  const next = event.relatedTarget;
  if (next instanceof Node && viewport.contains(next)) return;
  viewport.classList.remove("is-file-drag");
});
viewport.addEventListener("drop", (event) => {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  viewport.classList.remove("is-file-drag");
  const file = droppedFile(event);
  if (file) loadReferenceFile(file);
});
window.addEventListener("dragover", (event) => {
  if (dragHasFiles(event)) event.preventDefault();
});
window.addEventListener("drop", (event) => {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  viewport.classList.remove("is-file-drag");
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
inlineEditor.addEventListener("pointerdown", (event) => event.stopPropagation());
inlineEditor.addEventListener("dblclick", (event) => event.stopPropagation());
inlineEditor.addEventListener("input", () => {
  const item = state.items.find((entry) => entry.id === editing?.id);
  if (!item || !editing) return;
  const field = editing.field;
  onType(() => { item[field] = inlineEditor.value; });
});
inlineEditor.addEventListener("keydown", (event) => {
  // Enter keeps its line break; Ctrl/Cmd+Enter finishes like Escape.
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    inlineEditor.blur();
  }
});
inlineEditor.addEventListener("blur", closeEditor);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", finishGesture);
canvas.addEventListener("pointercancel", finishGesture);
canvas.addEventListener("pointerleave", () => {
  if (!gesture) hud.textContent = "";
});

window.addEventListener("keydown", (event) => {
  if (importDialog.open || referenceSizeDialog.open) return;
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
  if (event.key === "Enter" && state.selectedId) {
    event.preventDefault();
    openEditor(state.selectedId);
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

for (const button of root.querySelectorAll<HTMLButtonElement>("[data-lang]")) {
  button.addEventListener("click", () => {
    const next = parseLocale(button.dataset.lang);
    if (next) setLocale(next);
  });
}

applyI18n();
sync();
requestAnimationFrame(() => {
  if (zoomMode === "fit") {
    fitZoom();
    layoutWorld();
  }
});
