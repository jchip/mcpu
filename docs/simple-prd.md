**Product Requirements Document (PRD)**
**Product:** MCPU
**Version:** MVP 1.0
**Author:** —
**Date:** November 2024

---

### 🎯 Problem Statement

When using multiple MCP servers with Claude Code, the initial tool schema discovery consumes 14,000+ tokens. This happens because:

- Each MCP server exposes detailed JSON schemas for every tool
- Claude Code must load all schemas upfront to understand available tools
- With 3-4 servers, schemas alone can exceed context limits
- This wastes tokens that could be used for actual work

### 💡 Solution Approach

MCPU acts as a compression proxy between Claude Code and MCP servers:

1. **Intercept** - Sit between Claude and MCP servers as a CLI tool
2. **Compress** - Provide minimal tool listings (just names + descriptions)
3. **Lazy Load** - Only fetch full schemas when Claude needs to use a specific tool
4. **Cache** - Remember schemas locally to avoid repeated discovery

This reduces initial overhead from 14k+ tokens to ~500 tokens while maintaining full functionality.

---

### 🥅 Goal

**Primary:** Solve the token overhead problem when using multiple MCP servers with Claude Code by providing a compression proxy that reduces initial tool discovery from 14k+ tokens to ~500 tokens.

**Secondary:** Simplify MCP tool discovery and execution through a unified CLI interface that acts as an intermediary between Claude Code and configured MCP servers.

---

### 📋 Requirements

**MVP Functional Requirements**

1. **MCP Configuration Discovery**

   - Read existing MCP server configurations from `~/.claude/settings.json` and project `.mcp.json` files
   - Support stdio-based MCP servers (most common type)
   - Parse and validate server command/args/env configurations

2. **Schema Compression & Caching**

   - Connect to MCP servers on-demand (ephemeral connections)
   - Cache full tool schemas locally for performance
   - Provide compressed tool listings (name + one-line description only)
   - Lazy-load full schemas only when needed

3. **CLI Interface**

   - `mcpu list` - List all configured servers with compressed tool summaries
   - `mcpu show <server:tool>` - Display full schema for a specific tool
   - `mcpu call <server:tool> <params>` - Execute a tool and return results
   - JSON output mode for programmatic use

4. **Claude Code Integration**
   - Expose as a bash command that Claude can call directly
   - Return concise, token-efficient responses
   - Support streaming output for long-running operations

**Non-Functional Requirements**

1. **Performance**

   - Initial tool listing must be under 1000 tokens total
   - Tool execution latency < 500ms for local servers
   - Cache schemas to avoid repeated discovery

2. **Compatibility**

   - Work with existing Claude Code and MCP ecosystem
   - No changes required to MCP servers or Claude Code
   - Support macOS and Linux initially

3. **Simplicity**
   - No persistent daemon or background process
   - Minimal dependencies (Node.js + MCP SDK)
   - Single command installation

---

### 🌟 MVP Features

- **Token-Efficient Discovery:** Compress 14k+ tokens of tool schemas to under 500 tokens for initial discovery
- **Lazy Schema Loading:** Only fetch full tool details when actually needed
- **Unified CLI:** Single command to list, inspect, and execute tools across all MCP servers
- **Zero Configuration:** Works with existing Claude Code MCP setup - no config changes needed
- **Fast Ephemeral Connections:** Spawn MCP servers on-demand, no persistent processes
- **Local Schema Cache:** Remember tool schemas to avoid repeated discovery overhead
- **Bash Integration:** Direct CLI tool that Claude Code can call without special integration

### 🚀 Future Features (Post-MVP)

- **Persistent Mode:** Optional daemon for faster response times
- **WebSocket Support:** Handle SSE and WebSocket MCP transports
- **Server Management:** Install and configure MCP servers
- **Registry Integration:** Browse and install from MCP marketplaces
- **Security Sandboxing:** Capability-based access control
- **Multi-Client Support:** Work with Cursor, Zed, and other MCP clients

---

### 📝 Usage Examples

**List all available tools (compressed):**

```bash
$ mcpu list
filesystem:
  read_file - Read contents of a file
  write_file - Write contents to a file
  list_directory - List directory contents

playwright:
  navigate - Navigate browser to URL
  screenshot - Take a screenshot
  click - Click on element

github:
  create_issue - Create GitHub issue
  list_repos - List repositories

Total: 12 tools across 3 servers (~450 tokens)
```

**Get full schema for specific tool:**

```bash
$ mcpu show playwright:navigate
{
  "name": "navigate",
  "description": "Navigate browser to a URL",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url": { "type": "string", "format": "uri" },
      "waitUntil": {
        "type": "string",
        "enum": ["load", "domcontentloaded", "networkidle"]
      }
    },
    "required": ["url"]
  }
}
```

**Execute a tool:**

```bash
$ mcpu call filesystem:read_file '{"path": "/etc/hosts"}'
{
  "content": "127.0.0.1 localhost\n::1 localhost"
}
```

**Integration with Claude Code:**

```bash
# Claude can discover tools efficiently
$ mcpu list --json

# Claude gets details only when needed
$ mcpu show github:create_issue --json

# Claude executes through the proxy
$ mcpu call github:create_issue '{"title": "Bug fix", "body": "..."}'
```
