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

First start the daemon in the background using the Bash tool:

- `mcpu-daemon.mjs &` - Options: `--port=<port-number>` or automatic OS-assigned port
- Logs port number and PID to console, saves to `$XDG_DATA_HOME/mcpu/daemon.<pid>.json`

Once MCPU daemon is running, use `mcpu-remote` to access MCP tools:

- `mcpu-remote` discovers port number automatically, or use `--port=<port-number>` or `--pid=<pid>`

### `mcpu-remote` usage

- `mcpu-remote -- servers` - List all configured MCP servers
- `mcpu-remote -- tools [servers...]` - List tools from servers

**DON'T GUESS, list tools from an MCP server first**

- `mcpu-remote -- info <server> <tools...>` - Show tool info (human-readable)
- `mcpu-remote -- call <server> <tool> [--<param>=<value>]` - Execute tool (returns unwrapped text by default)
- `mcpu-remote -- --yaml info <server> <tools...>` - Get complete raw schema in YAML
- `mcpu-remote -- --yaml call <server> <tool>` - Execute tool (returns full MCP response structure in YAML)

**Response formats:**

- Default: Unwrapped text content (user-friendly, matches Claude CLI behavior)
- `--json/--yaml/--raw`: Full MCP response structure with metadata

**When to use `--raw`, `--yaml`, or `--json` flags:**

- For `info`: Get complete tool schema including `inputSchema` and `annotations`
- For `call`: Get full MCP response structure instead of just extracted text
- Useful for debugging, understanding complex parameters, or accessing response metadata

### `mcpu-remote` stdin YAML input mode

For complex parameters, use stdin YAML mode:

```bash
mcpu-remote --stdin -- call <server> <tool> <<'EOF'
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
