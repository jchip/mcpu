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

Add the content from [setup/AGENT-INSTRUCTIONS.md](setup/AGENT-INSTRUCTIONS.md) to your `.claude/CLAUDE.md` or project's `CLAUDE.md` to enable Claude Code to use MCPU.

Or tell Claude to do it. Pick a prompt appropriate for your need:

- `AGENTS.md` and reference in `CLAUDE.md`

```
run `mcpu setup` and follow the instructions
```

- Project `CLAUDE.md`

```
run `mcpu setup` and follow the instrctuions to setup only my project CLAUDE.md
```

- User level `CLAUDE.md`

```
run `mcpu setup` and follow the instrctuions to setup only my user CLAUDE.md
```

## Configuration

MCPU loads and merges configuration from multiple sources (highest priority first):

| Priority | Location                         | Scope             | Git    |
| -------- | -------------------------------- | ----------------- | ------ |
| 1        | `.config/mcpu/config.local.json` | Project (private) | Ignore |
| 2        | `.config/mcpu/config.json`       | Project (shared)  | Commit |
| 3        | `~/.config/mcpu/config.json`     | User (global)     | N/A    |

- **User config** (`~/.config/mcpu/config.json`) - Your personal MCP servers available in all projects
- **Project config** (`.config/mcpu/config.json`) - Shared with your team via git
- **Local config** (`.config/mcpu/config.local.json`) - Your private overrides, not committed

### Adding MCP Servers

Use `mcpu add` to easily add servers to any config:

```bash
# Add to project local config (default, gitignored)
mcpu add airtable --env AIRTABLE_API_KEY=xxx -- npx -y airtable-mcp-server

# Add to project shared config (committed to git)
mcpu add --scope project playwright -- npx -y @anthropic/mcp-playwright

# Add to user config (available in all projects)
mcpu add --scope user memory -- npx -y @modelcontextprotocol/server-memory

# Add HTTP/SSE server
mcpu add --transport http notion https://mcp.notion.com/mcp
```

### Config File Format

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

Add a new MCP server. See [Configuration](#configuration) for examples.

**Options:**

- `-t, --transport <type>` - Transport type: `stdio` (default), `http`, or `sse`
- `-s, --scope <scope>` - Config scope: `local` (default), `project`, or `user`
- `-e, --env <KEY=VALUE>` - Environment variable (can repeat)
- `--header <KEY=VALUE>` - HTTP header (can repeat)

### `mcpu add-json <name> <json>`

Add an MCP server with a JSON config string.

```bash
mcpu add-json myserver '{"command": "uvx", "args": ["some-mcp"], "env": {"API_KEY": "xxx"}}'
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

MCPU follows the [XDG Base Directory](https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html) specification.

### Configuration Files

See [Configuration](#configuration) for details. Files are merged in priority order:

1. `--config <file>` - Explicit CLI flag (overrides all)
2. `.config/mcpu/config.local.json` - Project local (gitignored)
3. `.config/mcpu/config.json` - Project shared (committed)
4. `~/.config/mcpu/config.json` - User global

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

- **No MCP servers configured**: Add servers with `mcpu add` or check config files (see [Configuration](#configuration))
- **Failed to connect**: Verify MCP server is installed and command path is correct
- **Unknown option**: Tool arguments must come after `mcpu call <server> <tool>`

## License

MIT
