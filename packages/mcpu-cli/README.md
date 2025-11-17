# MCPU CLI

> **Compression proxy for MCP tool schemas - Reduce token usage by 90%+**

MCPU CLI is a lightweight command-line tool that acts as a proxy between Claude Code and MCP servers, dramatically reducing the token overhead of tool schema discovery.

## 🎯 Problem

When using multiple MCP servers with Claude Code, the initial tool schema discovery of one server can consume **14,000+ tokens**. This happens because:

- Each MCP server exposes detailed JSON schemas for every tool
- Claude Code must load all schemas upfront to understand available tools
- With 3-4 servers, schemas alone can exceed context limits
- This wastes tokens that could be used for actual work

**Example:** With 3 MCP servers (filesystem, playwright, github), the tool schemas consume `>15k` tokens before any actual conversation begins.

## 💡 Solution

**MCPU** compresses tool schemas and provides them on-demand:

1. **Tools** - Returns minimal tool listings (just names + short descriptions)
2. **Info** - Fetch full schema only when Claude needs to use a specific tool
3. **Call** - Execute tools through the proxy
4. **Cache** - Remember schemas locally to avoid repeated discovery overhead

**Token Reduction:** 14,000+ tokens → ~500 tokens (97% reduction)

## 📦 Installation

```bash
npm install -g @mcpu/cli
```

## 🚀 Quick Start

### 1. Configure your MCP servers

Create `.config/mcpu/config.local.json` in your project directory:

**stdio transport (process-based servers):**

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
  }
}
```

**HTTP transport (SSE-based servers):**

```json
{
  "playwright": {
    "type": "http",
    "url": "http://localhost:9000/mcp"
  }
}
```


### 2. List available servers

```bash
mcpu servers
```

### 3. List all tools

```bash
# All tools from all servers
mcpu tools

# Tools from specific servers
mcpu tools filesystem
mcpu tools filesystem playwright
```

### 4. Show tool details

```bash
# Show info for one tool
mcpu info filesystem read_file

# Show info for multiple tools
mcpu info filesystem read_file write_file
```

### 5. Execute a tool

```bash
# With CLI arguments
mcpu call filesystem read_file --path=/etc/hosts

# With JSON from stdin
echo '{"path": "/etc/hosts"}' | mcpu call filesystem read_file --stdin
```

## 📚 Commands

### `mcpu servers`

List all configured MCP servers.

**Output:**

```
Configured MCP Servers:

filesystem
  Command: npx
  Args: -y @modelcontextprotocol/server-filesystem /tmp

Total: 1 server
```

**JSON:**

```bash
mcpu servers --json
```

### `mcpu tools [servers...]`

List tools from all servers or specific servers.

**Examples:**

```bash
# All tools (flat list)
mcpu tools

# Tools from specific server
mcpu tools filesystem

# Tools from multiple servers
mcpu tools filesystem playwright

# JSON output
mcpu tools filesystem --json
```

**Output:**

```
Tools from filesystem:

read_file - Read contents of a file
write_file - Write contents to a file
list_directory - List directory contents
create_directory - Create a new directory

Total: 4 tools
```

### `mcpu info <server> <tools...>`

Display detailed information about one or more tools.

**Examples:**

```bash
# Show info for one tool
mcpu info filesystem read_file

# Show info for multiple tools
mcpu info filesystem read_file write_file
```

**Output:**

```
read_file

Read the complete contents of a file as text

Arguments:
  path   string - Absolute path to the file
  tail?  number - If provided, returns only the last N lines
  head?  number - If provided, returns only the first N lines

Example:
  mcpu call filesystem read_file --path=<value>
```

### `mcpu call <server> <tool> [args]`

Execute a tool and return the result.

**Option 1: CLI-style arguments**

```bash
# String arguments
mcpu call filesystem read_file --path=/etc/hosts

# Number arguments (auto-detected)
mcpu call api fetch --timeout=5000 --retries=3

# Multiple arguments
mcpu call filesystem read_file --path=/tmp/file.txt --head=10
```

**Option 2: JSON via stdin**

```bash
# Using heredoc
mcpu call filesystem read_file --stdin <<EOF
{
  "path": "/etc/hosts"
}
EOF

