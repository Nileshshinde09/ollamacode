// ============================================================
// core/agent.ts — the agentic loop that drives tool calling
// ============================================================

import { OllamaClient } from "../ollama.js";
import { ALL_TOOLS, TOOL_MAP, isDangerous } from "../tools/index.js";
import { extractToolCallsFromText, stripToolCalls } from "./toolParser.js";
import { c, Spinner, renderMarkdown, promptYesNo } from "../ui/renderer.js";
import type {
  AgentState,
  Config,
  OllamaMessage,
  ToolCall,
  ToolCallRecord,
  ConversationTurn,
  FileChange,
} from "../types.js";

export class Agent {
  private client: OllamaClient;
  private state: AgentState;

  constructor(config: Config, workingDirectory: string) {
    this.client = new OllamaClient(config.ollamaUrl);
    this.state = {
      config,
      messages: [],
      history: [],
      workingDirectory,
      fileChanges: [],
      iterationCount: 0,
      maxIterations: 20,
    };
    this.resetMessages();
  }

  private resetMessages(): void {
    this.state.messages = [
      {
        role: "system",
        content: this.state.config.systemPrompt,
      },
    ];
  }

  // ── Public API ──────────────────────────────────────────

  get config(): Config {
    return this.state.config;
  }

  get history(): ConversationTurn[] {
    return this.state.history;
  }

  get workingDirectory(): string {
    return this.state.workingDirectory;
  }

  set workingDirectory(dir: string) {
    this.state.workingDirectory = dir;
  }

  updateConfig(partial: Partial<Config>): void {
    this.state.config = { ...this.state.config, ...partial };
    // Re-init client if URL changed
    if (partial.ollamaUrl) {
      this.client = new OllamaClient(partial.ollamaUrl);
    }
    // Update system prompt
    this.state.messages[0] = { role: "system", content: this.state.config.systemPrompt };
  }

  clearHistory(): void {
    this.state.history = [];
    this.resetMessages();
    this.state.fileChanges = [];
    this.state.iterationCount = 0;
  }

  addFileContext(filePath: string, content: string): void {
    this.state.messages.push({
      role: "user",
      content: `[Context file added: ${filePath}]\n\`\`\`\n${content}\n\`\`\``,
    });
    this.state.messages.push({
      role: "assistant",
      content: `I've read ${filePath} and added it to our context. I'll reference it as we work.`,
    });
  }

  getFileChanges(): FileChange[] {
    return this.state.fileChanges;
  }

  // ── Main turn ───────────────────────────────────────────

  async runTurn(userInput: string): Promise<void> {
    this.state.messages.push({ role: "user", content: userInput });
    this.state.iterationCount = 0;

    const turnRecord: ConversationTurn = {
      userMessage: userInput,
      assistantMessage: "",
      toolCalls: [],
      timestamp: new Date(),
    };

    await this.agentLoop(turnRecord);
    this.state.history.push(turnRecord);
  }

  // ── Agentic loop ────────────────────────────────────────

  private async agentLoop(turn: ConversationTurn): Promise<void> {
    while (this.state.iterationCount < this.state.maxIterations) {
      this.state.iterationCount++;

      const response = await this.callModel();
      const msg = response.message;

      // Append to messages
      this.state.messages.push(msg);
      turn.assistantMessage = msg.content;

      // ── Detect tool calls ───────────────────────────────
      // First try native Ollama tool_calls format
      let toolCalls: ToolCall[] = msg.tool_calls ?? [];

      // Fallback: parse tool calls embedded in text (for models
      // that don't support native Ollama tool calling format)
      if (toolCalls.length === 0 && msg.content) {
        toolCalls = extractToolCallsFromText(msg.content);
      }

      if (toolCalls.length > 0) {
        // Print the human-readable portion (minus tool call blocks)
        const humanText = stripToolCalls(msg.content ?? "").trim();
        if (humanText) {
          process.stdout.write("\n");
          console.log(renderMarkdown(humanText));
        }

        const shouldContinue = await this.handleToolCalls(toolCalls, turn);
        if (!shouldContinue) break;
        // Continue loop to get next response
        continue;
      }

      // ── Streaming text response ─────────────────────────
      if (msg.content?.trim()) {
        process.stdout.write("\n");
        await this.streamResponse(msg.content);
        process.stdout.write("\n");
      }

      // No tool calls → done
      break;
    }

    if (this.state.iterationCount >= this.state.maxIterations) {
      console.log(c.yellow("\n⚠ Reached maximum iterations. Stopping."));
    }
  }

  // ── Model call ──────────────────────────────────────────

  private async callModel() {
    const spinner = new Spinner("Thinking...");
    spinner.start();
    try {
      const response = await this.client.chat({
        model: this.state.config.model,
        messages: this.state.messages,
        stream: false,
        tools: ALL_TOOLS.map((t) => t.definition),
        options: {
          temperature: this.state.config.temperature,
          num_predict: this.state.config.maxTokens,
        },
      });
      spinner.stop();
      return response;
    } catch (e) {
      spinner.stop();
      throw e;
    }
  }

  // ── Streaming text output ───────────────────────────────

  private async streamResponse(text: string): Promise<void> {
    // For now render the full response with markdown
    // In future: could truly stream token by token
    const rendered = renderMarkdown(text);
    const lines = rendered.split("\n");

    // Simulate streaming by printing line by line
    for (const line of lines) {
      process.stdout.write(line + "\n");
      // Tiny delay for perceived streaming effect
      await sleep(8);
    }
  }

