# Semalt.AI Code CLI

`@semalt-ai/code` is a self-hosted AI coding assistant for the terminal.

It provides an interactive chat interface, one-shot code generation, AI-assisted file editing, shell command execution, and an agent loop that can read files, write files, and run commands after user approval.

## Features

- Interactive terminal chat mode
- OpenAI-compatible API integration
- Streaming responses with terminal-friendly formatting
- Optional reasoning stream display when the backend provides it
- User-approved shell, file read, and file write actions
- File and directory context loading
- One-shot code task mode
- AI-assisted file editing mode
- Model discovery from the configured API

## Requirements

- Node.js `>=16`
- An OpenAI-compatible API endpoint

The default configuration expects a local API server at `http://127.0.0.1:8800`.

The CLI accepts `api_base` in either of these forms:

- `http://127.0.0.1:8800`
- `http://127.0.0.1:8800/v1`

Both formats are normalized automatically.

## Installation

Install the package globally so the `semalt-code` command is available system-wide.

```bash
npm install -g @semalt-ai/code
```

After global installation, run:

```bash
semalt-code
```

## Initial Setup

Create the CLI config:

```bash
semalt-code init --api-base http://127.0.0.1:8800 --api-key any --default-model default
```

This writes configuration to:

```text
~/.semalt-ai/config.json
```

Example config:

```json
{
  "api_base": "http://127.0.0.1:8800",
  "api_key": "any",
  "default_model": "default",
  "temperature": 0.7,
  "request_timeout_ms": 900000,
  "stream": true
}
```

You can also set `"api_base"` to a URL that already ends with `/v1`.

## Usage

```bash
semalt-code [command] [options]
```

### Commands

- `semalt-code`
- `semalt-code chat`
  Starts interactive chat mode.

- `semalt-code code <prompt>`
  Runs a one-shot coding task.

- `semalt-code edit <file> <instruction>`
  Sends a file to the model and overwrites it with the returned result.

- `semalt-code shell <command>`
  Runs a shell command with approval prompts.

- `semalt-code models`
  Lists all saved model profiles.

- `semalt-code models add`
  Opens an interactive flow to add an API base URL, API key, and model ID as a reusable model profile.

- `semalt-code init`
  Creates or updates the local config file.

### Options

- `-m, --model <name>`
  Override the model name.

- `-v, --version`
  Print the current CLI version.

- `-f, --file <path>`
  Load one or more files or directories into the prompt context for `code`.

- `-a, --analyze`
  After `shell`, ask the model to summarize the command output.

- `--dry-run`
  For `edit`, show the generated result without saving it.

- `--api-base <url>`
  Set the API base URL during `init`.

- `--api-key <key>`
  Set the API key during `init`.

- `--default-model <name>`
  Set the default model during `init`.

## Interactive Chat Mode

Running `semalt-code` without arguments starts the terminal chat UI.

Available interactive commands:

- `/help`
- `/file <path>`
- `/model`
- `/model <name>`
- `/models`
- `/clear`
- `/compact`
- `/cost`
- `/shell <cmd>`
- `!<cmd>`
- `/approve`
- `/config`
- `exit`

### What `/file` does

- If you pass a file, its full content is added to the conversation context.
- If you pass a directory, the CLI recursively loads up to 50 non-hidden files.

## Agent Behavior

The assistant is instructed to use special tool-like tags:

- `<exec>...</exec>` for shell commands
- `<read_file>...</read_file>` for file reads
- `<write_file path="...">...</write_file>` for file writes

When the model emits these actions, the CLI:

1. Detects them in the response
2. Prompts the user for approval
3. Executes the action
4. Sends the result back to the model
5. Continues for up to 10 iterations

This makes the tool behave like a lightweight terminal agent while keeping the user in control.

## Examples

### Start chat

```bash
semalt-code
```

### Ask for a coding task with file context

```bash
semalt-code code -f package.json -f index.js "Explain this project and suggest improvements"
```

### Edit a file with AI

```bash
semalt-code edit index.js "Refactor duplicated logic into helper functions"
```

### Preview an edit without saving

```bash
semalt-code edit index.js "Add better error handling" --dry-run
```

### Run and analyze a shell command

```bash
semalt-code shell -a "npm test"
```

### List models

```bash
semalt-code models
```

### Add a saved model profile

```bash
semalt-code models add
```

The CLI will ask for:

- API Base URL
- API Key
- Model ID

Each saved profile is appended to the profile list.

Saved profiles can then be selected inside chat mode with `/model` or `/models`.

### Show the current version

```bash
semalt-code --version
```

## How Responses Are Rendered

The CLI formats streamed output for terminal readability:

- headings
- bullet lists
- numbered lists
- fenced code blocks
- diff-like output
- inline code and file paths

If the backend returns `reasoning_content`, the CLI also shows a lightweight `thinking` section during streaming.

## Notes and Limitations

- This project is currently a single-file CLI implementation centered in `index.js`.
- It uses Node's built-in `http` and `https` modules and does not require extra runtime dependencies.
- The `edit` command writes the model output directly back to the target file, so review prompts and backend behavior carefully.
- Shell and file operations are approval-based, but they still execute on the local system after approval.

## License

MIT
