# MCPU CLI

> **Universal MCP gateway for any AI agent - Zero upfront tokens, unlimited servers**

MCPU enables AI agents with a Bash tool to use MCP servers, even without native MCP SDK integration. It compresses schemas by 97%\* and provides on-demand discovery of unlimited MCP servers with zero upfront token cost.

**Requirements:** The AI agent must have a Bash tool that supports:

- Running background processes (`command &` or `run_in_background: true`)
- Executing shell commands and reading their output

Currently tested with: **Claude Code**

\*Example: The Playwright MCP server alone requires ~14,000 tokens upfront for its schema. MCPU reduces this to just a few hundred tokens of instructions.

## 📦 Installation

```bash
npm install -g @mcpu/cli
```

## 🤖 Using with Claude Code

Add this to your `.claude/CLAUDE.md` or project's `CLAUDE.md` to enable Claude Code to use MCPU:

````markdown
## MCP Servers through MCPU Tools

### MCPU Daemon and `mcpu-remote` usage

**General Command formats**

- Start daemon (background): `mcpu-daemon -p=$PPID &` (use `run_in_background: true`)
- Send remote commands to daemon: `mcpu-remote -p=$PPID -- <args for mcpu>`

**mcpu-remote Commands and their flags and args:**

- ALWAYS START command with `mcpu-remote -p=$PPID`
- List mcp servers: `-- servers`
- List tools of mcp servers: `-- tools [servers...]`
- Get tool info in unwrapped text format: `-- info <server> <tools...>`
- Get complete raw schema (if unwrapped text isn't sufficient): `-- --yaml info <server> <tools...>`
- Call tool and receive unwrapped text response: `-- call <server> <tool>`, and use YAML input mode for params.
- Call tool and receive full MCP response as YAML: `-- --yaml call <server> <tool>`
- Shutdown the mcpu-daemon: `mcpu-remote -p=$PPID stop`

### YAML input mode (stdin/file)

- `mcpu-remote --stdin` accepts a YAML/JSON piped to its stdin.
- `mcpu-remote -b -c=<file>` accepts a YAML/JSON file,
  - `-b` renames the file with `.bak` suffix after reading it, replacing possible existing `.bak` file.

**WORKFLOW**

- One time step: `mkdir -p /tmp/.tmp-claude-$PPID && echo /tmp/.tmp-claude-$PPID`

1. Use Write tool to create `mcpu-cmd.yaml` in the dir from one time step
2. Run mcpu-remote with `-b -c=<file>` option

Example YAML:

```YAML
argv: [call, <server>, <tool>]
params:
  a: b
  a: b
```

### `mcpServerConfig`

- `call` command accepts `--restart` flag and a `mcpServerConfig` object:

```YAML
argv: [call, --restart, <server>, <tool>]
params:
  a: b
  a: b
mcpServerConfig:
  extraArgs: []
```

- A dedicate `config` command also available for setting `extraArgs`:

```YAML
argv: [config, <server>]
mcpServerConfig:
  extraArgs: []
```

**WORKFLOW - ALWAYS FOLLOW THIS SEQUENCE:**

1. **START DAEMON** (`run_in_background: true`) - skip if already running
2. **LIST SERVERS** - skip if known
3. **LIST TOOLS** - skip if known
4. **GET TOOL INFO** - skip if already retrieved or tool has no/simple params
5. **CALL TOOL** - using info from above

**Response formats:**

- Default: Unwrapped text content (user-friendly, matches Claude CLI behavior)
- `--json/--yaml/--raw`: Full MCP response structure with metadata

**When to use `--raw`, `--yaml`, or `--json` flags:**

- For `info`: Get complete tool schema including `inputSchema` and `annotations` (only if human-readable version insufficient)
- For `call`: Get full MCP response structure instead of just extracted text
- Useful for debugging, understanding complex parameters, or accessing response metadata
````

## Configuration

Create `.config/mcpu/config.local.json` in your project:

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
  },
  "playwright": {
    "type": "http",
    "url": "http://localhost:9000/mcp"
  }
}
```

## Daemon Mode

The daemon keeps MCP server connections alive for faster repeated tool calls.

```bash
# Start daemon (connections stay alive indefinitely by default)
mcpu-daemon &

# Start with auto-disconnect of idle connections
mcpu-daemon --auto-disconnect                    # 5 min default timeout
mcpu-daemon --auto-disconnect --idle-timeout 10  # 10 min timeout

# Use remote client
mcpu-remote -- servers
mcpu-remote -- tools
mcpu-remote -- call playwright browser_navigate --url=https://example.com

# YAML mode for complex parameters
mcpu-remote --stdin <<'EOF'
argv: [call, playwright, browser_fill_form]
params:
  fields:
    - name: Email
      ref: e11
      type: textbox
      value: user@example.com
