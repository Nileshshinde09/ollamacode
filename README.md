# 🦙 OllamaCode

A **Ollama Code CLI** powered by **Ollama local models** — fully offline, private, and free.

Run an AI coding agent in your terminal that reads files, writes code, executes commands, and iterates autonomously — all using local models via Ollama.

---

## Features

- **Agentic loop** — AI plans and executes multi-step tasks autonomously
- **Full tool suite** — read/write/edit files, run bash, grep, find, git, and more
- **Streaming output** — see responses as they're generated
- **Tool approval** — review every tool call before it runs (or enable auto-approve)
- **Model picker** — switch between any installed Ollama model at runtime
- **Conversation history** — full context across turns
- **Slash commands** — `/help`, `/model`, `/clear`, `/cd`, `/add`, and more
- **Non-interactive mode** — pipe prompts in for scripting
- **Markdown rendering** — formatted output in terminal
- **Line history** — up/down arrows navigate past inputs

---

## Installation

### Prerequisites

1. **Node.js 18+** — https://nodejs.org
2. **Ollama** — https://ollama.ai

```bash
# Install Ollama (macOS/Linux)
curl -fsSL https://ollama.ai/install.sh | sh

# Or on macOS with Homebrew
brew install ollama
```

### Install OllamaCode

```bash
# Clone or download the project
cd ollamacode

# Install dependencies
npm install

# Build
npm run build

# Install globally
npm install -g .

# Or run directly
npm run dev
```

### Pull a recommended model

OllamaCode works best with code-focused models:

```bash
# Best overall for coding (recommended)
ollama pull qwen2.5-coder:7b

# Larger, more capable
ollama pull qwen2.5-coder:14b

# DeepSeek (excellent at code)
ollama pull deepseek-coder-v2

# Meta's code model
ollama pull codellama:13b

# Fast and lightweight
ollama pull llama3.2:3b
```

---

## Usage

### Start interactive session

```bash
ollamacode
# or short alias:
oc
```

### Use a specific model

```bash
ollamacode --model qwen2.5-coder:14b
```

### Change working directory

```bash
ollamacode --dir /path/to/your/project
```

### Non-interactive / pipe mode

```bash
# Single prompt
ollamacode --print "explain the main function in src/index.ts"

# Pipe from stdin (not yet, use --print)
oc -p "write unit tests for utils.ts"
```

### Auto-approve all tools (for scripting)

```bash
ollamacode --auto-approve -p "refactor all console.log to use a logger"
```

---

## Slash Commands

| Command | Description |
|---|---|
| `/help` | Show all commands |
| `/exit` or `/quit` | Exit OllamaCode |
| `/clear` | Clear conversation history |
| `/model [name]` | Show or switch model |
| `/models` | List installed Ollama models |
| `/pull <name>` | Pull a new Ollama model |
| `/config` | Show current config |
| `/set <key> <value>` | Update a config value |
| `/approve on\|off` | Toggle auto-approval of tool calls |
| `/verbose on\|off` | Toggle verbose tool output |
| `/cd <path>` | Change working directory |
| `/pwd` | Show current directory |
| `/add <file>` | Add a file to conversation context |
| `/history` | Show last 10 conversation turns |
| `/undo` | Show last file change |

### Config keys for `/set`

```
/set model qwen2.5-coder:7b
/set temperature 0.1
/set maxTokens 4096
/set autoApprove true
/set verbose true
/set ollamaUrl http://localhost:11434
```

---

## Tools Available

The AI agent has access to these tools:

| Tool | Description |
|---|---|
| `read_file` | Read a file with line numbers (supports line ranges) |
| `read_multiple_files` | Read several files at once |
| `write_file` | Create or overwrite a file |
| `edit_file` | Surgical text replacement in a file |
| `list_directory` | Tree view of directory |
| `bash` | Run shell commands |
| `grep` | Search files with regex |
| `find_files` | Find files by name pattern |
| `delete_file` | Delete a file |
| `move_file` | Move or rename a file |
| `git_status` | Show git status and recent commits |

---

## Configuration

Config is stored at `~/.ollamacode/config.json`.

```json
{
  "ollamaUrl": "http://localhost:11434",
  "model": "qwen2.5-coder:7b",
  "temperature": 0.2,
  "maxTokens": 8192,
  "autoApprove": false,
  "verbose": false,
  "maxFileSize": 1048576
}
```

---

## Example Tasks

```
❯ Create a REST API in Express with CRUD endpoints for a todos resource

❯ Read package.json and set up ESLint + Prettier with my existing config

❯ Find all TODO comments in the codebase and create a TODOS.md file

❯ Write unit tests for every function in src/utils.ts using Vitest

❯ Refactor this class to use the repository pattern

❯ Fix the TypeScript errors in src/

❯ Add input validation to all API endpoints using Zod

❯ Explain what this codebase does, then suggest improvements
```

---

## Model Recommendations

| Model | Size | Best For |
|---|---|---|
| `qwen2.5-coder:7b` | ~4.7GB | Best balance of speed + quality |
| `qwen2.5-coder:14b` | ~9GB | Higher quality, slower |
| `deepseek-coder-v2` | ~9GB | Excellent reasoning |
| `codellama:13b` | ~7.4GB | Good all-rounder |
| `llama3.1:8b` | ~4.7GB | Good general purpose |
| `llama3.2:3b` | ~2GB | Fastest, less capable |
| `phi3:mini` | ~2.3GB | Very fast, decent quality |

> **Note:** Tool calling (function calling) support varies by model. `qwen2.5-coder` has the best tool call support. If a model doesn't support tool calls natively, OllamaCode will still work but may have reduced agentic capability.

---

## Architecture

```
ollamacode/
├── src/
│   ├── index.ts          # CLI entry point + REPL loop
│   ├── types.ts          # Shared TypeScript types
│   ├── config.ts         # Config load/save
│   ├── ollama.ts         # Ollama API client (streaming)
│   ├── core/
│   │   ├── agent.ts      # Agentic loop + tool execution
│   │   └── commands.ts   # Slash command handlers
│   ├── tools/
│   │   └── index.ts      # All tool implementations
│   └── ui/
│       ├── renderer.ts   # Terminal colours + markdown
│       └── input.ts      # Line editor + history
├── package.json
└── tsconfig.json
```

---

## Troubleshooting

**"Ollama is not running"**
```bash
ollama serve
```

**"Model not found"**
```bash
ollama pull qwen2.5-coder:7b
```

**Tool calls not working**
Some models don't support the Ollama tool call format. Switch to a model that does:
```
/model qwen2.5-coder:7b
```

**Slow responses**
Try a smaller model:
```
/model llama3.2:3b
```
Or reduce context:
```
/set maxTokens 2048
```

**Remote Ollama server**
```
/set ollamaUrl http://192.168.1.100:11434
```

---

## License

MIT