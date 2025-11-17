# MCPU MVP Implementation Plan

**Version:** 1.0
**Date:** November 2024
**Status:** Ready for Implementation

---

## 🎯 Problem Statement

When using multiple MCP servers with Claude Code, the initial tool schema discovery consumes **14,000+ tokens**. This happens because:

- Each MCP server exposes detailed JSON schemas for every tool
- Claude Code must load all schemas upfront to understand available tools
- With 3-4 servers, schemas alone can exceed context limits
- This wastes tokens that could be used for actual work

**Example:** With 3 MCP servers (filesystem, playwright, github), the tool schemas consume ~14k tokens before any actual conversation begins.

---

## 💡 Solution Architecture

**MCPU** acts as a compression proxy between Claude Code and MCP servers:

1. **Intercept** - Provide a CLI tool Claude can call instead of connecting directly to MCP servers
2. **Compress** - Return minimal tool listings (just names + short descriptions)
3. **Lazy Load** - Only fetch full schemas when Claude needs to use a specific tool
4. **Cache** - Remember schemas locally to avoid repeated discovery overhead

**Token Reduction:** 14,000+ tokens → ~500 tokens (97% reduction)

---

## 🏗️ Technical Architecture

### Core Principles

- **Ephemeral Connections**: Spawn MCP servers on-demand, no persistent daemon
- **Multi-Transport**: Support stdio, SSE, and WebSocket MCP servers
- **Local Caching**: Cache tool schemas to avoid repeated discovery
- **Zero Config**: Works with existing Claude Code MCP configurations

### Architecture Diagram

```
┌─────────────┐
│ Claude Code │
└──────┬──────┘
       │ mcpu list
       ▼
┌─────────────────┐
│   MCPU CLI   │◄─── Cache (~/.cache/mcpu/)
└────────┬────────┘
         │ (ephemeral connections)
    ┌────┴────┬────────┬─────────┐
    ▼         ▼        ▼         ▼
┌─────┐  ┌─────┐  ┌─────┐   ┌─────┐
│ MCP │  │ MCP │  │ MCP │   │ MCP │
│  #1 │  │  #2 │  │  #3 │   │  #4 │
└─────┘  └─────┘  └─────┘   └─────┘
stdio    SSE      WS        stdio
```

---

## 🛠️ Technology Stack

### Runtime & Language

- **Node.js**: >= 18.0.0 (built-in fetch support)
- **TypeScript**: Full type safety with TSX for direct execution
- **tsx**: Execute TypeScript files directly without compilation

### Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.4",
    "nix-clap": "^2.4.1",
    "chalk": "^5.3.0",
    "zod": "^3.23.0",
    "tsx": "^4.19.0",
    "undici": "^6.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.0.0"
  }
}
```

### Transport Support

- **stdio**: Local process-based servers (StdioClientTransport)
- **SSE**: Server-Sent Events over HTTP (SSEClientTransport)
- **WebSocket**: WebSocket connections (WebSocketClientTransport)

---

## ⚙️ Configuration Discovery

### Config Sources (Priority Order)

1. `--config <file>` CLI flag (highest priority)
2. `MCPU_CONFIG` environment variable
3. `.mcpu.json` in current directory
4. `.mcp.json` in current directory (Claude project format)
5. `~/.claude/settings.json` (Claude user settings)
6. `~/.mcpu/config.json` (MCPU user config)

### Config Format Examples

**stdio transport:**

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
    "env": {}
  }
}
```

**SSE transport:**

```json
{
  "remote-server": {
    "transport": "sse",
    "url": "http://localhost:3000/sse"
  }
}
```

**WebSocket transport:**

```json
{
  "ws-server": {
    "transport": "websocket",
    "url": "ws://localhost:3000/ws"
  }
}
```

**Claude settings.json format (compatible):**

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/"]
    }
  }
}
```

---

## 📦 CLI Interface

### Commands

#### `mcpu servers`

List all configured MCP servers.

**Output:**

```
filesystem - Local filesystem operations
playwright - Browser automation via Playwright
github - GitHub API integration

Total: 3 servers
```

**JSON:**

```json
{
  "servers": [
    { "name": "filesystem", "description": "Local filesystem operations" },
    { "name": "playwright", "description": "Browser automation" },
    { "name": "github", "description": "GitHub API integration" }
  ],
  "total": 3
}
```

#### `mcpu list <server>`

List all tools from a specific MCP server.

**Output:**

```bash
$ mcpu list filesystem

read_file - Read contents of a file
write_file - Write contents to a file
list_directory - List directory contents
create_directory - Create a new directory

