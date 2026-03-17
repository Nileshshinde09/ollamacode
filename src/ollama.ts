// ============================================================
// ollama.ts — typed Ollama API client with streaming support
// ============================================================

import type {
  OllamaModel,
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaStreamChunk,
} from "./types.js";

export class OllamaClient {
  private baseUrl: string;

  constructor(baseUrl: string = "http://localhost:11434") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  // ── Health check ──────────────────────────────────────────
  async isRunning(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/version`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/version`);
    if (!res.ok) throw new Error("Cannot reach Ollama");
    const data = (await res.json()) as { version: string };
    return data.version;
  }

  // ── Model management ──────────────────────────────────────
  async listModels(): Promise<OllamaModel[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) throw new Error(`Failed to list models: ${res.statusText}`);
    const data = (await res.json()) as { models: OllamaModel[] };
    return data.models ?? [];
  }

  async pullModel(modelName: string, onProgress?: (status: string) => void): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: true }),
    });
    if (!res.ok) throw new Error(`Pull failed: ${res.statusText}`);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const chunk = JSON.parse(line) as { status: string; completed?: number; total?: number };
          if (onProgress) {
            let msg = chunk.status;
            if (chunk.total && chunk.completed) {
              const pct = Math.round((chunk.completed / chunk.total) * 100);
              msg += ` (${pct}%)`;
            }
            onProgress(msg);
          }
        } catch {}
      }
    }
  }

  async deleteModel(modelName: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName }),
    });
    if (!res.ok) throw new Error(`Delete failed: ${res.statusText}`);
  }

  // ── Chat (non-streaming) ──────────────────────────────────
  async chat(req: OllamaChatRequest): Promise<OllamaChatResponse> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...req, stream: false }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Chat failed (${res.status}): ${text}`);
    }
    return (await res.json()) as OllamaChatResponse;
  }

  // ── Chat (streaming) ─────────────────────────────────────
  async *chatStream(req: OllamaChatRequest): AsyncGenerator<OllamaStreamChunk> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...req, stream: true }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Chat stream failed (${res.status}): ${text}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as OllamaStreamChunk;
          yield chunk;
        } catch {}
      }
    }
  }
}