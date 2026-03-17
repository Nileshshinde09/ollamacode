// ============================================================
// tools/index.ts — filesystem, shell, and search tools
// ============================================================

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  renameSync,
  copyFileSync,
} from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { join, resolve, dirname, relative, extname } from "path";
import type { ToolDefinition, ToolResult } from "../types.js";

const execAsync = promisify(exec);

// ── Tool Registry ─────────────────────────────────────────

export interface Tool {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>, cwd: string) => Promise<ToolResult>;
}

// ── read_file ─────────────────────────────────────────────

export const readFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a file. Returns the file content as a string. Use this to understand existing code before making changes.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file (absolute or relative to working directory)",
          },
          start_line: {
            type: "number",
            description: "Optional: first line to read (1-indexed, inclusive)",
          },
          end_line: {
            type: "number",
            description: "Optional: last line to read (1-indexed, inclusive)",
          },
        },
        required: ["path"],
      },
    },
  },
  async execute(args, cwd) {
    try {
      const filePath = resolve(cwd, args.path as string);
      if (!existsSync(filePath)) {
        return { success: false, output: "", error: `File not found: ${filePath}` };
      }
      const stat = statSync(filePath);
      if (stat.size > 2 * 1024 * 1024) {
        return { success: false, output: "", error: "File too large (>2MB). Use grep or read specific lines." };
      }
      let content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      const startLine = args.start_line as number | undefined;
      const endLine = args.end_line as number | undefined;

      if (startLine || endLine) {
        const from = (startLine ?? 1) - 1;
        const to = endLine ?? lines.length;
        const sliced = lines.slice(from, to);
        content = sliced
          .map((l, i) => `${from + i + 1} | ${l}`)
          .join("\n");
        return { success: true, output: `Lines ${from + 1}-${Math.min(to, lines.length)} of ${filePath}:\n\n${content}` };
      }

      // Add line numbers for easy reference
      const numbered = lines.map((l, i) => `${i + 1} | ${l}`).join("\n");
      return { success: true, output: `File: ${filePath} (${lines.length} lines)\n\n${numbered}` };
    } catch (e) {
      return { success: false, output: "", error: String(e) };
    }
  },
};

// ── write_file ────────────────────────────────────────────

export const writeFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Write (create or overwrite) a file with the given content. Creates parent directories if needed. Use this for new files or full rewrites.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file" },
          content: { type: "string", description: "Full file content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  async execute(args, cwd) {
    try {
      const filePath = resolve(cwd, args.path as string);
      const dir = dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, args.content as string, "utf-8");
      const lines = (args.content as string).split("\n").length;
      return { success: true, output: `Written ${lines} lines to ${filePath}` };
    } catch (e) {
      return { success: false, output: "", error: String(e) };
    }
  },
};

// ── edit_file ─────────────────────────────────────────────

export const editFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Make surgical edits to a file by replacing specific text. The old_str must exactly match text in the file (including whitespace). Use for targeted changes instead of rewriting the whole file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file" },
          old_str: {
            type: "string",
            description: "Exact string to find and replace. Must be unique in the file.",
          },
          new_str: {
            type: "string",
            description: "Replacement string. Use empty string to delete old_str.",
          },
        },
        required: ["path", "old_str", "new_str"],
      },
    },
  },
  async execute(args, cwd) {
    try {
      const filePath = resolve(cwd, args.path as string);
      if (!existsSync(filePath)) {
        return { success: false, output: "", error: `File not found: ${filePath}` };
      }
      const content = readFileSync(filePath, "utf-8");
      const oldStr = args.old_str as string;
      const newStr = args.new_str as string;

      const occurrences = content.split(oldStr).length - 1;
      if (occurrences === 0) {
        return { success: false, output: "", error: `old_str not found in ${filePath}. Make sure it matches exactly (including whitespace).` };
      }
      if (occurrences > 1) {
        return { success: false, output: "", error: `old_str found ${occurrences} times in ${filePath}. Make old_str more specific so it matches exactly once.` };
      }

      const updated = content.replace(oldStr, newStr);
      writeFileSync(filePath, updated, "utf-8");
      return { success: true, output: `Successfully edited ${filePath}` };
    } catch (e) {
      return { success: false, output: "", error: String(e) };
    }
  },
};

// ── list_directory ────────────────────────────────────────

