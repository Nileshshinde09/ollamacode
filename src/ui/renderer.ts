// ============================================================
// ui/renderer.ts — terminal colours, spinners, formatted output
// ============================================================

import { createInterface } from "readline";

// ── ANSI colour helpers ───────────────────────────────────

const ESC = "\x1b";
const RESET = `${ESC}[0m`;

export const c = {
  reset: (s: string) => `${RESET}${s}${RESET}`,
  bold: (s: string) => `${ESC}[1m${s}${RESET}`,
  dim: (s: string) => `${ESC}[2m${s}${RESET}`,
  italic: (s: string) => `${ESC}[3m${s}${RESET}`,
  underline: (s: string) => `${ESC}[4m${s}${RESET}`,

  // Foreground
  black: (s: string) => `${ESC}[30m${s}${RESET}`,
  red: (s: string) => `${ESC}[31m${s}${RESET}`,
  green: (s: string) => `${ESC}[32m${s}${RESET}`,
  yellow: (s: string) => `${ESC}[33m${s}${RESET}`,
  blue: (s: string) => `${ESC}[34m${s}${RESET}`,
  magenta: (s: string) => `${ESC}[35m${s}${RESET}`,
  cyan: (s: string) => `${ESC}[36m${s}${RESET}`,
  white: (s: string) => `${ESC}[37m${s}${RESET}`,
  gray: (s: string) => `${ESC}[90m${s}${RESET}`,

  // Bright
  brightRed: (s: string) => `${ESC}[91m${s}${RESET}`,
  brightGreen: (s: string) => `${ESC}[92m${s}${RESET}`,
  brightYellow: (s: string) => `${ESC}[93m${s}${RESET}`,
  brightBlue: (s: string) => `${ESC}[94m${s}${RESET}`,
  brightMagenta: (s: string) => `${ESC}[95m${s}${RESET}`,
  brightCyan: (s: string) => `${ESC}[96m${s}${RESET}`,

  // Background
  bgBlue: (s: string) => `${ESC}[44m${s}${RESET}`,
  bgGreen: (s: string) => `${ESC}[42m${s}${RESET}`,
  bgRed: (s: string) => `${ESC}[41m${s}${RESET}`,
  bgYellow: (s: string) => `${ESC}[43m${s}${RESET}`,
  bgMagenta: (s: string) => `${ESC}[45m${s}${RESET}`,
};

// ── Spinner ───────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  private frame = 0;
  private timer?: ReturnType<typeof setInterval>;
  private message: string;

  constructor(message: string) {
    this.message = message;
  }

  start(): void {
    process.stdout.write("\x1b[?25l"); // hide cursor
    this.timer = setInterval(() => {
      const frame = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
      process.stdout.write(`\r${c.cyan(frame)} ${c.dim(this.message)}   `);
      this.frame++;
    }, 80);
  }

  update(message: string): void {
    this.message = message;
  }

  stop(finalMessage?: string): void {
    if (this.timer) clearInterval(this.timer);
    process.stdout.write("\r\x1b[K"); // clear line
    process.stdout.write("\x1b[?25h"); // show cursor
    if (finalMessage) process.stdout.write(finalMessage + "\n");
  }
}

// ── Box drawing ───────────────────────────────────────────

export function box(title: string, content: string, color: (s: string) => string = c.cyan): string {
  const lines = content.split("\n");
  const maxLen = Math.max(title.length + 4, ...lines.map((l) => stripAnsi(l).length)) + 2;
  const top = color(`╭─ ${title} ${"─".repeat(Math.max(0, maxLen - title.length - 4))}╮`);
  const bottom = color(`╰${"─".repeat(maxLen)}╯`);
  const middle = lines.map((l) => color("│") + ` ${l}`).join("\n");
  return `${top}\n${middle}\n${bottom}`;
}

export function horizontalRule(char = "─", width = 60): string {
  return c.dim(char.repeat(width));
}

// ── Strip ANSI ────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// ── Simple markdown → terminal renderer ──────────────────

