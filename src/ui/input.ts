// ============================================================
// ui/input.ts — line editor with history and multi-line support
// ============================================================

import { createInterface, Interface } from "readline";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { c } from "./renderer.js";

const HISTORY_FILE = join(homedir(), ".ollamacode", "history.txt");
const MAX_HISTORY = 1000;

export class InputManager {
  private rl: Interface;
  private history: string[] = [];
  private historyIndex = -1;

  constructor() {
    this.loadHistory();
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      historySize: MAX_HISTORY,
      terminal: true,
    });
  }

  private loadHistory(): void {
    try {
      if (existsSync(HISTORY_FILE)) {
        this.history = readFileSync(HISTORY_FILE, "utf-8")
          .split("\n")
          .filter(Boolean)
          .slice(-MAX_HISTORY);
      }
    } catch {}
  }

  private saveHistory(input: string): void {
    if (!input.trim() || input === this.history[this.history.length - 1]) return;
    this.history.push(input);
    try {
      appendFileSync(HISTORY_FILE, input + "\n", "utf-8");
    } catch {}
  }

  async readline(prompt: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => {
        if (answer !== null) this.saveHistory(answer);
        resolve(answer);
      });
    });
  }

  close(): void {
    this.rl.close();
  }
}

// ── Multi-line input collector ────────────────────────────
// When user types >>> at start of line or uses shift+enter equivalent

export function buildPrompt(cwd: string, model: string): string {
  const dir = cwd.replace(homedir(), "~");
  const shortModel = model.split(":")[0].split("/").pop() ?? model;
  return `\n${c.dim(dir)} ${c.brightMagenta("⟩")} ${c.dim(`[${shortModel}]`)} \n${c.brightMagenta("❯")} `;
}