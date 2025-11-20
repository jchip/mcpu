# MCPU Daemon Architecture

**Status:** ✅ Complete
**Date:** November 19, 2024
**Version:** 0.2.0

---

## Overview

The MCPU daemon provides persistent MCP server connections for improved performance and resource efficiency. Instead of spawning new server processes for each tool call, the daemon maintains a pool of active connections that can be reused across multiple requests.

## Architecture Components

### 1. Core Components

#### `mcpu-daemon.mjs`
- HTTP server that manages the connection pool
- Listens on OS-assigned port (or specified with `--port`)
- Saves daemon info to `$XDG_DATA_HOME/mcpu/daemon.<pid>.json`
- Provides REST API for CLI operations and management

#### `mcpu-remote.mjs`
- **Only has a `stop` command** for shutting down the daemon
- All other commands are forwarded to daemon's `/cli` endpoint via `--` separator
- Auto-discovers running daemon (most recent by default)
- Can target specific daemon with `--port` or `--pid` options

#### Connection Pool (`daemon/connection-pool.ts`)
- Manages persistent MCP server connections
- Tracks connection metadata (status, timestamps, usage)
- Auto-cleanup of stale connections (5 minute TTL)
- Provides `getConnection()`, `disconnect()`, `listConnections()` APIs

#### Core Executor (`core/core.ts` + `core/executor.ts`)
- **Shared command execution logic** used by both CLI and daemon
- Parses commands using NixClap
- Routes to appropriate command executors
- Works with or without ConnectionPool (daemon vs standalone)

### 2. Command Architecture

All MCPU commands (servers, tools, info, call, connect, disconnect, reconnect, connections) are handled by the **core executor infrastructure**:

```
mcpu-remote.mjs -- <command> <args>
         ↓
   HTTP POST /cli
         ↓
   daemon server.ts
         ↓
   coreExecute(argv, connectionPool)
         ↓
   executeCommand(command, args, options)
         ↓
   [specific command executor]
```

### 3. Command Flow

#### Standard Commands (servers, tools, info, call)

```bash
# User runs:
./bin/mcpu-remote.mjs -- servers

# Flow:
1. mcpu-remote discovers daemon port
2. Sends POST to http://localhost:<port>/cli
   Body: { argv: ["servers"], cwd: "/current/dir" }
3. Daemon calls coreExecute({ argv, connectionPool })
4. Core parses command and routes to executeServersCommand()
5. Result returned to client via HTTP response
6. mcpu-remote prints output and exits with status code
```

#### Connection Management Commands (connect, disconnect, reconnect, connections)

These commands are **daemon-only** and interact with the ConnectionPool:

```bash
# Connect to a server:
./bin/mcpu-remote.mjs -- connect chroma

# Flow:
1. Command forwarded to daemon's /cli endpoint
2. executeConnectCommand() is called
3. Uses ConfigDiscovery to get server config
4. Calls connectionPool.getConnection(server, config)
5. Captures and returns stderr output from server startup
6. Returns success message with stderr to client
```

**Key Points:**
- These commands only work in daemon mode
- They return error if connectionPool is not available
- Server stderr is captured and shown to user
- Connections are persisted in the pool for reuse

### 4. mcpu-remote Commands

#### `stop` (Direct Command)
- **Only** command implemented directly in mcpu-remote
- Shuts down daemon(s)
- Options:
  - `stop` - Stop the discovered/targeted daemon
  - `stop --all` - Stop all running daemons

#### All Other Commands (Forwarded via `--`)
- `-- servers` - List configured servers
- `-- tools [servers...]` - List tools
- `-- info <server> <tools...>` - Show tool details
- `-- call <server> <tool> [args]` - Execute a tool
- `-- connect <server>` - Connect to MCP server
- `-- disconnect <server>` - Disconnect from MCP server
- `-- reconnect <server>` - Reconnect to MCP server
- `-- connections` - List active connections

### 5. Connection Pool Features

#### Connection Lifecycle
```typescript
interface ConnectionInfo {
  id: number;
  server: string;
  connection: MCPConnection;
  status: 'connected' | 'disconnected' | 'error';
  connectedAt: number;
  lastUsed: number;
  closedAt: number | null;
}
```

#### Auto-Cleanup
- Connections inactive for 5 minutes are automatically closed
- Cleanup runs periodically
- Preserves connection history for debugging

#### Stderr Handling
- Server stderr is buffered in `connection.stderrBuffer`
- Accessible via `connectionPool.getStderr(connection)`
- Logged to daemon console for debugging
- Returned to client on connect/reconnect commands

## API Endpoints

### `/cli` - Execute CLI Commands
```
POST /cli
Content-Type: application/json

{
  "argv": ["servers"],
  "cwd": "/working/directory",
  "params": { /* optional YAML params */ }
}

Response:
{
  "success": true,
  "output": "...",
  "exitCode": 0
}
```

### `/exit` - Shutdown Daemon (Legacy)
```
POST /exit

Response:
{
  "success": true,
  "message": "Daemon shutting down..."
}
```

### Dashboard API Endpoints
- `GET /api/info` - Daemon info (PID, port, uptime)
- `GET /api/servers` - List configured servers
- `GET /api/connections` - List active connections
- `POST /api/servers/:name/start` - Start server connection
- `POST /api/servers/:name/stop` - Stop server connection

## Usage Examples

### Starting the Daemon

```bash
# Start daemon (background)
./bin/mcpu-daemon.mjs &

# Start on specific port
./bin/mcpu-daemon.mjs --port=8080 &

# Daemon logs startup info
# Daemon started on port 61824 (PID: 12345)
```