Total: 4 tools
```

**JSON:**

```json
{
  "server": "filesystem",
  "tools": [
    { "name": "read_file", "description": "Read contents of a file" },
    { "name": "write_file", "description": "Write contents to a file" },
    { "name": "list_directory", "description": "List directory contents" },
    { "name": "create_directory", "description": "Create a new directory" }
  ],
  "total": 4
}
```

#### `mcpu list` (no args)

List ALL tools from ALL servers (flat list).

**Output:**

```
filesystem/read_file - Read contents of a file
filesystem/write_file - Write contents to a file
playwright/navigate - Navigate browser to URL
playwright/screenshot - Take a screenshot
github/create_issue - Create GitHub issue
github/list_repos - List repositories

Total: 6 tools across 3 servers (~300 tokens)
```

#### `mcpu show <server:tool>`

Display tool details in CLI-style format (NOT full JSON schema).

**Output (human-readable):**

```bash
$ mcpu show filesystem:read_file

read_file <path> <encoding?>

Read contents of a file from the filesystem

Arguments:
  path       string - Absolute path to the file
  encoding?  string - Character encoding (default: utf8, values: utf8|ascii|base64)

Example:
  mcpu call filesystem:read_file --path=/etc/hosts
  mcpu call filesystem:read_file --path=/tmp/file.txt --encoding=base64
```

**JSON (compressed schema):**

```json
{
  "server": "filesystem",
  "tool": "read_file",
  "description": "Read contents of a file from the filesystem",
  "arguments": [
    {
      "name": "path",
      "type": "string",
      "required": true,
      "description": "Absolute path to the file"
    },
    {
      "name": "encoding",
      "type": "utf8|ascii|base64",
      "required": false,
      "default": "utf8",
      "description": "Character encoding"
    }
  ]
}
```

**Token Savings:**

- Full JSON schema: ~400 tokens
- CLI-style format: ~50 tokens
- **90% reduction!**

#### `mcpu call <server:tool> [args]`

Execute a tool and return the result.

**Option 1: CLI-style arguments (recommended for interactive use)**

The hub automatically converts CLI args to the correct JSON types based on the tool's schema:

```bash
# String arguments (default)
mcpu call filesystem:read_file --path=/etc/hosts --encoding=utf8

# Number arguments (auto-detected)
mcpu call api:fetch --url=https://api.com --timeout=5000 --retries=3

# Boolean arguments
mcpu call server:start --verbose=true --daemon=false

# Array arguments (comma-separated)
mcpu call github:create_issue --title="Bug" --labels=bug,urgent

# Output
{
  "result": {
    "content": "127.0.0.1 localhost\n::1 localhost"
  }
}
```

**Type Conversion Rules:**

- **string**: Default, no conversion needed
- **number**: Auto-detected if value is all digits, or use explicit `--arg:number=123`
- **boolean**: Accepts `true/false`, `yes/no`, `1/0`
- **array**: Split by comma for simple arrays

**Option 2: JSON via stdin (for scripts/complex objects)**

Use `--stdin` flag to read JSON from stdin:

```bash
# Using heredoc
mcpu call filesystem:read_file --stdin <<EOF
{
  "path": "/etc/hosts",
  "encoding": "utf8"
}
EOF

# Or pipe
echo '{"path": "/etc/hosts"}' | mcpu call filesystem:read_file --stdin

# Or from file
cat params.json | mcpu call filesystem:read_file --stdin
```

**How it works:**

1. `mcpu show` reveals argument types from schema
2. `mcpu call` uses those types to coerce CLI args
3. Simple validation before sending to MCP server
4. MCP server does final validation

### Global Flags

- `--json` - Output in JSON format (for programmatic use)
- `--config <file>` - Use specific config file
- `--verbose` - Show detailed logging
- `--no-cache` - Skip cache, force fresh discovery

---

## 📁 File Structure

```
packages/mcpu-cli/
├── bin/
│   └── mcpu              # Executable wrapper (runs tsx)
├── src/
│   ├── cli.ts               # Main entry point with nix-clap
│   ├── types.ts             # TypeScript interfaces
│   ├── config.ts            # Config discovery logic
│   ├── client.ts            # MCP client wrapper
│   ├── cache.ts             # Schema caching
│   └── commands/
│       ├── list.ts          # List command implementation
│       ├── show.ts          # Show command implementation
│       └── call.ts          # Call command implementation
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🔨 Implementation Roadmap

### Phase 1: Core Infrastructure

1. **types.ts** - TypeScript interfaces

   - MCP server config schemas (Zod)
   - Tool summary interfaces
   - Cache entry format
   - CLI output formats

2. **config.ts** - Configuration discovery

   - Read from multiple sources
   - Parse different config formats
   - Merge configs with correct priority
   - Validate with Zod schemas

