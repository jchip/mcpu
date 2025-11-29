# MCPU - MCP Unified

MCP (Model Context Protocol) Unified tools that enhance AI coding assistants through efficient tool schema compression and proxy capabilities.

# Stats

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

# Installation

## Claude CLI

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

# Packages

- Actual packages are in the `packages` folder.
- `@mcpu/cli` is in `packages/mcpu-cli`
- npm page at https://www.npmjs.com/package/@mcpu/cli