export function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Headings
    if (line.startsWith("#### ")) { out.push(c.bold(c.yellow(line.slice(5)))); continue; }
    if (line.startsWith("### ")) { out.push(c.bold(c.cyan(line.slice(4)))); continue; }
    if (line.startsWith("## ")) { out.push(c.bold(c.brightBlue("  " + line.slice(3)))); continue; }
    if (line.startsWith("# ")) { out.push(c.bold(c.brightMagenta(line.slice(2)))); continue; }

    // Code blocks
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      out.push(c.dim(`┌─ ${lang || "code"} ${"─".repeat(Math.max(0, 40 - lang.length - 4))}┐`));
      codeLines.forEach((cl) => out.push(c.dim("│ ") + c.brightGreen(cl)));
      out.push(c.dim("└" + "─".repeat(42) + "┘"));
      continue;
    }

    // Horizontal rule
    if (line === "---" || line === "***" || line === "___") {
      out.push(c.dim("─".repeat(60)));
      continue;
    }

    // Bullet points
    if (line.match(/^(\s*)([-*+]) /)) {
      line = line.replace(/^(\s*)([-*+]) /, (_, indent, _bullet) => `${indent}${c.cyan("•")} `);
    }

    // Numbered list
    if (line.match(/^\s*\d+\. /)) {
      line = line.replace(/^(\s*)(\d+)\. /, (_, indent, num) => `${indent}${c.yellow(num + ".")} `);
    }

    // Bold **text**
    line = line.replace(/\*\*(.+?)\*\*/g, (_, t) => c.bold(t));
    // Italic *text*
    line = line.replace(/\*(.+?)\*/g, (_, t) => c.italic(t));
    // Inline code `code`
    line = line.replace(/`([^`]+)`/g, (_, t) => c.brightGreen(t));
    // Strikethrough ~~text~~
    line = line.replace(/~~(.+?)~~/g, (_, t) => c.dim(t));

    out.push(line);
  }
  return out.join("\n");
}

// ── Prompt input ──────────────────────────────────────────

export async function promptInput(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function promptYesNo(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await promptInput(`${question} ${c.dim(hint)} `);
  if (!answer.trim()) return defaultYes;
  return answer.trim().toLowerCase().startsWith("y");
}

export async function promptSelect(question: string, choices: string[]): Promise<string> {
  console.log(`\n${question}`);
  choices.forEach((ch, i) => {
    console.log(`  ${c.cyan(`${i + 1}.`)} ${ch}`);
  });
  const answer = await promptInput(`\nEnter choice (1-${choices.length}): `);
  const idx = parseInt(answer.trim()) - 1;
  if (isNaN(idx) || idx < 0 || idx >= choices.length) return choices[0];
  return choices[idx];
}

// ── Header / Banner ───────────────────────────────────────

export function printBanner(model: string, ollamaUrl: string, cwd: string): void {
  console.log();
  console.log(c.bold(c.brightMagenta("  ╔═══════════════════════════════════════╗")));
  console.log(c.bold(c.brightMagenta("  ║") + c.bold("         🦙 OllamaCode  v1.0.0         ") + c.bold(c.brightMagenta("║"))));
  console.log(c.bold(c.brightMagenta("  ╚═══════════════════════════════════════╝")));
  console.log();
  console.log(`  ${c.dim("Model  :")} ${c.brightCyan(model)}`);
  console.log(`  ${c.dim("Ollama :")} ${c.dim(ollamaUrl)}`);
  console.log(`  ${c.dim("Dir    :")} ${c.dim(cwd)}`);
  console.log();
  console.log(`  ${c.dim("Type")} ${c.yellow("/help")} ${c.dim("for commands,")} ${c.yellow("/exit")} ${c.dim("to quit")}`);
  console.log();
}

export function printHelp(): void {
  const cmds = [
    ["/help", "Show this help message"],
    ["/exit or /quit", "Exit OllamaCode"],
    ["/clear", "Clear conversation history"],
    ["/model [name]", "Switch Ollama model"],
    ["/models", "List available Ollama models"],
    ["/config", "Show current configuration"],
    ["/set <key> <value>", "Update a config value"],
    ["/undo", "Undo last file change"],
    ["/history", "Show conversation history"],
    ["/cd <path>", "Change working directory"],
    ["/pwd", "Show current directory"],
    ["/add <file>", "Add file content to context"],
    ["/approve on|off", "Toggle auto-approval of tool calls"],
    ["/verbose on|off", "Toggle verbose tool output"],
    ["", ""],
    ["Keyboard shortcuts", ""],
    ["  Ctrl+C", "Interrupt current operation"],
    ["  Up/Down arrow", "Navigate input history"],
  ];
  console.log("\n" + c.bold(c.brightBlue("  OllamaCode Commands")) + "\n");
  cmds.forEach(([cmd, desc]) => {
    if (!cmd && !desc) { console.log(); return; }
    if (!desc) { console.log(`  ${c.bold(c.yellow(cmd))}`); return; }
    console.log(`  ${c.cyan(cmd.padEnd(22))} ${c.dim(desc)}`);
  });
  console.log();
}