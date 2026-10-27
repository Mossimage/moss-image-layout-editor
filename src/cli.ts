import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compilePrompt } from "./compile/compilePrompt.ts";
import { CompileError } from "./compile/errors.ts";
import { parseDraftJson } from "./compile/json.ts";

export interface CliIo {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
}

const HELP = `Compile a caption or absolute-pixel Layout draft into a MOSS-Image prompt.

Usage: compile-prompt <draft.json> [--output prompt.txt]
`;

interface Args {
  help: boolean;
  draft?: string;
  output?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token === "-h" || token === "--help") {
      args.help = true;
    } else if (token === "--output") {
      const value = argv[index + 1];
      if (value === undefined) throw new CompileError("argument --output: expected a path");
      args.output = value;
      index += 1;
    } else if (token.startsWith("--output=")) {
      args.output = token.slice("--output=".length);
    } else if (token.startsWith("-")) {
      throw new CompileError(`unrecognized arguments: ${token}`);
    } else if (args.draft === undefined) {
      args.draft = token;
    } else {
      throw new CompileError(`unrecognized arguments: ${token}`);
    }
  }
  return args;
}

function samePath(left: string, right: string): boolean {
  const identity = (file: string) => {
    const absolute = path.resolve(file);
    try {
      return realpathSync(absolute);
    } catch {
      return absolute;
    }
  };
  return identity(left) === identity(right);
}

/** CLI entry with the same success and failure behavior as compile_prompt.py. */
export function runCli(argv: readonly string[], io: CliIo = { stdout: process.stdout, stderr: process.stderr }): number {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      io.stdout.write(HELP);
      return 0;
    }
    if (args.draft === undefined) {
      io.stderr.write("Error: the following arguments are required: draft\n");
      return 2;
    }
    if (args.output !== undefined && samePath(args.draft, args.output)) {
      throw new CompileError("Output must be separate from the editable draft");
    }
    const draft = parseDraftJson(readFileSync(args.draft, "utf-8"));
    const prompt = compilePrompt(draft);
    if (args.output !== undefined) {
      mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
      writeFileSync(args.output, `${prompt}\n`, "utf-8");
      io.stderr.write(`Wrote ${args.output}\n`);
    } else {
      io.stdout.write(`${prompt}\n`);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`Error: ${message}\n`);
    return 2;
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  process.exit(runCli(process.argv.slice(2)));
}
