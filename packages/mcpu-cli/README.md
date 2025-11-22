# MCPU CLI

> **Universal MCP gateway for any AI agent - Zero upfront tokens, unlimited servers**

MCPU enables ANY AI agent to use MCP servers, even without native MCP SDK integration. It compresses schemas by 97%\* and provides on-demand discovery of unlimited MCP servers with zero upfront token cost.

\*Example: The Playwright MCP server alone requires ~14,000 tokens upfront for its schema. MCPU reduces this to just a few hundred tokens of instructions.

## 📦 Installation

```bash
npm install -g @mcpu/cli
```

## 🤖 Using with Claude Code

Add this to your `.claude/CLAUDE.md` or project's `CLAUDE.md` to enable Claude Code to use MCPU:

````markdown
## MCP Servers through MCPU Tools

### MCPU CLI Daemon

Logs port number and PID to console, saves to `$XDG_DATA_HOME/mcpu/daemon.<ppid>-<pid>.json`

### `mcpu-remote` usage

- `mcpu-remote --ppid=$PPID -- <args for mcpu>` 

**WORKFLOW - Always follow this sequence:**
0. **START DAEMON with run_in_background FIRST**: `mcpu-daemon --ppid=$PPID`
1. **If you don't know the server, list all servers**: `mcpu-remote -- servers`
2. `mcpu-remote --ppid=$PPID -- tools [servers...]` - List tools from servers
3. **If a tool requires complex input, ALWAYS check info BEFORE calling**: `mcpu-remote --ppid=$PPID -- info <server> <tool>` (human-readable)
4. `mcpu-remote --ppid=$PPID -- call <server> <tool> [--<param>=<value>]` - Execute tool

**Commands:**
- `mcpu-remote --ppid=$PPID -- info <server> <tools...>` - Show tool info (human-readable) - **START HERE**
- `mcpu-remote --ppid=$PPID -- --yaml info <server> <tools...>` - Get complete raw schema (only if human-readable isn't sufficient)
- `mcpu-remote --ppid=$PPID -- call <server> <tool> [--<param>=<value>]` - Execute tool (returns unwrapped text by default)
- `mcpu-remote --ppid=$PPID -- --yaml call <server> <tool>` - Execute tool (returns full MCP response structure in YAML)

**Response formats:**

- Default: Unwrapped text content (user-friendly, matches Claude CLI behavior)
- `--json/--yaml/--raw`: Full MCP response structure with metadata

**When to use `--raw`, `--yaml`, or `--json` flags:**

- For `info`: Get complete tool schema including `inputSchema` and `annotations` (only if human-readable version insufficient)
- For `call`: Get full MCP response structure instead of just extracted text
- Useful for debugging, understanding complex parameters, or accessing response metadata

### `mcpu-remote` stdin YAML input mode

For complex parameters, use stdin YAML mode:

```bash
mcpu-remote --ppid=$PPID --stdin <<'EOF'
argv: [call, <server>, <tool>]
params:
  param1: value1
  param2: value2
EOF
```
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

```bash
# Start daemon
mcpu-daemon &

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
mcpu tools                        # All tools
mcpu tools filesystem             # Specific server
mcpu tools filesystem playwright  # Multiple servers
```

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

### Daemon PID Files:

- `$XDG_DATA_HOME/mcpu/daemon.<pid>.json` - Daemon port/PID info (defaults to `~/.local/share/mcpu/`)
- Auto-cleaned when daemon stops

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
