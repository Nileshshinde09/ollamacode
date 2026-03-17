// ============================================================
// core/toolParser.ts — fallback XML/JSON tool call parser
// for models that don't support Ollama's native tool format
// ============================================================

import type { ToolCall } from "../types.js";

let _toolCallId = 0;
function nextId(): string {
  return `call_${(++_toolCallId).toString().padStart(4, "0")}`;
}

// ── Try to extract tool calls from plain text ─────────────
// Models that don't natively support tool calling often
// output JSON blocks or XML-like tags. We parse both.

export function extractToolCallsFromText(text: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // ── Pattern 1: JSON code blocks ─────────────────────────
  // ```json
  // {"tool": "bash", "arguments": {"command": "ls"}}
  // ```
  const jsonBlockRe = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = jsonBlockRe.exec(text)) !== null) {
    const call = tryParseToolCall(m[1].trim());
    if (call) calls.push(call);
  }

  // ── Pattern 2: <tool_call> XML tags ──────────────────────
  // <tool_call>
  // {"name": "read_file", "arguments": {"path": "src/index.ts"}}
  // </tool_call>
  const xmlTagRe = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  while ((m = xmlTagRe.exec(text)) !== null) {
    const call = tryParseToolCall(m[1].trim());
    if (call) calls.push(call);
  }

  // ── Pattern 3: <function_calls> (Anthropic-style) ────────
  const fnCallRe = /<invoke name="([^"]+)">([\s\S]*?)<\/invoke>/g;
  while ((m = fnCallRe.exec(text)) !== null) {
    const name = m[1];
    const body = m[2];
    const args = extractXmlParameters(body);
    if (name) {
      calls.push({
        id: nextId(),
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      });
    }
  }

  // ── Pattern 4: Inline JSON object with "tool" key ────────
  // {"tool": "bash", "command": "npm test"}
  const inlineJsonRe = /\{[^{}]*"tool"\s*:\s*"[^"]+?"[^{}]*\}/g;
  while ((m = inlineJsonRe.exec(text)) !== null) {
    const call = tryParseInlineToolCall(m[0]);
    if (call) calls.push(call);
  }

  return calls;
}

// ── Try to parse a JSON block as a tool call ─────────────

function tryParseToolCall(text: string): ToolCall | null {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    // Handle various formats
    const name =
      (obj.tool as string) ??
      (obj.name as string) ??
      (obj.function as string) ??
      (obj.tool_name as string);
    if (!name) return null;

    const args =
      (obj.arguments as Record<string, unknown>) ??
      (obj.args as Record<string, unknown>) ??
      (obj.parameters as Record<string, unknown>) ??
      {};

    // If top-level has extra keys beyond name/tool, treat them as args
    const reservedKeys = new Set(["tool", "name", "function", "tool_name", "arguments", "args", "parameters"]);
    const extra = Object.fromEntries(
      Object.entries(obj).filter(([k]) => !reservedKeys.has(k))
    );

    return {
      id: nextId(),
      type: "function",
      function: {
        name,
        arguments: JSON.stringify(Object.keys(extra).length > 0 ? { ...args, ...extra } : args),
      },
    };
  } catch {
    return null;
  }
}

function tryParseInlineToolCall(text: string): ToolCall | null {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    const name = obj.tool as string;
    if (!name) return null;
    const { tool: _t, ...rest } = obj;
    return {
      id: nextId(),
      type: "function",
      function: { name, arguments: JSON.stringify(rest) },
    };
  } catch {
    return null;
  }
}

// ── Parse <parameter name="x">value</parameter> blocks ───

function extractXmlParameters(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /<parameter name="([^"]+)">([\s\S]*?)<\/parameter>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    result[m[1]] = m[2].trim();
  }
  return result;
}

// ── Strip tool call blocks from text ─────────────────────
// Used to get the clean human-readable portion of the response

export function stripToolCalls(text: string): string {
  return text
    .replace(/```(?:json)?\s*\n[\s\S]*?\n```/g, "")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, "")
    .replace(/<invoke[\s\S]*?<\/invoke>/g, "")
    .trim();
}