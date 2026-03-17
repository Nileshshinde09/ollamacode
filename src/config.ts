// ============================================================
// config.ts — loads, saves, and manages CLI configuration
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Config } from "./types.js";

const CONFIG_DIR = join(homedir(), ".ollamacode");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export const DEFAULT_CONFIG: Config = {
  ollamaUrl: "http://localhost:11434",
  model: "qwen2.5-coder:7b",
  systemPrompt: buildDefaultSystemPrompt(),
  maxTokens: 8192,
  temperature: 0.2,
  autoApprove: false,
  verbose: false,
  maxFileSize: 1024 * 1024, // 1MB
  allowedExtensions: [
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".pyi",
    ".go",
    ".rs",
    ".java", ".kt",
    ".c", ".cpp", ".h", ".hpp",
    ".cs",
    ".rb",
    ".php",
    ".swift",
    ".sh", ".bash", ".zsh", ".fish",
    ".json", ".jsonc",
    ".yaml", ".yml",
    ".toml",
    ".env", ".env.example",
    ".md", ".mdx", ".txt",
    ".html", ".htm", ".css", ".scss", ".sass", ".less",
    ".sql",
    ".graphql", ".gql",
    ".dockerfile", "Dockerfile",
    ".xml",
    ".vue", ".svelte",
    ".r", ".R",
    ".lua",
    ".dart",
    "Makefile", "makefile",
    ".gitignore", ".gitattributes",
    "README", "LICENSE",
  ],
};

function buildDefaultSystemPrompt(): string {
  return `You are OllamaCode, an expert AI coding assistant running locally via Ollama. You help users with software engineering tasks in their terminal.

You have access to tools that let you read files, write files, execute shell commands, search code, and more. Use them proactively to understand the codebase and complete tasks.

## Guidelines

- **Always read files before editing** — use read_file to understand existing code before making changes.
- **Make targeted edits** — use write_file for complete rewrites, use edit_file for surgical edits.
- **Explain your reasoning** — briefly explain what you're doing and why.
- **Be safe** — never execute destructive commands without warning. Never delete files unless explicitly asked.
- **Stay focused** — complete the task fully. If you need to chain multiple steps, do so autonomously.
- **Follow code style** — match the existing code style, naming conventions, and patterns in the project.
- **Test your changes** — after editing, verify files were written correctly.

## Tool Usage

You must respond with tool calls when you need to interact with the filesystem or run commands. After each tool result, continue working toward completing the user's request.

When a task is complete, summarize what you did clearly and concisely.`;
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const saved = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: Config): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}