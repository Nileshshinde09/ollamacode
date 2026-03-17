#!/usr/bin/env node
// ============================================================
// index.ts — OllamaCode CLI entry point
// ============================================================

import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { parseArgs } from "util";

import { loadConfig, saveConfig, getConfigPath } from "./config.js";
import { OllamaClient } from "./ollama.js";
import { Agent } from "./core/agent.js";
import { handleSlashCommand } from "./core/commands.js";
import { InputManager, buildPrompt } from "./ui/input.js";
import {
  c,
  printBanner,
  printHelp,
  Spinner,
  promptSelect,
  promptYesNo,
} from "./ui/renderer.js";
import type { OllamaModel } from "./types.js";

// ── Ensure config dir ────────────────────────────────────
const CONFIG_DIR = resolve(homedir(), ".ollamacode");
if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });

// ── Parse CLI args ────────────────────────────────────────

const { values: cliArgs, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    model: { type: "string", short: "m" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
    "ollama-url": { type: "string" },
    "auto-approve": { type: "boolean", short: "y" },
    verbose: { type: "boolean" },
    dir: { type: "string", short: "d" },
    "print": { type: "string", short: "p" }, // non-interactive, print mode
  },
  allowPositionals: true,
  strict: false,
});

// ── Handle --help / --version ─────────────────────────────

if (cliArgs.help) {
  printHelp();
  process.exit(0);
}

if (cliArgs.version) {
  console.log("OllamaCode v1.0.0");
  process.exit(0);
}

// ── Main ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig();

  // Apply CLI overrides
  if (cliArgs.model) config.model = cliArgs.model as string;
  if (cliArgs["ollama-url"]) config.ollamaUrl = cliArgs["ollama-url"] as string;
  if (cliArgs["auto-approve"]) config.autoApprove = true;
  if (cliArgs.verbose) config.verbose = true;

  const workingDir = cliArgs.dir
    ? resolve(process.cwd(), cliArgs.dir as string)
    : process.cwd();

  const ollamaClient = new OllamaClient(config.ollamaUrl);

  // ── Check Ollama is running ───────────────────────────
  process.stdout.write(c.dim("Checking Ollama... "));
  const running = await ollamaClient.isRunning();
  if (!running) {
    console.log(c.red("✗\n"));
    console.log(c.red("Ollama is not running!"));
    console.log(c.dim("Start it with: ") + c.cyan("ollama serve"));
    console.log(c.dim("Or visit: ") + c.cyan("https://ollama.ai"));
    process.exit(1);
  }
  const version = await ollamaClient.getVersion().catch(() => "?");
  console.log(c.green(`✓ (v${version})`));

  // ── Check/select model ────────────────────────────────
  const models = await ollamaClient.listModels().catch(() => [] as OllamaModel[]);

  if (!models.length) {
    console.log(c.yellow("\nNo models installed."));
    console.log(c.dim("Recommended for coding: "));
    const suggestions = [
      "qwen2.5-coder:7b   (best for coding, ~4GB)",
      "deepseek-coder-v2  (~9GB)",
      "codellama:13b      (~7GB)",
      "llama3.2:3b        (fastest, ~2GB)",
    ];
    suggestions.forEach((s) => console.log(c.dim("  ollama pull ") + c.cyan(s)));

    const shouldPull = await promptYesNo("\nPull a model now?", false);
    if (shouldPull) {
      const choice = await promptSelect("Choose a model to pull:", [
        "qwen2.5-coder:7b",
        "deepseek-coder-v2",
        "codellama:13b",
        "llama3.2:3b",
        "Enter custom name...",
      ]);
      let modelName = choice;
      if (choice === "Enter custom name...") {
        const { createInterface } = await import("readline");
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        modelName = await new Promise((res) => rl.question("Model name: ", (a) => { rl.close(); res(a); }));
      }
      console.log(c.cyan(`\nPulling ${modelName}...`));
      const spinner = new Spinner(`Downloading ${modelName}`);
      spinner.start();
      try {
        await ollamaClient.pullModel(modelName, (status) => spinner.update(status));
        spinner.stop(c.green(`✓ ${modelName} ready`));
        config.model = modelName;
        saveConfig(config);
      } catch (e) {
        spinner.stop();
        console.log(c.red(`Pull failed: ${e}`));
        process.exit(1);
      }
    } else {
      process.exit(0);
    }
  } else {
    // Check if configured model exists
    const modelExists = models.some((m) => m.name === config.model || m.name.startsWith(config.model + ":"));
    if (!modelExists) {
      console.log(c.yellow(`\nModel '${config.model}' not found.`));
      const modelNames = models.map((m) => m.name);
      const selected = await promptSelect("Select an available model:", modelNames);
      config.model = selected;
      saveConfig(config);
    }
  }

  // ── Handle --print mode (non-interactive) ────────────
  const printPrompt = cliArgs["print"] as string | undefined;
  if (printPrompt || positionals.length > 0) {
    const prompt = printPrompt || positionals.join(" ");
    const agent = new Agent(config, workingDir);
    config.autoApprove = true; // always auto-approve in print mode
    agent.updateConfig({ autoApprove: true });
    try {
      await agent.runTurn(prompt);
    } catch (e) {
      console.error(c.red(`Error: ${e}`));
      process.exit(1);
    }
    process.exit(0);
  }

  // ── Interactive REPL ───────────────────────────────────
  printBanner(config.model, config.ollamaUrl, workingDir);

  const agent = new Agent(config, workingDir);
  const inputManager = new InputManager();
  let isRunning = true;
  let currentDir = workingDir;

  const setWorkingDir = (dir: string) => {
    currentDir = dir;
    agent.workingDirectory = dir;
  };

  // Handle Ctrl+C gracefully
  process.on("SIGINT", () => {
    console.log(c.dim("\n\nUse /exit to quit."));
    process.stdout.write(buildPrompt(currentDir, config.model));
  });

  // Main REPL loop
  while (isRunning) {
    let input: string | null;

    try {
      input = await inputManager.readline(buildPrompt(currentDir, agent.config.model));
    } catch {
      break;
    }

    if (input === null) {
      // EOF (Ctrl+D)
      console.log(c.dim("\nGoodbye!"));
      break;
    }

    const trimmed = input.trim();
    if (!trimmed) continue;

    // ── Slash commands ─────────────────────────────────
    if (trimmed.startsWith("/")) {
      const result = await handleSlashCommand(trimmed, agent, ollamaClient, setWorkingDir);
      if (result.type === "exit") {
        isRunning = false;
        break;
      }
      continue;
    }

    // ── AI turn ────────────────────────────────────────
    try {
      await agent.runTurn(trimmed);
    } catch (e: unknown) {
      const err = e as Error;
      console.log(c.red(`\n✗ Error: ${err.message ?? String(e)}`));

      // Model-specific hints
      if (err.message?.includes("model") && err.message?.includes("not found")) {
        console.log(c.dim(`Try: /pull ${agent.config.model}`));
      } else if (err.message?.includes("connection refused") || err.message?.includes("ECONNREFUSED")) {
        console.log(c.dim("Is Ollama running? Try: ollama serve"));
      } else if (err.message?.includes("tool") || err.message?.includes("function")) {
        console.log(c.dim("Tip: This model may not support tool calling. Try: /model qwen2.5-coder:7b"));
      }
    }
  }

  inputManager.close();
  console.log(c.dim("\nGoodbye! 🦙"));
  process.exit(0);
}

main().catch((e) => {
  console.error(c.red(`Fatal error: ${e}`));
  process.exit(1);
});