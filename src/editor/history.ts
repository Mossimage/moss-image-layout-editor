import { cloneState, type EditorState } from "./model.ts";

export class History {
  private past: EditorState[] = [];
  private future: EditorState[] = [];

  constructor(private readonly limit = 100) {}

  push(state: EditorState): void {
    this.past.push(cloneState(state));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: EditorState): EditorState | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(cloneState(current));
    return previous;
  }

  redo(current: EditorState): EditorState | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(cloneState(current));
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