export const listDirectoryTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "list_directory",
      description:
        "List files and directories. Shows file sizes and types. Use to explore project structure.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path (default: current working directory)",
          },
          recursive: {
            type: "boolean",
            description: "Whether to list recursively (default: false)",
          },
          max_depth: {
            type: "number",
            description: "Max depth for recursive listing (default: 3)",
          },
        },
      },
    },
  },
  async execute(args, cwd) {
    try {
      const dirPath = resolve(cwd, (args.path as string) ?? ".");
      if (!existsSync(dirPath)) {
        return { success: false, output: "", error: `Directory not found: ${dirPath}` };
      }
      const recursive = (args.recursive as boolean) ?? false;
      const maxDepth = (args.max_depth as number) ?? 3;

      const lines: string[] = [];
      const IGNORED = new Set([
        "node_modules", ".git", ".svn", "__pycache__",
        ".pytest_cache", "dist", "build", ".next",
        ".nuxt", "coverage", ".nyc_output", "target",
      ]);

      function walk(dir: string, depth: number, prefix: string) {
        if (depth > maxDepth) return;
        let entries: string[];
        try {
          entries = readdirSync(dir).sort();
        } catch {
          return;
        }
        entries.forEach((entry, idx) => {
          if (IGNORED.has(entry)) return;
          const fullPath = join(dir, entry);
          const isLast = idx === entries.length - 1;
          const connector = isLast ? "└── " : "├── ";
          let stat;
          try {
            stat = statSync(fullPath);
          } catch {
            return;
          }
          if (stat.isDirectory()) {
            lines.push(`${prefix}${connector}${entry}/`);
            if (recursive || depth === 0) {
              walk(fullPath, depth + 1, prefix + (isLast ? "    " : "│   "));
            }
          } else {
            const size = formatBytes(stat.size);
            lines.push(`${prefix}${connector}${entry} (${size})`);
          }
        });
      }

      lines.push(`${dirPath}/`);
      walk(dirPath, 0, "");
      return { success: true, output: lines.join("\n") };
    } catch (e) {
      return { success: false, output: "", error: String(e) };
    }
  },
};

// ── bash ──────────────────────────────────────────────────

export const bashTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "bash",
      description:
        "Execute a shell command in the working directory. Use for running tests, installing packages, building projects, git operations, etc. Commands run with a 60-second timeout by default.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Shell command to execute",
          },
          timeout: {
            type: "number",
            description: "Timeout in seconds (default: 60, max: 300)",
          },
          description: {
            type: "string",
            description: "Brief description of what this command does (shown to user for approval)",
          },
        },
        required: ["command"],
      },
    },
  },
  async execute(args, cwd) {
    const command = args.command as string;
    const timeoutMs = Math.min((args.timeout as number ?? 60), 300) * 1000;
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });
      let output = "";
      if (stdout.trim()) output += stdout;
      if (stderr.trim()) output += (output ? "\n[stderr]\n" : "") + stderr;
      return { success: true, output: output || "(no output)" };
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      let msg = err.message ?? String(e);
      if (err.stdout) msg += `\n[stdout]\n${err.stdout}`;
      if (err.stderr) msg += `\n[stderr]\n${err.stderr}`;
      return { success: false, output: msg, error: msg };
    }
  },
};

// ── grep / search ─────────────────────────────────────────

export const grepTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "grep",
      description:
        "Search for a pattern in files. Returns matching lines with file paths and line numbers. Useful for finding function definitions, variable usages, TODO comments, etc.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex or literal string to search for",
          },
          path: {
            type: "string",
            description: "Directory or file path to search in (default: working directory)",
          },
          file_pattern: {
            type: "string",
            description: "Glob pattern to filter files (e.g. '*.ts', '*.py')",
          },
          case_sensitive: {
            type: "boolean",
            description: "Case-sensitive search (default: false)",
          },
          max_results: {
            type: "number",
            description: "Max number of matches to return (default: 50)",
          },
        },
        required: ["pattern"],
      },
    },
  },
  async execute(args, cwd) {
    try {
      const pattern = args.pattern as string;
      const searchPath = resolve(cwd, (args.path as string) ?? ".");
      const caseSensitive = (args.case_sensitive as boolean) ?? false;
      const maxResults = (args.max_results as number) ?? 50;
      const filePattern = (args.file_pattern as string) ?? "";

      const flags = caseSensitive ? "" : "-i";
      const includeFlag = filePattern ? `--include='${filePattern}'` : "";
      const cmd = `grep -rn ${flags} ${includeFlag} --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist -E '${pattern.replace(/'/g, "\\'")}' '${searchPath}' 2>/dev/null | head -${maxResults}`;

      const { stdout } = await execAsync(cmd, { timeout: 15000 }).catch(() => ({ stdout: "" }));
      if (!stdout.trim()) {
        return { success: true, output: `No matches found for pattern: ${pattern}` };
      }
      return { success: true, output: stdout };
    } catch (e) {
      return { success: false, output: "", error: String(e) };
    }
  },
};

// ── find_files ────────────────────────────────────────────

