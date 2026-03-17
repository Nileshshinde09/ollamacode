// ============================================================
// types.ts — shared interfaces across the entire CLI
// ============================================================

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    format: string;
    family: string;
    families?: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  tools?: ToolDefinition[];
  options?: {
    temperature?: number;
    top_p?: number;
    num_ctx?: number;
    num_predict?: number;
  };
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: OllamaMessage;
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message: { role: string; content: string };
  done: boolean;
}

export interface Config {
  ollamaUrl: string;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number;
  autoApprove: boolean;
  verbose: boolean;
  maxFileSize: number; // bytes
  allowedExtensions: string[];
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface FileChange {
  path: string;
  action: "create" | "edit" | "delete";
  before?: string;
  after?: string;
}

export interface ConversationTurn {
  userMessage: string;
  assistantMessage: string;
  toolCalls: ToolCallRecord[];
  timestamp: Date;
  tokensUsed?: number;
}

export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: ToolResult;
  approved: boolean;
}

export interface AgentState {
  config: Config;
  messages: OllamaMessage[];
  history: ConversationTurn[];
  workingDirectory: string;
  fileChanges: FileChange[];
  iterationCount: number;
  maxIterations: number;
}