3. **client.ts** - MCP client wrapper

   - Detect transport type (stdio/SSE/WebSocket)
   - Create appropriate transport
   - Connect to MCP server
   - List tools
   - Call tools
   - Manage ephemeral connections

4. **cache.ts** - Schema caching
   - Store tool schemas in ~/.cache/mcpu/
   - 24-hour TTL
   - Cache invalidation
   - Version compatibility

### Phase 2: CLI Commands

5. **commands/list.ts**

   - Discover all configured servers
   - Connect to each (or use cache)
   - Fetch tool lists
   - Compress to name + description
   - Estimate token count
   - Format output (human/JSON)

6. **commands/show.ts**

   - Parse `server:tool` format
   - Get full tool schema
   - Display formatted output

7. **commands/call.ts**
   - Parse `server:tool` and params
   - Connect to server
   - Execute tool
   - Return result

### Phase 3: CLI Setup

8. **cli.ts** - Main CLI

   - Use nix-clap for argument parsing
   - Define commands and flags
   - Route to command handlers
   - Error handling
   - Help text

9. **bin/mcpu** - Executable wrapper
   - Shebang for Node.js
   - Spawn tsx with cli.ts
   - Forward arguments

### Phase 4: Testing & Polish

10. **Testing**

    - Install test MCP server (filesystem)
    - Test all three commands
    - Verify token compression
    - Test different transports

11. **Documentation**
    - Usage examples
    - Config format guide
    - Troubleshooting

---

## ✅ Implementation Checklist

### Core Files

- [ ] `src/types.ts` - All TypeScript interfaces and Zod schemas
- [ ] `src/config.ts` - Multi-source config discovery
- [ ] `src/client.ts` - MCP client with multi-transport support
- [ ] `src/cache.ts` - Local schema caching

### Commands

- [ ] `src/commands/list.ts` - Compressed tool listing
- [ ] `src/commands/show.ts` - Full tool schema display
- [ ] `src/commands/call.ts` - Tool execution

### CLI & Distribution

- [ ] `src/cli.ts` - Main CLI with nix-clap
- [ ] `bin/mcpu` - Executable wrapper
- [ ] `package.json` - Dependencies and scripts
- [ ] `tsconfig.json` - TypeScript config

### Testing

- [ ] Install test MCP server
- [ ] Test `mcpu list` output
- [ ] Test `mcpu show` with real tool
- [ ] Test `mcpu call` execution
- [ ] Verify token count reduction
- [ ] Test with stdio transport
- [ ] Test with SSE transport
- [ ] Test cache functionality

---

## 🎯 Success Criteria

### Functional Requirements

✅ Can discover MCP servers from multiple config sources
✅ Can connect to stdio, SSE, and WebSocket MCP servers
✅ Can list all tools in compressed format
✅ Can show full schema for specific tools
✅ Can execute tools and return results
✅ Caches schemas locally with 24h TTL

### Performance Requirements

✅ Initial tool listing < 1000 tokens (target: ~500)
✅ Tool execution latency < 1000ms for local servers
✅ Cache hit avoids server connection

### Compatibility Requirements

✅ Works with Claude Code's existing MCP configuration
✅ No changes required to MCP servers
✅ Supports macOS and Linux
✅ Node.js >= 18.0.0

---

## 🧪 Testing Strategy

### Setup Test Environment

1. Install a simple MCP server:

   ```bash
   npm install -g @modelcontextprotocol/server-filesystem
   ```

2. Create test config at `.mcpu.json`:
   ```json
   {
     "filesystem": {
       "command": "npx",
       "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
     }
   }
   ```

### Test Commands

```bash
# Test list command
mcpu list
mcpu list --json

# Test show command
mcpu show filesystem:read_file
mcpu show filesystem:write_file --json

# Test call command
mcpu call filesystem:list_directory '{"path": "/tmp"}'
```

### Verify Token Compression

1. Count tokens in `mcpu list --json` output
2. Compare to full schema size from direct MCP connection
3. Confirm 90%+ reduction

---

## 🚀 Future Enhancements (Post-MVP)

- **Persistent mode**: Optional daemon for faster responses
- **Auth support**: OAuth, API keys for remote servers
- **Server management**: Install/update MCP servers
- **Registry integration**: Browse MCP marketplace
- **Resource support**: List and access MCP resources
- **Prompt support**: List and use MCP prompts
- **Multi-client**: Work with Cursor, Zed, etc.
- **Performance metrics**: Track latency, cache hit rates

---

## 📚 References

- [MCP Specification](https://modelcontextprotocol.io)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/typescript-sdk)
- [Claude Code Documentation](https://docs.claude.com)
- [Blog Post: MCP Token Overhead Problem](#) (inspiration)