EOF
```

**Daemon Options:**

- `--port <port>` - Port to listen on (default: OS assigned)
- `--ppid <pid>` - Parent process ID (daemon exits when parent dies)
- `--auto-disconnect` - Enable automatic disconnection of idle MCP connections
- `--idle-timeout <minutes>` - Idle timeout before disconnecting (default: 5)
- `--verbose` - Show detailed logging

## Commands

### `mcpu add <name> [command]`

Add a new MCP server. Works like `claude mcp add`.

```bash
# Add stdio server with command after --
mcpu add airtable --env AIRTABLE_API_KEY=xxx -- npx -y airtable-mcp-server

# Add HTTP server
mcpu add --transport http notion https://mcp.notion.com/mcp

# Add to user config (global)
mcpu add --scope user memory -- npx -y @modelcontextprotocol/server-memory

# Multiple env vars
mcpu add myserver -e KEY1=val1 -e KEY2=val2 -- node server.js
```

**Options:**

- `-t, --transport <type>` - Transport type: `stdio` (default), `http`, or `sse`
- `-s, --scope <scope>` - Config scope: `local` (default), `project`, or `user`
- `-e, --env <KEY=VALUE>` - Environment variable (can repeat)
- `--header <KEY=VALUE>` - HTTP header (can repeat)

### `mcpu add-json <name> <json>`

Add an MCP server with a JSON config string. Works like `claude mcp add-json`.

```bash
# Simple stdio server
mcpu add-json echo '{"command": "echo", "args": ["hello"]}'

# Complex config with env vars
mcpu add-json myserver '{"command": "uvx", "args": ["some-mcp", "--opt"], "env": {"API_KEY": "secret"}}'

# HTTP server
mcpu add-json api '{"url": "https://api.example.com/mcp"}'

# Add to user config
mcpu add-json --scope user memory '{"command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"]}'
```

**Options:**

- `-s, --scope <scope>` - Config scope: `local` (default), `project`, or `user`

### `mcpu servers`

Lists configured MCP servers.

### `mcpu tools [servers...]`

Lists available tools.

```bash
mcpu tools                        # All tools from all servers
mcpu tools filesystem             # Tools from specific server
mcpu tools filesystem playwright  # Tools from multiple servers
mcpu tools --names                # Names only (no descriptions)
```

**Options:**

- `--names` - Show only tool names, no descriptions

### `mcpu info <server> <tools...>`

Shows tool details. Use `--raw` for complete schema.

```bash
mcpu info filesystem read_file           # Human-readable
mcpu info --raw filesystem read_file     # Complete schema (YAML)
mcpu info --raw --json filesystem tool   # Complete schema (JSON)
```

### `mcpu call <server> <tool> [args]`

Executes a tool. By default, unwraps MCP response to show just the content.

```bash
# Default: unwrapped text content
mcpu call chroma chroma_list_collections
# Output: documents\nembeddings\ntutorials...

# Full MCP response structure
mcpu call --json chroma chroma_list_collections
mcpu call --yaml chroma chroma_list_collections
mcpu call --raw chroma chroma_list_collections

# Pass tool arguments
mcpu call filesystem read_file --path=/etc/hosts
mcpu call filesystem read_file --stdin <<< '{"path": "/etc/hosts"}'
```

**Response unwrapping:**

- Default: Extracts text from MCP response content array (matches Claude CLI behavior)
- `--json/--yaml/--raw`: Returns complete MCP response structure with all metadata
- Follows [MCP specification](https://spec.modelcontextprotocol.io/) for response handling

## File Locations

MCPU follows the [XDG Base Directory](https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html) specification:

### Configuration Files (searched in order):

1. `--config <file>` - Explicit CLI flag
2. `.config/mcpu/config.local.json` - Project-specific config (gitignored)
3. `$XDG_CONFIG_HOME/mcpu/config.json` - User config (defaults to `~/.config/mcpu/config.json`)

### Cache Files:

- `$XDG_CACHE_HOME/mcpu/` - Tool schema cache (defaults to `~/.cache/mcpu/`)
- 24-hour TTL, use `--no-cache` to force refresh

### Daemon Files:

- `$XDG_DATA_HOME/mcpu/daemon.<ppid>-<pid>.json` - Daemon port/PID info (defaults to `~/.local/share/mcpu/`)
- `$XDG_DATA_HOME/mcpu/logs/daemon.<ppid>-<pid>.log` - Daemon log file (JSON format, always written)
- PID files auto-cleaned when daemon stops

## Global Options

- `--json` / `--yaml` / `--raw` - Output format
  - For `call` command: Returns full MCP response structure instead of unwrapped content
  - For `info` command: Returns complete raw schema with all metadata
- `--config <file>` - Use specific config file
- `--verbose` - Detailed logging
- `--no-cache` - Skip cache

## Troubleshooting

- **No MCP servers configured**: Check `.config/mcpu/config.local.json` or `~/.config/mcpu/config.json`
- **Failed to connect**: Verify MCP server is installed and command path is correct
- **Unknown option**: Tool arguments must come after `mcpu call <server> <tool>`

## License

MIT