### Using Commands

```bash
# List servers
./bin/mcpu-remote.mjs -- servers

# List tools from a server
./bin/mcpu-remote.mjs -- tools playwright

# Call a tool
./bin/mcpu-remote.mjs -- call playwright browser_navigate --url=https://example.com

# Connect to a server manually
./bin/mcpu-remote.mjs -- connect chroma

# View active connections
./bin/mcpu-remote.mjs -- connections

# Disconnect from server
./bin/mcpu-remote.mjs -- disconnect chroma

# Stop daemon
./bin/mcpu-remote.mjs stop
```

### Targeting Specific Daemon

```bash
# Use specific port
./bin/mcpu-remote.mjs --port=8080 -- servers

# Use specific PID
./bin/mcpu-remote.mjs --pid=12345 -- servers
```

## Design Decisions

### 1. Why Forward Commands via `/cli`?

**Rationale:** All commands should use the same core execution logic whether run directly (`mcpu`) or through the daemon (`mcpu-remote`).

**Benefits:**
- Single source of truth for command implementation
- Consistent behavior and error handling
- Easy to add new commands (just update core executor)
- Connection pool is optional dependency

### 2. Why Only `stop` in mcpu-remote?

**Rationale:** `stop` is the only command that targets the **daemon process itself** rather than MCP operations.

**Benefits:**
- Clear separation: daemon control vs MCP operations
- All MCP commands use unified architecture
- Simpler mental model for users

### 3. Why Separate connect/disconnect Commands?

**Rationale:** Allows explicit control over connection lifecycle in daemon mode.

**Benefits:**
- Pre-connect to slow-starting servers
- Manually cleanup stale connections
- Debugging connection issues
- Resource management

### 4. Why Return stderr to Client?

**Rationale:** MCP servers often write important diagnostic info to stderr during startup.

**Benefits:**
- Users see server startup messages
- Easier debugging of connection issues
- Transparency about what's happening
- Consistent with standalone CLI behavior

## File Structure

```
packages/mcpu-cli/src/
├── daemon/
│   ├── server.ts           # HTTP server, endpoints
│   ├── connection-pool.ts  # Connection management
│   └── pid-manager.ts      # Daemon discovery
├── core/
│   ├── core.ts             # Command parsing (NixClap)
│   ├── executor.ts         # Command execution
│   └── context.ts          # Execution context
├── cli.ts                  # Standalone CLI entry
├── remote-cli.ts           # Remote CLI (only stop command)
├── daemon-cli.ts           # Daemon entry point
├── client.ts               # MCP client wrapper
└── config.ts               # Config discovery
```

## Comparison: Standalone vs Daemon

| Feature | Standalone (`mcpu`) | Daemon (`mcpu-remote --`) |
|---------|-------------------|------------------------|
| Server Connections | Ephemeral (per-command) | Persistent (pooled) |
| Startup Time | Slower (spawn process) | Faster (reuse connection) |
| Resource Usage | Higher (repeated spawns) | Lower (shared processes) |
| Connection Control | Automatic | Manual + automatic |
| stderr Visibility | Inline with command | Captured and returned |
| Use Case | One-off commands | Repeated tool calls |

## Performance Characteristics

### Connection Reuse
- First call to server: ~500-1000ms (process spawn + init)
- Subsequent calls: ~50-100ms (connection reuse)
- **10-20x speedup** for repeated tool calls

### Memory Usage
- Base daemon: ~50MB
- Per connection: ~20-50MB (depends on server)
- Auto-cleanup keeps memory bounded

### Connection TTL
- Default: 5 minutes of inactivity
- Configurable in ConnectionPool constructor
- Balances resource usage vs reconnection overhead

## Future Enhancements

### Planned Features
1. **Connection Health Checks** - Periodic ping to detect stale connections
2. **Configurable TTL** - Per-server connection timeout settings
3. **Connection Metrics** - Track usage stats, success rates
4. **Multi-Process Support** - Connection pool sharing across processes
5. **WebSocket Support** - Persistent connections for remote MCP servers

### Under Consideration
- **Connection Pooling Strategies** - Round-robin, least-used, etc.
- **Rate Limiting** - Per-server request throttling
- **Circuit Breakers** - Auto-disable failing servers
- **Connection Warming** - Pre-connect to frequently used servers

## Troubleshooting

### Daemon Not Found
```bash
# Check for running daemons
ps aux | grep mcpu-daemon

# List daemon files
ls $XDG_DATA_HOME/mcpu/

# Start new daemon
./bin/mcpu-daemon.mjs &
```

### Connection Issues
```bash
# View active connections
./bin/mcpu-remote.mjs -- connections

# Reconnect to server
./bin/mcpu-remote.mjs -- reconnect <server>

# Check daemon logs (stderr)
# Look for "[server] stderr during connection" messages
```

### Port Conflicts
```bash
# Daemon will auto-assign free port
# Or specify manually:
./bin/mcpu-daemon.mjs --port=8080 &

# Target specific port
./bin/mcpu-remote.mjs --port=8080 -- servers
```

## Security Considerations

### Local-Only Access
- Daemon binds to `localhost` only
- No external network exposure
- Safe for single-user development environments

### Process Isolation
- Each MCP server runs in separate process
- Server failures don't crash daemon
- Clean process cleanup on disconnect

### Future Security Features
- **Authentication** - Token-based auth for remote access
- **TLS Support** - Encrypted daemon communication
- **Access Control** - Per-server permission management

---

**Last Updated:** November 19, 2024
