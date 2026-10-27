import { CompileError } from "./errors.ts";

/**
 * A JSON number that Python's json module would decode as float rather than int.
 * Integral values such as 1024.0 stay floats, matching `type(value) is int`.
 */
export class PyFloat {
  readonly pyType = "float" as const;
  constructor(readonly value: number) {}
}

export function isPyFloat(value: unknown): value is PyFloat {
  return value instanceof PyFloat;
}

/**
 * Parse JSON the way compile_prompt.py does: reject duplicate keys, and reject
 * NaN / Infinity. Number tokens that are not plain integers become {@link PyFloat}.
 */
export function parseDraftJson(input: string): unknown {
  const parser = new Parser(input);
  const value = parser.parseValue();
  parser.skipWs();
  if (!parser.done()) {
    throw new CompileError(`Unexpected trailing JSON at position ${parser.index}`);
  }
  return value;
}

class Parser {
  index = 0;

  constructor(private readonly source: string) {}

  done(): boolean {
    return this.index >= this.source.length;
  }

  peek(): string {
    return this.source[this.index] ?? "";
  }

  skipWs(): void {
    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index);
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) break;
      this.index += 1;
    }
  }

  parseValue(): unknown {
    this.skipWs();
    if (this.startsWith("NaN")) throw new CompileError("Invalid JSON number: NaN");
    if (this.startsWith("Infinity")) throw new CompileError("Invalid JSON number: Infinity");
    if (this.startsWith("-Infinity")) throw new CompileError("Invalid JSON number: -Infinity");
    const char = this.peek();
    if (char === "{") return this.parseObject();
    if (char === "[") return this.parseArray();
    if (char === '"') {
      this.index += 1;
      return this.parseString();
    }
    if (char === "-" || (char >= "0" && char <= "9")) return this.parseNumber();
    if (this.consumeWord("true")) return true;
    if (this.consumeWord("false")) return false;
    if (this.consumeWord("null")) return null;
    throw new CompileError(`Invalid JSON at position ${this.index}`);
  }

  private parseObject(): Record<string, unknown> {
    this.expect("{");
    const result: Record<string, unknown> = Object.create(null);
    this.skipWs();
    if (this.peek() === "}") {
      this.index += 1;
      return result;
    }
    for (;;) {
      this.skipWs();
      if (this.peek() !== '"') throw new CompileError(`Expected a string key at position ${this.index}`);
      this.index += 1;
      const key = this.parseString();
      this.skipWs();
      this.expect(":");
      const value = this.parseValue();
      if (Object.hasOwn(result, key)) throw new CompileError(`Duplicate JSON key: ${key}`);
      result[key] = value;
      this.skipWs();
      if (this.peek() === ",") {
        this.index += 1;
        continue;
      }
      if (this.peek() === "}") {
        this.index += 1;
        break;
      }
      throw new CompileError(`Expected ',' or '}' at position ${this.index}`);
    }
    return result;
  }

  private parseArray(): unknown[] {
    this.expect("[");
    const result: unknown[] = [];
    this.skipWs();
    if (this.peek() === "]") {
      this.index += 1;
      return result;
    }
    for (;;) {
      result.push(this.parseValue());
      this.skipWs();
      if (this.peek() === ",") {
        this.index += 1;
        continue;
      }
      if (this.peek() === "]") {
        this.index += 1;
        break;
      }
      throw new CompileError(`Expected ',' or ']' at position ${this.index}`);
    }
    return result;
  }

  private parseString(): string {
    let out = "";
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      this.index += 1;
      if (char === '"') return out;
      if (char === "\\") {
        const escape = this.source[this.index];
        this.index += 1;
        if (escape === '"' || escape === "\\" || escape === "/") out += escape;
        else if (escape === "b") out += "\b";
        else if (escape === "f") out += "\f";
        else if (escape === "n") out += "\n";
        else if (escape === "r") out += "\r";
        else if (escape === "t") out += "\t";
        else if (escape === "u") out += this.parseUnicodeEscape();
        else throw new CompileError(`Invalid escape at position ${this.index}`);
        continue;
      }
      if (char !== undefined && char.charCodeAt(0) < 0x20) {
        throw new CompileError(`Unescaped control character at position ${this.index}`);
      }
      out += char;
    }
    throw new CompileError("Unterminated string");
  }

  private parseUnicodeEscape(): string {
    const hex = this.source.slice(this.index, this.index + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new CompileError("Invalid unicode escape");
    this.index += 4;
    const code = Number.parseInt(hex, 16);
    if (code >= 0xd800 && code <= 0xdbff && this.source.startsWith("\\u", this.index)) {
      const lowHex = this.source.slice(this.index + 2, this.index + 6);
      if (/^[0-9a-fA-F]{4}$/.test(lowHex)) {
        const low = Number.parseInt(lowHex, 16);
        if (low >= 0xdc00 && low <= 0xdfff) {
          this.index += 6;
          return String.fromCodePoint(((code - 0xd800) << 10) + (low - 0xdc00) + 0x10000);
        }
      }
    }
    return String.fromCharCode(code);
  }

  private parseNumber(): number | PyFloat {
    const start = this.index;
    if (this.peek() === "-") this.index += 1;
    if (this.peek() === "0") {
      this.index += 1;
    } else if (this.peek() >= "1" && this.peek() <= "9") {
      while (this.isDigit()) this.index += 1;
    } else {
      throw new CompileError(`Invalid JSON number at position ${start}`);
    }
    let isFloat = false;
    if (this.peek() === ".") {
      isFloat = true;
      this.index += 1;
      if (!this.isDigit()) throw new CompileError(`Invalid JSON number at position ${start}`);
      while (this.isDigit()) this.index += 1;
    }
    if (this.peek() === "e" || this.peek() === "E") {
      isFloat = true;
      this.index += 1;
      if (this.peek() === "+" || this.peek() === "-") this.index += 1;
      if (!this.isDigit()) throw new CompileError(`Invalid JSON number at position ${start}`);
      while (this.isDigit()) this.index += 1;
    }
    const token = this.source.slice(start, this.index);
    const value = Number(token);
    if (!Number.isFinite(value)) throw new CompileError(`Invalid JSON number: ${token}`);
    if (!isFloat) {
      if (!Number.isSafeInteger(value)) throw new CompileError(`Invalid JSON number: ${token}`);
      return value;
    }
    return new PyFloat(value);
  }

  private isDigit(): boolean {
    const char = this.peek();
    return char >= "0" && char <= "9";
  }

  private expect(char: string): void {
    if (this.peek() !== char) throw new CompileError(`Expected '${char}' at position ${this.index}`);
    this.index += 1;
  }

  private startsWith(word: string): boolean {
    return this.source.startsWith(word, this.index);
  }

  private consumeWord(word: string): boolean {
    if (!this.source.startsWith(word, this.index)) return false;
    const next = this.source[this.index + word.length] ?? "";
    if (/[A-Za-z0-9_]/.test(next)) return false;
    this.index += word.length;
    return true;
  }
}