  // ── Tool call handling ──────────────────────────────────

  private async handleToolCalls(
    toolCalls: ToolCall[],
    turn: ConversationTurn
  ): Promise<boolean> {
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      let args: Record<string, unknown> = {};

      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      // Print tool call header
      this.printToolCallHeader(toolName, args);

      // Approval check
      const approved = await this.requestApproval(toolName, args);
      if (!approved) {
        console.log(c.yellow("  ↳ Skipped by user\n"));
        // Tell the model it was skipped
        this.state.messages.push({
          role: "tool",
          content: "User declined to run this tool.",
          tool_call_id: toolCall.id,
          name: toolName,
        });
        const record: ToolCallRecord = {
          toolName,
          args,
          result: { success: false, output: "Skipped by user" },
          approved: false,
        };
        turn.toolCalls.push(record);
        continue;
      }

      // Execute
      const tool = TOOL_MAP.get(toolName);
      if (!tool) {
        const errMsg = `Tool '${toolName}' not found`;
        console.log(c.red(`  ↳ Error: ${errMsg}\n`));
        this.state.messages.push({
          role: "tool",
          content: errMsg,
          tool_call_id: toolCall.id,
          name: toolName,
        });
        continue;
      }

      const spinner = new Spinner(`Running ${toolName}...`);
      spinner.start();
      const result = await tool.execute(args, this.state.workingDirectory);
      spinner.stop();

      // Track file changes
      if (["write_file", "edit_file", "delete_file", "move_file"].includes(toolName)) {
        this.recordFileChange(toolName, args, result);
      }

      // Print result
      this.printToolResult(toolName, result);

      // Add to messages
      this.state.messages.push({
        role: "tool",
        content: result.success ? result.output : `Error: ${result.error ?? result.output}`,
        tool_call_id: toolCall.id,
        name: toolName,
      });

      const record: ToolCallRecord = { toolName, args, result, approved: true };
      turn.toolCalls.push(record);
    }
    return true; // continue loop
  }

  // ── Approval logic ──────────────────────────────────────

  private async requestApproval(toolName: string, args: Record<string, unknown>): Promise<boolean> {
    if (this.state.config.autoApprove) return true;

    // Always auto-approve read-only tools
    const readOnlyTools = ["read_file", "read_multiple_files", "list_directory", "grep", "find_files", "git_status"];
    if (readOnlyTools.includes(toolName)) return true;

    // Extra warning for dangerous commands
    if (toolName === "bash") {
      const cmd = args.command as string ?? "";
      if (isDangerous(cmd)) {
        console.log(c.red(c.bold(`\n  ⚠️  DANGEROUS COMMAND DETECTED:`)));
        console.log(c.red(`     ${cmd}`));
      }
    }

    return promptYesNo(`  ${c.dim("Allow")} ${c.cyan(toolName)}${c.dim("?")}`, true);
  }

  // ── Display helpers ─────────────────────────────────────

  private printToolCallHeader(toolName: string, args: Record<string, unknown>): void {
    const icon = toolIcons[toolName] ?? "🔧";
    console.log(`\n${icon} ${c.bold(c.cyan(toolName))}${formatToolArgs(toolName, args)}`);
  }

  private printToolResult(toolName: string, result: { success: boolean; output: string; error?: string }): void {
    if (result.success) {
      if (this.state.config.verbose || shouldShowOutput(toolName)) {
        const lines = result.output.split("\n").slice(0, 30);
        lines.forEach((l) => console.log(c.dim("  │ ") + l));
        if (result.output.split("\n").length > 30) {
          console.log(c.dim(`  │ ... (${result.output.split("\n").length - 30} more lines)`));
        }
      } else {
        const preview = result.output.split("\n")[0].slice(0, 80);
        console.log(c.dim(`  ↳ `) + c.green("✓") + c.dim(` ${preview}`));
      }
    } else {
      console.log(c.dim("  ↳ ") + c.red("✗ ") + c.red(result.error ?? result.output));
    }
  }

  private recordFileChange(toolName: string, args: Record<string, unknown>, result: { success: boolean }): void {
    if (!result.success) return;
    const change: FileChange = {
      path: (args.path ?? args.source ?? "") as string,
      action: toolName === "write_file" ? "create"
        : toolName === "delete_file" ? "delete"
        : "edit",
    };
    this.state.fileChanges.push(change);
  }
}

// ── Helpers ───────────────────────────────────────────────

const toolIcons: Record<string, string> = {
  read_file: "📖",
  read_multiple_files: "📚",
  write_file: "✏️ ",
  edit_file: "🔏",
  list_directory: "📂",
  bash: "💻",
  grep: "🔍",
  find_files: "🗂️ ",
  delete_file: "🗑️ ",
  move_file: "📦",
  git_status: "🌿",
};

function formatToolArgs(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "read_file":
    case "write_file":
    case "edit_file":
    case "delete_file":
      return c.dim(` → ${args.path}`);
    case "bash":
      return c.dim(` $ ${String(args.command).slice(0, 60)}${String(args.command).length > 60 ? "…" : ""}`);
    case "grep":
      return c.dim(` /${args.pattern}/ in ${args.path ?? "."}`);
    case "find_files":
      return c.dim(` ${args.pattern} in ${args.path ?? "."}`);
    case "move_file":
      return c.dim(` ${args.source} → ${args.destination}`);
    default:
      return "";
  }
}

function shouldShowOutput(toolName: string): boolean {
  return ["bash", "grep", "find_files", "git_status"].includes(toolName);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}