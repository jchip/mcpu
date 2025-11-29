# MCPU CLI

> **Universal MCP gateway for any AI agent - Zero upfront tokens, unlimited servers**

MCPU enables AI agents to use MCP servers with minimal token overhead. It can be used in two ways:

1. **As an MCP Server** (`mcpu-mcp`) - For agents with native MCP support (Claude Desktop, etc.)
2. **Via CLI** (`mcpu-daemon` + `mcpu-remote`) - For agents with Bash tool support (Claude Code, etc.)

Both modes provide on-demand discovery of unlimited MCP servers with zero upfront token cost, compressing schemas by 97%\*.

\*Example: The Playwright MCP server alone requires ~14,000 tokens upfront for its schema. MCPU reduces this to just a few hundred tokens of instructions.

## Stats

```
% mcpu-stat

MCPU Schema Size Statistics

| Server     | Tools | MCP Native | MCPU Full | Δ Full | MCPU Compact | Δ Compact |
|------------|-------|------------|-----------|--------|--------------|-----------|
| chroma     |    13 |    11.3 KB |    8.3 KB |   -26% |       1.8 KB |      -84% |
| memory     |     9 |     8.3 KB |    2.1 KB |   -75% |       1.2 KB |      -86% |
| playwright |    22 |    11.1 KB |    7.4 KB |   -34% |       2.2 KB |      -80% |
| chrome-dev |    26 |    12.9 KB |    9.3 KB |   -28% |       3.5 KB |      -73% |
| context7   |     2 |     2.9 KB |    2.7 KB |    -9% |        833 B |      -72% |
| tasks      |    20 |    25.6 KB |    5.3 KB |   -79% |       2.2 KB |      -91% |
|------------|-------|------------|-----------|--------|--------------|-----------|
| TOTAL      |    92 |    72.2 KB |   35.0 KB |   -51% |      11.8 KB |      -84% |
```

## 📦 Installation

### Claude CLI

1. Move all your MCP servers in ` ~/.claude.json`.`mcpServers` to `~/.config/mcpu/config.json`

2. Add this MCP Unified to your Claude CLI

```
claude mcp add --scope=user mcpu -- npx --package=@mcpu/cli -c mcpu-mcp
```

3. Start Claude CLI and check `/conext` to verify that `mcpu` is the ony MCP server Claude connected.

4. Test by asking Claude to `list my mcp servers`

Something like this:

```
> list my mcp servers

⏺ mcpu - cli (MCP)(argv: ["servers"])
  ⎿ disconnected:
    - chroma - disconnected - Type: stdio - Command: uvx chroma-mcp --client-t
    ype persistent --data-dir ~/.local/share/chromadb - ENV: {"ANO
    … +13 lines (ctrl+o to expand)



⏺ You have 6 MCP servers configured (all disconnected):

  | Server     | Command                                    |
  |------------|--------------------------------------------|
  | chroma     | uvx chroma-mcp (persistent chromadb)       |
  | memory     | npx -y @modelcontextprotocol/server-memory |
  | playwright | npx playwright run-mcp-server              |
  | chrome-dev | npx -y chrome-devtools-mcp@latest          |
  | context7   | npx -y @upstash/context7-mcp@latest        |
  | tasks      | tasks-mcp                                  |

  To connect to a server, use connect <server>.
```

### Globally

```bash
npm install -g @mcpu/cli
```

```bash
claude mcp add --scope=user mcpu -- mcpu-mcp
```

**You don't need this, but in case it can't figure it out, add to your `CLAUDE.md`**:

```markdown
## MCP Servers

Use the MCPU `cli` to discover and use other MCP servers.
```

## 🤖 Bash CLI Mode

If you want to use MCPU in bash mode, tell Claude to set it up. Pick a prompt appropriate for your need:

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

MCPU follows the [XDG Base Directory](https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html) specification.

1. `--config <file>` - Explicit CLI flag (overrides all)
2. `.config/mcpu/config.local.json` - Project local (gitignored)
3. `.config/mcpu/config.json` - Project shared (committed)
4. `~/.config/mcpu/config.json` - User global

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

## MCPU Daemon

The daemon supports the Bash CLI mode by keeping MCP server connections alive.

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

## Direct Commands

You can use `mcpu` to run commands directly without starting the daemon or Claude CLI.

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

## Other File Locations

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

## License

MIT