export const findFilesTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "find_files",
      description:
        "Find files by name pattern or extension. Returns matching file paths.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Filename pattern (glob, e.g. '*.py', 'config.*', 'index.ts')",
          },
          path: {
            type: "string",
            description: "Root directory to search in (default: working directory)",
          },
          max_results: {
            type: "number",
            description: "Max results (default: 30)",
          },
        },
        required: ["pattern"],
      },
    },
  },
  async execute(args, cwd) {
    try {
      const searchPath = resolve(cwd, (args.path as string) ?? ".");
      const pattern = args.pattern as string;
      const max = (args.max_results as number) ?? 30;
      const cmd = `find '${searchPath}' -name '${pattern}' -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/__pycache__/*' 2>/dev/null | head -${max}`;
      const { stdout } = await execAsync(cmd, { timeout: 10000 }).catch(() => ({ stdout: "" }));
      if (!stdout.trim()) {
        return { success: true, output: `No files found matching: ${pattern}` };
      }
      return { success: true, output: stdout.trim() };
    } catch (e) {
      return { success: false, output: "", error: String(e) };
    }
  },
};

// ── delete_file ───────────────────────────────────────────

export const deleteFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file. Use with caution — this is irreversible.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to delete" },
        },
        required: ["path"],
      },
    },
  },
  async execute(args, cwd) {
    try {
      const filePath = resolve(cwd, args.path as string);
      if (!existsSync(filePath)) {
        return { success: false, output: "", error: `File not found: ${filePath}` };
      }
      unlinkSync(filePath);
      return { success: true, output: `Deleted: ${filePath}` };
    } catch (e) {
      return { success: false, output: "", error: String(e) };
    }
  },
};

// ── move_file ─────────────────────────────────────────────

export const moveFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "move_file",
      description: "Move or rename a file.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", description: "Source path" },
          destination: { type: "string", description: "Destination path" },
        },
        required: ["source", "destination"],
      },
    },
  },
  async execute(args, cwd) {
    try {
      const src = resolve(cwd, args.source as string);
      const dst = resolve(cwd, args.destination as string);
      const dstDir = dirname(dst);
      if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
      renameSync(src, dst);
      return { success: true, output: `Moved: ${src} → ${dst}` };
    } catch (e) {
      return { success: false, output: "", error: String(e) };
    }
  },
};

// ── read_multiple_files ───────────────────────────────────

export const readMultipleFilesTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "read_multiple_files",
      description: "Read the contents of multiple files at once. Efficient for understanding related files.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Array of file paths to read",
          },
        },
        required: ["paths"],
      },
    },
  },
  async execute(args, cwd) {
    const paths = args.paths as string[];
    const results: string[] = [];
    for (const p of paths) {
      const filePath = resolve(cwd, p);
      if (!existsSync(filePath)) {
        results.push(`--- ${p} ---\n[File not found]`);
        continue;
      }
      try {
        const stat = statSync(filePath);
        if (stat.size > 500 * 1024) {
          results.push(`--- ${p} ---\n[File too large, use read_file with line ranges]`);
          continue;
        }
        const content = readFileSync(filePath, "utf-8");
        const ext = extname(p);
        results.push(`--- ${p} ---\n\`\`\`${ext.slice(1)}\n${content}\n\`\`\``);
      } catch (e) {
        results.push(`--- ${p} ---\n[Error: ${String(e)}]`);
      }
    }
    return { success: true, output: results.join("\n\n") };
  },
};

// ── git_status / git shortcuts ────────────────────────────

export const gitStatusTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "git_status",
      description: "Show git status, recent commits, and diff summary for the working directory.",
      parameters: {
        type: "object",
        properties: {
          show_diff: {
            type: "boolean",
            description: "Include full diff of unstaged changes (default: false)",
          },
        },
      },
    },
  },
  async execute(args, cwd) {
    try {
      const parts: string[] = [];
      const run = async (cmd: string) => {
        const { stdout } = await execAsync(cmd, { cwd, timeout: 10000 }).catch(() => ({ stdout: "" }));
        return stdout.trim();
      };
      parts.push("=== git status ===\n" + (await run("git status")));
      parts.push("\n=== recent commits ===\n" + (await run("git log --oneline -10")));
      if (args.show_diff) {
        const diff = await run("git diff --stat HEAD");
        if (diff) parts.push("\n=== diff stat ===\n" + diff);
      }
      return { success: true, output: parts.join("\n") };
    } catch (e) {
      return { success: false, output: "", error: String(e) };
    }
  },
};

// ── Tool registry ─────────────────────────────────────────

export const ALL_TOOLS: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool,
  bashTool,
  grepTool,
  findFilesTool,
  deleteFileTool,
  moveFileTool,
  readMultipleFilesTool,
  gitStatusTool,
];

export const TOOL_MAP: Map<string, Tool> = new Map(
  ALL_TOOLS.map((t) => [t.definition.function.name, t])
);

// ── Helpers ───────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// Dangerous patterns that need extra approval warning
export const DANGEROUS_PATTERNS = [
  /\brm\s+-rf?\b/,
  /\brmdir\b/,
  /\bdrop\s+table\b/i,
  /\btruncate\b/i,
  /\bformat\b/i,
  /\bdiskutil\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bchmod\s+777\b/,
  />\s*\/dev\/sd/,
  /\bsudo\b/,
  /\bpasswd\b/,
  /\bcurl.*\|\s*sh\b/,
  /\bwget.*\|\s*sh\b/,
];

export function isDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(command));
}