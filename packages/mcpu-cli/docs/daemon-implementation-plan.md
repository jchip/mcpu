# MCPU HTTP Daemon Implementation Plan

## Overview

Add HTTP daemon to maintain persistent MCP server connections across CLI calls.

## Architecture

- HTTP daemon server using Express 5.1.0
- `mcpu-daemon` starts the server
- `mcpu-remote` sends commands to daemon
- Regular `mcpu` continues to work standalone
- Shared command parsing/execution code

## Implementation Phases

### Phase 1: Refactor for Code Reuse

**1.1 Extract Command Execution Logic**

- Create `src/core/executor.ts`
  - Move command execution logic from CLI commands
  - Export `executeCommand(argv: string[]): Promise<Result>`
  - Handle all commands: servers, tools, info, call
- Create `src/core/parser.ts`
  - Extract nix-clap parsing setup
  - Export `parseArgs(argv: string[]): ParsedCommand`
- Update existing commands to use new core modules

**1.2 Create Result Types**

- Define `src/types/result.ts`
  ```typescript
  interface CommandResult {
    success: boolean;
    output?: string;
    error?: string;
    exitCode: number;
  }
  ```

### Phase 2: Implement HTTP Daemon

**2.1 Create Daemon Server (`src/daemon/server.ts`)**

- Express server setup
- Connection pool management
- Endpoints implementation
- PID/port file management

**2.2 Daemon Endpoints:**

**`POST /cli`** - Execute any mcpu command

```json
// Request:
{
  "args": ["tools", "playwright", "--json"],
  "outputFile": "/tmp/output.txt" // optional
}
// Response:
{
  "success": true,
  "output": "...",
  "exitCode": 0
}
```

**`POST /exit`** - Graceful shutdown

- Close all MCP connections
- Remove PID file
- Exit process

**`POST /control`** - Manage connections

```json
// Request:
{
  "action": "list" | "disconnect" | "reconnect" | "refresh-config",
  "server": "playwright" // optional
}
```

**2.3 Create Daemon CLI (`src/commands/daemon.ts`)**

```bash
mcpu-daemon [--port=7839]
```

- Start HTTP server
- If no port specified, let OS assign (port 0)
- Log: "Daemon started on port XXXXX (PID: YYYY)"
- Write `$XDG_DATA_HOME/mcpu/daemon.<pid>.json`:
  ```json
  {
    "pid": 12345,
    "port": 7839,
    "startTime": "2024-11-16T10:00:00Z"
  }
  ```

### Phase 3: Implement Remote CLI

**3.1 Create `mcpu-remote` (`src/remote-cli.ts`)**

**Connection Discovery (in priority order):**

1. **`--port=<port>`** - Connect directly to specified port

   ```bash
   mcpu-remote --port=7839 -- tools playwright
   ```

2. **`--pid=<pid>`** - Find port from specific daemon PID

   ```bash
   mcpu-remote --pid=12345 -- tools playwright
   ```

   - Look for `$XDG_DATA_HOME/mcpu/daemon.12345.json`
   - Read port from file
   - Verify process is still running

3. **Auto-discovery** - Find any running daemon
   ```bash
   mcpu-remote -- tools playwright
   ```
   - Scan `$XDG_DATA_HOME/mcpu/daemon.*.json`
   - Check if PIDs are still running
   - Clean up stale files
   - Use most recently started daemon

**3.2 Discovery Implementation:**

```typescript
async function findDaemonPort(options: RemoteOptions): Promise<number> {
  if (options.port) return options.port;

  if (options.pid) {
    // Read from specific PID file
    // Verify process exists
    // Return port
  }

  // Auto-discovery
  // Scan all daemon.*.json files
  // Filter to running processes
  // Return most recent
}
```

### Phase 4: Connection Persistence

**4.1 Connection Pool (`src/daemon/connection-pool.ts`)**

```typescript
class ConnectionPool {
  private connections: Map<string, MCPConnection>;
  private lastUsed: Map<string, number>;

  async getConnection(server: string, config: any): MCPConnection;
  async disconnect(server: string): void;
  async disconnectAll(): void;
  private cleanupStale(): void; // 5-minute TTL
}
```

**4.2 Auto-connect in /cli endpoint:**

- Check if connection exists for requested server
- If not, create and cache
- Execute command with persistent connection
- Update last-used timestamp

## File Structure

```
src/
├── core/
│   ├── executor.ts      # Shared command execution
│   └── parser.ts        # Shared argument parsing
├── daemon/
│   ├── server.ts        # Express HTTP server
│   ├── connection-pool.ts # MCP connection management
│   └── pid-manager.ts   # PID file handling
├── commands/
│   └── daemon.ts        # mcpu-daemon CLI
├── remote-cli.ts        # mcpu-remote entry point
└── cli.ts              # Original mcpu (unchanged)
```

## Package.json Updates

```json
"bin": {
  "mcpu": "./bin/mcpu",
  "mcpu-daemon": "./bin/mcpu-daemon",
  "mcpu-remote": "./bin/mcpu-remote"
}
```

Add dependency:

```bash
fyn add express@^5.1.0
```

## Usage Examples

**Start daemon:**

```bash
# Start on default port (OS assigned)
$ mcpu-daemon
Daemon started on port 54321 (PID: 12345)

# Start on specific port
$ mcpu-daemon --port=7839
Daemon started on port 7839 (PID: 12345)

# Run in background
$ mcpu-daemon &
```

**Use with remote:**

```bash
# Auto-discovery (most common)
$ mcpu-remote -- tools playwright
$ mcpu-remote -- call playwright browser_navigate --url=https://example.com
$ mcpu-remote -- call playwright browser_screenshot  # Same browser session!

# Specific port
$ mcpu-remote --port=7839 -- tools

# Specific PID
$ mcpu-remote --pid=12345 -- tools
```

**Regular mcpu still works:**

```bash
$ mcpu tools  # Works without daemon
```
