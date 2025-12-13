# MCPU CLI

> **MCP Unified - Unlimit MCP servers with zero upfront tokens, and up to 90% token reduction**

MCPU is an MCP multiplexer (1:N) that manages all your MCP servers for multiple AI Assistants, with progressive discovery, parallel batch calls, code execution, and up to 90% token reduction.

```
Claude CLI/Desktop ─┐          ┌-> playwright
       Gemini CLI ──┼-> mcpu ──┼-> filesystem
      OpenAI Codex ─┘          └-> memory
```

It can be used in two ways:

1. **As an MCP Server** (`mcpu-mcp`) - For clients with native MCP support (Claude Desktop, Cursor, etc.)
2. **Via CLI** (`mcpu-daemon` + `mcpu-remote`) - For AI agents with bash tool access (Claude Code, etc.)

## Why MCPU?

MCP tool schemas are verbose. A single server like Playwright requires ~11KB of schema data. With multiple servers, this adds up quickly and consumes valuable context window space. MCP servers can also return large inline responses that bloat tokens or even fail to send to the LLM. Additionally, native MCP tool calls execute sequentially even when requested in parallel, making cross-server operations slow.

MCPU addresses this by:

- **Progressive discovery and disclosure** - Servers and their tool schemas are revealed and connected only when needed
- **Compressing tool schemas** - Reduces schema size by up to 90% using a compact format designed for AI consumption
- **Intercept** - Intercept large inline content and save them to disk
- **Exec** - Run JavaScript code to orchestrate tools, filter responses, and control what reaches the context window
- **True parallel execution** - The `batch` command enables real cross-server parallelism (see verification below)
- **CLI-first design** - Built for AI agents with bash tool access (Claude Code, etc.), not just MCP-native clients

### Parallel Execution Verification

```
# Native MCP - 3 servers with 6s, 7s, 8s sleep calls "in parallel"
sleep:  18:06:14 → 18:06:20 (6s)
sleep2: 18:06:20 → 18:06:27 (7s)  ← started after sleep finished
sleep3: 18:06:28 → 18:06:36 (8s)  ← started after sleep2 finished
Total: ~21 seconds (sequential)

# MCPU batch - same operations, truly parallel
All three started together, finished when slowest completed
Total: ~8 seconds (2.6x faster)
```

This makes MCPU essential for workflows that need to query multiple databases, fetch from multiple APIs, or run independent operations across different MCP servers simultaneously.

## Schema Compression Stats

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

## MCP Tool Schema

When used as an MCP server, MCPU exposes a single `mux` tool:

```yaml
name: mux
description: MCP muxer
argv: "[cmd, ...args]: servers [fuzzy], tools|info|call|connect|disconnect|setConfig <server> [tool..], batch, connections, reload"
params: "batch: {timeout?, resp_mode?: auto|full|summary|refs}"
batch: "{id: {argv, params}}"
setConfig.extraArgs: "args from user"
```

### Batch Calls

Execute multiple calls in one request. Per-server serial, cross-server parallel:

```js
argv: ["batch"],
batch: {
  "01": { argv: ["call", "server1", "tool1"], params: {...} },
  "02": { argv: ["tools", "server2"] }
},
params: { timeout: 5000, resp_mode: "auto" }  // optional
```

Response modes: `auto` (threshold truncation), `full` (inline all), `summary` (brief+files), `refs` (files only).

### Exec Command

Execute JavaScript code in an isolated worker with access to `mcpuMux()` for programmatic tool orchestration:

```js
argv: ["exec"],
params: {
  code: `
    const result = await mcpuMux({
      argv: ["call", "tasks", "tm"],
      params: { cmd: "list", type: "issue", proj: "myproj" }
    });
    return result.issues.filter(i => i.status === "open");
  `,
  timeout: 30000  // optional, default 30s
}
```

**Parameters:**
- `code` - Inline JavaScript code to execute
- `file` - Path to a JS file to execute (alternative to `code`)
- `timeout` - Execution timeout in ms (default: 30000)

**The `mcpuMux` function:**
```js
async function mcpuMux(options: {
  argv: string[];           // Command arguments
  params?: object;          // Tool parameters
  batch?: object;           // Batch calls
}): Promise<any>
```

**Use cases:**
- Filter/transform large responses before returning to context
- Chain multiple tool calls with conditional logic
- Aggregate data from multiple servers
- Implement retry logic or error handling

