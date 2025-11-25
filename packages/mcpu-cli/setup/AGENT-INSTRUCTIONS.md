## MCP Servers through MCPU Tools

### MCPU Daemon and `mcpu-remote` usage

**General Command formats**

- Start daemon (background): `mcpu-daemon -p=$PPID &` (use `run_in_background: true`)
- Send remote commands to daemon: `mcpu-remote -p=$PPID -- <args for mcpu>`

**mcpu-remote Commands and their flags and args:**

- ALWAYS START command with `mcpu-remote -p=$PPID`
- List mcp servers: `-- servers`
- List tools of mcp servers: `-- tools [servers...]`
- Get tool info in unwrapped text format: `-- info <server> <tools...>`
- Get complete raw schema (if unwrapped text isn't sufficient): `-- --yaml info <server> <tools...>`
- Call tool and receive unwrapped text response: `-- call <server> <tool>`, and use YAML input mode for params.
- Call tool and receive full MCP response as YAML: `-- --yaml call <server> <tool>`
- Shutdown the mcpu-daemon: `mcpu-remote -p=$PPID stop`, **NO `--`**

### YAML input mode (stdin/file)

- `mcpu-remote --stdin` accepts a YAML/JSON piped to its stdin.
- `mcpu-remote -b -c=<file>` accepts a YAML/JSON file,
  - `-b` renames the file with `.bak` suffix after reading it, replacing possible existing `.bak` file.

**WORKFLOW**

- One time step: `mkdir -p /tmp/.tmp-claude-$PPID && echo /tmp/.tmp-claude-$PPID`

1. Use Write tool to create `mcpu-cmd.yaml` in the dir from one time step
2. Run mcpu-remote with `-b -c=<file>` option

Example YAML:

```YAML
argv: [call, <server>, <tool>]
params:
  a: b
  a: b
```

### `mcpServerConfig`

- `call` command accepts `--restart` flag and a `mcpServerConfig` object:

```YAML
argv: [call, --restart, <server>, <tool>]
params:
  a: b
  a: b
mcpServerConfig:
  extraArgs: []
```

- A dedicate `config` command also available for setting `extraArgs`:

```YAML
argv: [config, <server>]
mcpServerConfig:
  extraArgs: []
```

**WORKFLOW - ALWAYS FOLLOW THIS SEQUENCE:**

1. **START DAEMON** (`run_in_background: true`) - skip if already running
2. **LIST SERVERS** - skip if known
3. **LIST TOOLS** - skip if known
4. **GET TOOL INFO** - skip if already retrieved or tool has no/simple params
5. **CALL TOOL** - using info from above

**Response formats:**

- Default: Unwrapped text content (user-friendly, matches Claude CLI behavior)
- `--json/--yaml/--raw`: Full MCP response structure with metadata

**When to use `--raw`, `--yaml`, or `--json` flags:**

- For `info`: Get complete tool schema including `inputSchema` and `annotations` (only if human-readable version insufficient)
- For `call`: Get full MCP response structure instead of just extracted text
- Useful for debugging, understanding complex parameters, or accessing response metadata
