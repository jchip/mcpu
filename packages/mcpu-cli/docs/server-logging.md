# Server Operation Logging

Each MCPU instance logs MCP server operations for debugging and monitoring.

## Log Location

Each MCPU instance (daemon or mcpu-mcp server) writes to its own log file:

- **Daemon**: `~/.local/share/mcpu/logs/daemon-${PPID}-${PID}.log`
- **MCP Server**: `~/.local/share/mcpu/logs/mcpu-mcp-${PPID}-${PID}.log`
- Respects `$XDG_DATA_HOME` if set
- **Format**: JSON Lines (one JSON object per line)

Where:
- `${PPID}` = Parent process ID (the AI client that spawned MCPU)
- `${PID}` = MCPU process ID

This ensures each MCPU instance has its own log file, preventing race conditions and making it easy to identify which AI client (Claude, Gemini, Cursor, etc.) spawned which servers.

## Events Logged

### Server Spawn

Logged when an MCP server process is started:

```json
{
  "timestamp": "2025-12-15T01:01:23.976Z",
  "event": "server_spawn",
  "server": "chroma",
  "command": "uvx",
  "args": ["chroma-mcp", "--client-type", "persistent"],
  "env": {"API_KEY": "***REDACTED***"},
  "connectionId": "chroma[1]",
  "success": true
}
```

### Server Disconnect

Logged when an MCP server connection is closed:

```json
{
  "timestamp": "2025-12-15T01:05:30.123Z",
  "event": "server_disconnect",
  "server": "chroma",
  "connectionId": "chroma[1]"
}
```

### Server Error

Logged when server connection fails:

```json
{
  "timestamp": "2025-12-15T01:03:09.259Z",
  "event": "server_error",
  "server": "test",
  "error": "Connection closed",
  "connectionId": "test",
  "success": false
}
```

## Environment Variable Sanitization

Sensitive environment variables are automatically redacted:

**Sensitive patterns** (case-insensitive):
- `PASSWORD`
- `SECRET`
- `TOKEN`
- `KEY`
- `API_KEY`
- `APIKEY`
- `AUTH`
- `CREDENTIALS`

Example:
```json
{
  "env": {
    "NORMAL_VAR": "visible",
    "API_KEY": "***REDACTED***",
    "GITHUB_TOKEN": "***REDACTED***"
  }
}
```

## Viewing Logs

### List all log files
```bash
ls -lh ~/.local/share/mcpu/logs/
```

### View a specific instance's logs
```bash
# For daemon instance
cat ~/.local/share/mcpu/logs/daemon-12345-67890.log | jq .

# For mcpu-mcp instance
cat ~/.local/share/mcpu/logs/mcpu-mcp-12345-67890.log | jq .
```

### Tail recent events
```bash
tail -f ~/.local/share/mcpu/logs/mcpu-mcp-*.log
```

### Filter by event type
```bash
grep '"event":"server_spawn"' ~/.local/share/mcpu/logs/*.log | jq .
```

### Filter by server
```bash
grep '"server":"chroma"' ~/.local/share/mcpu/logs/*.log | jq .
```

### Find logs for a specific AI client
```bash
# If you know the AI client's process ID (e.g., 12345)
cat ~/.local/share/mcpu/logs/*-12345-*.log | jq .
```

## Use Cases

- **Debug connection issues**: Correlate errors with spawns
- **Track server usage**: See which MCP servers are being used
- **Identify AI client**: Determine which AI client (Claude, Gemini, Cursor) spawned servers via PPID

**Note**: Logs are stored locally only. Sensitive values are automatically redacted.
