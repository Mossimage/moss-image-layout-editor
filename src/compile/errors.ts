/** Error raised for the same cases as ValueError in compile_prompt.py. */
export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompileError";
  }
}

/** Python `str(['a', 'b'])` for sorted field names. */
export function formatPyList(items: readonly string[]): string {
  return `[${items.map((item) => `'${item}'`).join(", ")}]`;
}