**Security:** Exec runs in an isolated worker process. To disable exec entirely, add to your config:
```json
{
  "execEnabled": false
}
```

## 📦 Installation

### Claude CLI

1. Install MCPU globally (or use npx):

```bash
npm install -g @mcpu/cli
```

2. Migrate your existing MCP servers from Claude Desktop, Claude CLI, Gemini CLI, and/or Cursor:

```bash
mcpu setup --dry-run  # Preview changes
mcpu setup            # Run migration (updates all detected configs)
```

3. Start Claude CLI and check `/context` to verify that `mcpu` is the only MCP server Claude connected.

4. Test by asking Claude to `list my mcp servers`

Something like this:

```
> list my mcp servers

⏺ mcpu - mux (MCP)(argv: ["servers"])
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

### Without Global Install (npx)

If you prefer not to install globally, you'll need to manually add MCPU to Claude CLI:

```bash
# Run setup with npx (migrates servers to ~/.config/mcpu/config.json)
npx @mcpu/cli setup --dry-run
npx @mcpu/cli setup

# Manually add MCPU to Claude CLI (since mcpu-mcp isn't globally available)
claude mcp add --scope=user mcpu -- npx --package=@mcpu/cli -c mcpu-mcp
```

**You don't need this, but in case Claude can't figure it out, add to your `CLAUDE.md`**:

```markdown
## MCP Servers

Use the MCPU `mux` tool to discover and use other MCP servers.
```

## 🤖 Bash CLI Mode

If you want to use MCPU in bash mode, tell Claude to set it up. Pick a prompt appropriate for your need:

- `AGENTS.md` and reference in `CLAUDE.md`

```
run `mcpu agent-guide` and follow the instructions
```

- Project `CLAUDE.md`

```
run `mcpu agent-guide` and follow the instructions to setup only my project CLAUDE.md
```

- User level `CLAUDE.md`

```
run `mcpu agent-guide` and follow the instructions to setup only my user CLAUDE.md
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

### Auto-Save Large Responses

Large MCP tool responses can consume valuable context. MCPU can auto-save responses exceeding a threshold to files, returning a truncated preview with a file path for the agent to explore.

```json
{
  "autoSaveResponse": {
    "enabled": true,
    "thresholdSize": 10240,
    "dir": ".temp/mcpu-responses",
    "previewSize": 500
  },

  "playwright": {
    "command": "npx",
    "args": ["-y", "@anthropic/mcp-playwright"],
    "autoSaveResponse": {
      "enabled": false
    }
  },

  "chroma": {
    "command": "uvx",
    "args": ["chroma-mcp"],
    "autoSaveResponse": {
      "thresholdSize": 5120,
      "byTools": {
        "query_documents": { "thresholdSize": 1024 },
        "add_documents": { "enabled": false }
      }
    }
  }
}
```

**Settings (all optional):**

| Field           | Default                | Description                          |
| --------------- | ---------------------- | ------------------------------------ |
| `enabled`       | `true`                 | Enable/disable auto-save             |
| `thresholdSize` | `10240`                | Size in bytes to trigger save (10KB) |
| `dir`           | `.temp/mcpu-responses` | Directory for saved responses        |
| `previewSize`   | `500`                  | Characters to show in preview        |

**Hierarchy:** Settings merge from `global` ← `server` ← `byTools[tool]` (inner wins).

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

### `mcpu setup`

Migrate MCP servers from Claude Desktop, Claude CLI, Gemini CLI, and/or Cursor to MCPU. This automates the initial setup:

1. Discovers MCP servers from:
   - Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Claude CLI: `~/.claude.json` (or `CLAUDE_CONFIG_DIR/settings.json`)
   - Gemini CLI: `~/.gemini/settings.json`
   - Cursor: `~/.cursor/mcp.json`
2. Reads project-level MCP configs (deduplicates, global wins over project)
3. Saves servers to `~/.config/mcpu/config.json`
4. Updates all detected configs to use only MCPU (creates `.mcpu.bak` backups)

```bash
# Preview what would be migrated
mcpu setup --dry-run

# Run migration (creates backups automatically)
mcpu setup

# Skip confirmation prompts
mcpu setup -y
```

**Options:**

- `--dry-run` - Show migration plan without making changes
- `-y, --yes` - Skip confirmation prompts

### `mcpu agent-guide`

Print bash tool usage guide for AI agents. Use this to set up MCPU instructions in your agent files.

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
