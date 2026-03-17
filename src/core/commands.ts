// ============================================================
// core/commands.ts — /slash command handling
// ============================================================

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";
import { OllamaClient } from "../ollama.js";
import { loadConfig, saveConfig } from "../config.js";
import type { Agent } from "./agent.js";
import { c, printHelp } from "../ui/renderer.js";
import type { Config } from "../types.js";

export type CommandResult =
  | { type: "continue" }
  | { type: "exit" }
  | { type: "clear" }
  | { type: "model_changed"; model: string }
  | { type: "error"; message: string };

export async function handleSlashCommand(
  input: string,
  agent: Agent,
  ollamaClient: OllamaClient,
  setWorkingDir: (dir: string) => void
): Promise<CommandResult> {
  const trimmed = input.trim();
  const [command, ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(" ");

  switch (command) {
    // ── /help ──────────────────────────────────────────────
    case "/help":
    case "/h":
      printHelp();
      return { type: "continue" };

    // ── /exit / /quit ──────────────────────────────────────
    case "/exit":
    case "/quit":
    case "/q":
      return { type: "exit" };

    // ── /clear ─────────────────────────────────────────────
    case "/clear":
    case "/cls":
      agent.clearHistory();
      console.clear();
      console.log(c.green("✓ Conversation history cleared."));
      return { type: "clear" };

    // ── /pwd ───────────────────────────────────────────────
    case "/pwd":
      console.log(c.cyan(agent.workingDirectory));
      return { type: "continue" };

    // ── /cd ────────────────────────────────────────────────
    case "/cd": {
      if (!arg) {
        console.log(c.red("Usage: /cd <path>"));
        return { type: "continue" };
      }
      const newDir = resolve(agent.workingDirectory, arg);
      if (!existsSync(newDir) || !statSync(newDir).isDirectory()) {
        console.log(c.red(`Directory not found: ${newDir}`));
        return { type: "continue" };
      }
      setWorkingDir(newDir);
      console.log(c.green(`✓ Changed directory to: ${newDir}`));
      return { type: "continue" };
    }

    // ── /models ────────────────────────────────────────────
    case "/models": {
      let models;
      try {
        models = await ollamaClient.listModels();
      } catch (e) {
        console.log(c.red(`Failed to list models: ${e}`));
        return { type: "continue" };
      }
      if (!models.length) {
        console.log(c.yellow("No models installed. Run: ollama pull <model>"));
        return { type: "continue" };
      }
      console.log(`\n${c.bold("Available Ollama Models")}\n`);
      models.forEach((m) => {
        const active = m.name === agent.config.model;
        const size = formatBytes(m.size);
        const marker = active ? c.green(" ◀ active") : "";
        console.log(`  ${c.cyan(m.name.padEnd(40))} ${c.dim(size)}${marker}`);
      });
      console.log();
      return { type: "continue" };
    }

    // ── /model ─────────────────────────────────────────────
    case "/model": {
      if (!arg) {
        console.log(`Current model: ${c.cyan(agent.config.model)}`);
        return { type: "continue" };
      }
      agent.updateConfig({ model: arg });
      const cfg = loadConfig();
      cfg.model = arg;
      saveConfig(cfg);
      console.log(c.green(`✓ Switched to model: ${arg}`));
      return { type: "model_changed", model: arg };
    }

    // ── /config ────────────────────────────────────────────
    case "/config": {
      const cfg = agent.config;
      console.log(`\n${c.bold("Current Configuration")}\n`);
      const rows: [string, string][] = [
        ["ollamaUrl", cfg.ollamaUrl],
        ["model", cfg.model],
        ["temperature", String(cfg.temperature)],
        ["maxTokens", String(cfg.maxTokens)],
        ["autoApprove", String(cfg.autoApprove)],
        ["verbose", String(cfg.verbose)],
        ["maxFileSize", formatBytes(cfg.maxFileSize)],
      ];
      rows.forEach(([k, v]) => {
        console.log(`  ${c.cyan(k.padEnd(16))} ${v}`);
      });
      console.log();
      return { type: "continue" };
    }

    // ── /set ───────────────────────────────────────────────
    case "/set": {
      const [key, ...valueParts] = rest;
      const value = valueParts.join(" ");
      if (!key || !value) {
        console.log(c.red("Usage: /set <key> <value>"));
        console.log(c.dim("Keys: model, temperature, maxTokens, autoApprove, verbose, ollamaUrl"));
        return { type: "continue" };
      }
      const partial = parseConfigValue(key, value);
      if (!partial) {
        console.log(c.red(`Unknown config key: ${key}`));
        return { type: "continue" };
      }
      agent.updateConfig(partial);
      const cfg = { ...loadConfig(), ...partial };
      saveConfig(cfg);
      console.log(c.green(`✓ Set ${key} = ${value}`));
      return { type: "continue" };
    }

    // ── /approve ───────────────────────────────────────────
    case "/approve": {
      const val = arg.toLowerCase();
      if (val !== "on" && val !== "off") {
        console.log(c.red("Usage: /approve on|off"));
        return { type: "continue" };
      }
      agent.updateConfig({ autoApprove: val === "on" });
      console.log(c.green(`✓ Auto-approve: ${val}`));
      return { type: "continue" };
    }

    // ── /verbose ───────────────────────────────────────────
    case "/verbose": {
      const val = arg.toLowerCase();
      if (val !== "on" && val !== "off") {
        console.log(c.red("Usage: /verbose on|off"));
        return { type: "continue" };
      }
      agent.updateConfig({ verbose: val === "on" });
      console.log(c.green(`✓ Verbose: ${val}`));
      return { type: "continue" };
    }

    // ── /history ───────────────────────────────────────────
    case "/history": {
      const hist = agent.history;
      if (!hist.length) {
        console.log(c.dim("No history yet."));
        return { type: "continue" };
      }
      console.log(`\n${c.bold("Conversation History")} ${c.dim(`(${hist.length} turns)`)}\n`);
      hist.slice(-10).forEach((turn, i) => {
        console.log(`${c.dim(`${i + 1}.`)} ${c.yellow("You:")} ${turn.userMessage.slice(0, 80)}`);
        console.log(`   ${c.cyan("AI: ")} ${turn.assistantMessage.slice(0, 80)}`);
        if (turn.toolCalls.length) {
          console.log(c.dim(`    Tools: ${turn.toolCalls.map((t) => t.toolName).join(", ")}`));
        }
        console.log();
      });
      return { type: "continue" };
    }

    // ── /add ───────────────────────────────────────────────
    case "/add": {
      if (!arg) {
        console.log(c.red("Usage: /add <file-path>"));
        return { type: "continue" };
      }
      const filePath = resolve(agent.workingDirectory, arg);
      if (!existsSync(filePath)) {
        console.log(c.red(`File not found: ${filePath}`));
        return { type: "continue" };
      }
      try {
        const content = readFileSync(filePath, "utf-8");
        agent.addFileContext(filePath, content);
        console.log(c.green(`✓ Added ${filePath} to context`));
      } catch (e) {
        console.log(c.red(`Failed to read file: ${e}`));
      }
      return { type: "continue" };
    }

    // ── /undo ──────────────────────────────────────────────
    case "/undo": {
      const changes = agent.getFileChanges();
      if (!changes.length) {
        console.log(c.dim("No file changes to undo."));
        return { type: "continue" };
      }
      const last = changes[changes.length - 1];
      console.log(c.yellow(`Last change: ${last.action} ${last.path}`));
      console.log(c.dim("Note: Undo is tracked but file restoration requires the previous content to be saved."));
      return { type: "continue" };
    }

    // ── /pull ──────────────────────────────────────────────
    case "/pull": {
      if (!arg) {
        console.log(c.red("Usage: /pull <model-name>"));
        return { type: "continue" };
      }
      console.log(c.cyan(`Pulling model: ${arg}...`));
      try {
        await ollamaClient.pullModel(arg, (status) => {
          process.stdout.write(`\r${c.dim(status)}   `);
        });
        process.stdout.write("\n");
        console.log(c.green(`✓ Model ${arg} pulled successfully`));
      } catch (e) {
        console.log(c.red(`Failed: ${e}`));
      }
      return { type: "continue" };
    }

    // ── Unknown command ────────────────────────────────────
    default:
      console.log(c.red(`Unknown command: ${command}. Type /help for available commands.`));
      return { type: "continue" };
  }
}

// ── Helpers ───────────────────────────────────────────────

function parseConfigValue(key: string, value: string): Partial<Config> | null {
  switch (key) {
    case "model": return { model: value };
    case "ollamaUrl": return { ollamaUrl: value };
    case "temperature": return { temperature: parseFloat(value) };
    case "maxTokens": return { maxTokens: parseInt(value, 10) };
    case "autoApprove": return { autoApprove: value === "true" || value === "1" || value === "on" };
    case "verbose": return { verbose: value === "true" || value === "1" || value === "on" };
    default: return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}