# Or pipe
echo '{"path": "/etc/hosts"}' | mcpu call filesystem read_file --stdin
```

## ⚙️ Configuration

### Config Sources (Priority Order)

MCPU searches for configuration in this order:

1. `--config <file>` CLI flag (highest priority)
2. `.config/mcpu/config.local.json` in current directory (local project config, gitignored)
3. `$XDG_CONFIG_HOME/mcpu/config.json` or `~/.config/mcpu/config.json` (user config, follows [XDG Base Directory spec](https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html))

### Config Format

**stdio transport (process-based servers):**

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
    "env": {
      "SOME_VAR": "value"
    }
  }
}
```

**HTTP transport (SSE-based servers):**

```json
{
  "playwright": {
    "type": "http",
    "url": "http://localhost:9000/mcp",
    "headers": {
      "Authorization": "Bearer token"
    }
  }
}
```


## 🎛️ Global Options

- `--json` - Output in JSON format (for programmatic use)
- `--config <file>` - Use specific config file
- `--verbose` - Show detailed logging
- `--no-cache` - Skip cache, force fresh discovery

**Example:**

```bash
mcpu tools --json --verbose --no-cache
```

## 💾 Caching

MCPU automatically caches tool schemas to `$XDG_CACHE_HOME/mcpu/` (or `~/.cache/mcpu/`) with a 24-hour TTL.

**Benefits:**

- Faster subsequent tool listings
- Reduces connection overhead
- Avoids repeated server spawns

**Cache control:**

```bash
# Force fresh discovery (skip cache)
mcpu tools --no-cache

# Cache is automatically invalidated after 24 hours
```

## 🤖 Using with Claude Code

Add to your `.claude/CLAUDE.md`:

```markdown
## MCP Tools

Use `mcpu` CLI to access MCP tools:

- `mcpu servers` - List all configured MCP servers
- `mcpu tools [servers...]` - List tools from servers, e.g. `mcpu tools filesystem`
- `mcpu info <server> <tools...>` - Show tool schema, e.g. `mcpu info filesystem read_file`
- `mcpu call <server> <tool> [args]` - Execute tool, e.g. `mcpu call filesystem read_file --path=/etc/hosts`
```

## 🔧 Development

```bash
# Install dependencies
fyn install

# Run directly with tsx
fyn dev

# Type check
fyn typecheck

# Run tests
fyn test
```

## 📝 Example Workflow

```bash
# 1. List all tools (compressed)
mcpu tools
# → filesystem/read_file - Read contents of a file
# → filesystem/write_file - Write contents to a file
# → playwright/navigate - Navigate browser to URL
# ...

# 2. When Claude needs details about a specific tool
mcpu info filesystem read_file
# → Returns detailed schema for just this tool

# 3. Execute the tool
mcpu call filesystem read_file --path=/etc/hosts
# → 127.0.0.1 localhost
# → ::1 localhost
```

## 🎯 Use Cases

1. **Reduce context window usage** - Save tokens for actual work
2. **Faster tool discovery** - Cached schemas mean instant lookups
3. **Better error messages** - See exactly what arguments a tool expects
4. **Testing MCP servers** - Quickly verify server functionality
5. **CLI automation** - Script MCP tool calls programmatically

## 🐛 Troubleshooting

**"No MCP servers configured"**

- Verify config file exists (`.config/mcpu/config.local.json` or `~/.config/mcpu/config.json`)
- Use `--verbose` to see which config files are being checked

**"Failed to connect to server"**

- Check that the command path is correct
- Verify the MCP server is installed
- Use `--verbose` to see connection details

**"Unknown option"**

- Make sure tool arguments come after the server and tool name
- Example: `mcpu call server tool --arg=value` not `mcpu call --arg=value server tool`

## 📄 License

MIT

## 🤝 Contributing

This is currently an internal project. For questions or issues, please contact the maintainer.

---

**Built with:**

- [nix-clap](https://github.com/jchip/nix-clap) - CLI argument parsing
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) - MCP protocol implementation
- [chalk](https://github.com/chalk/chalk) - Terminal styling
- [zod](https://github.com/colinhacks/zod) - Schema validation
