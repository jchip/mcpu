#!/usr/bin/env node

import { NixClap, type ParseResult } from 'nix-clap';
import { parse as parseYaml } from 'yaml';
import { PidManager } from './daemon/pid-manager.ts';

const VERSION = '0.1.0';

export interface RemoteOptions {
  port?: number;
  pid?: number;
  stdin?: boolean;
}

/**
 * Find daemon port based on options
 */
async function findDaemonPort(options: RemoteOptions): Promise<number> {
  // Priority 1: Explicit port
  if (options.port) {
    return options.port;
  }

  const pidManager = new PidManager();

  // Priority 2: Specific PID
  if (options.pid) {
    const info = await pidManager.readDaemonInfo(options.pid);
    if (!info) {
      throw new Error(`No daemon found with PID ${options.pid}`);
    }

    // Verify process is still running
    if (!pidManager.isProcessRunning(options.pid)) {
      await pidManager.removeDaemonInfo(options.pid);
      throw new Error(`Daemon with PID ${options.pid} is not running`);
    }

    return info.port;
  }

  // Priority 3: Auto-discovery (most recent daemon)
  const latestDaemon = await pidManager.findLatestDaemon();
  if (!latestDaemon) {
    throw new Error('No running daemon found. Start one with: mcpu-daemon');
  }

  return latestDaemon.port;
}

/**
 * Send command to daemon via HTTP
 */
async function sendCommand(port: number, argv: string[], params?: any): Promise<void> {
  try {
    const url = `http://localhost:${port}/cli`;

    const body: any = {
      argv,
      cwd: process.cwd()
    };
    if (params) {
      body.params = params;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const result = await response.json() as any;

    if (result.success) {
      if (result.output) {
        console.log(result.output);
      }
      process.exit(result.exitCode || 0);
    } else {
      // Print output first (may contain help text)
      if (result.output) {
        console.error(result.output);
      }
      // Then print error if different from output
      if (result.error && result.error !== result.output) {
        console.error(result.error);
      }
      process.exit(result.exitCode || 1);
    }
  } catch (error: any) {
    console.error('Failed to connect to daemon:', error.message || error);
    console.error('\nIs the daemon running? Start it with: mcpu-daemon');
    process.exit(1);
  }
}

/**
 * Send control command to daemon
 */
async function sendControlCommand(port: number, action: string, server?: string): Promise<void> {
  try {
    const url = `http://localhost:${port}/control`;

    const body: any = { action };
    if (server) {
      body.server = server;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const result = await response.json() as any;

    if (result.success) {
      if (result.message) {
        console.log(result.message);
      }
      if (result.connections) {
        if (result.connections.length === 0) {
          console.log('No active connections');
        } else {
          console.log('\nActive connections:');
          for (const conn of result.connections) {
            const lastUsedDate = new Date(conn.lastUsed).toLocaleString();
            console.log(`  ${conn.server} (last used: ${lastUsedDate})`);
          }
        }
      }
      process.exit(0);
    } else {
      if (result.error) {
        console.error('Error:', result.error);
      }
      process.exit(1);
    }
  } catch (error: any) {
    console.error('Failed to connect to daemon:', error.message || error);
    console.error('\nIs the daemon running? Start it with: mcpu-daemon');
    process.exit(1);
  }
}

/**
 * Send shutdown command to daemon
 */
async function sendShutdown(port: number): Promise<void> {
  try {
    const url = `http://localhost:${port}/exit`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json() as any;

    if (result.success && result.message) {
      console.log(result.message);
    }
    process.exit(0);
  } catch (error: any) {
    // Connection errors are expected when daemon shuts down
    if (error.message?.includes('ECONNRESET') || error.message?.includes('socket hang up')) {
      console.log('Daemon shut down successfully');
      process.exit(0);
    }
    console.error('Failed to shutdown daemon:', error.message || error);
    process.exit(1);
  }
}

/**
 * Start a server
 */
async function startServer(port: number, serverName: string): Promise<void> {
  try {
    const url = `http://localhost:${port}/api/servers/${serverName}/start`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json() as any;

    if (result.success) {
      console.log(result.message || `Server "${serverName}" started`);
      process.exit(0);
    } else {
      console.error('Error:', result.message || result.error);
      process.exit(1);
    }
  } catch (error: any) {
    console.error('Failed to start server:', error.message || error);
    process.exit(1);
  }
}

const nc = new NixClap({ name: 'mcpu-remote' })
  .version(VERSION)
  .usage('$0 [--port=N | --pid=N] [--stdin] -- <command> [args...]')
  .init2({
    desc: 'Connect to MCPU daemon and execute commands',
    options: {
      port: {
        desc: 'Connect to daemon on specific port',
        args: '<port number>',
      },
      pid: {
        desc: 'Connect to daemon with specific PID',
        args: '<pid number>',
      },
      stdin: {
        desc: 'Read JSON or YAML { argv?: [...], params?: {...} } from stdin',
      },
    },
  });

nc.on('pre-help', () => {
  console.log();
  console.log('MCPU Remote - Connect to MCPU daemon for persistent connections');
  console.log();
});

nc.on('post-help', () => {
  console.log();
  console.log('MCP Commands (same as mcpu CLI):');
  console.log('  servers                     - List configured MCP servers');
  console.log('  tools [servers...]          - List available tools');
  console.log('  info <server> <tool>        - Show tool details (supports --raw --json/--yaml)');
  console.log('  call <server> <tool> [args] - Execute a tool');
  console.log();
  console.log('Daemon Control Commands:');
  console.log('  stop, shutdown              - Gracefully shutdown the daemon');
  console.log('  list-connections            - List active MCP server connections');
  console.log('  start <server>              - Start a configured MCP server connection');
  console.log('  disconnect <server>         - Disconnect from a specific server');
  console.log('  reconnect <server>          - Reconnect to a specific server');
  console.log();
  console.log('Connection Discovery (priority order):');
  console.log('  1. --port=<port>  - Connect to specific port');
  console.log('  2. --pid=<pid>    - Find port from daemon PID');
  console.log('  3. Auto-discovery - Find most recent daemon');
  console.log();
  console.log('Examples:');
  console.log();
  console.log('  # Auto-discovery (use most recent daemon)');
  console.log('  $ mcpu-remote -- tools');
  console.log('  $ mcpu-remote -- call playwright browser_navigate --url=https://example.com');
  console.log();
  console.log('  # Control commands');
  console.log('  $ mcpu-remote -- start playwright');
  console.log('  $ mcpu-remote -- stop');
  console.log('  $ mcpu-remote -- list-connections');
  console.log('  $ mcpu-remote -- disconnect playwright');
  console.log('  $ mcpu-remote -- reconnect playwright');
  console.log();
  console.log('  # Connect to specific port or PID');
  console.log('  $ mcpu-remote --port=7839 -- tools');
  console.log('  $ mcpu-remote --pid=12345 -- stop');
  console.log();
  console.log('  # Use stdin with YAML');
  console.log('  $ mcpu-remote --stdin <<EOF');
  console.log('  argv: [call, playwright, browser_navigate]');
  console.log('  params:');
  console.log('    url: https://example.com');
  console.log('  EOF');
  console.log();
  console.log('  # Use stdin with YAML (cleaner for complex structures)');
  console.log('  $ mcpu-remote --stdin <<EOF');
  console.log('  argv:');
  console.log('    - call');
  console.log('    - playwright');
  console.log('    - browser_navigate');
  console.log('  params:');
  console.log('    url: https://example.com');
  console.log('    snapshotFile: .temp/snapshot.yaml');
  console.log('  EOF');
  console.log();
  console.log('  # CLI args are prepended to stdin argv');
  console.log('  $ mcpu-remote --stdin -- call playwright <<EOF');
  console.log('  argv: [browser_navigate]');
  console.log('  params:');
  console.log('    url: https://example.com');
  console.log('  EOF');
  console.log();
});

/**
 * Read data from stdin
 */
async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
    process.stdin.on('error', reject);
  });
}

const parsed = nc.parse();

// Execute if we have parsed options
if (parsed && parsed.command) {
  const opts = parsed.command.jsonMeta.opts;

  const options: RemoteOptions = {
    port: opts.port ? parseInt(opts.port as string, 10) : undefined,
    pid: opts.pid ? parseInt(opts.pid as string, 10) : undefined,
    stdin: opts.stdin === true,
  };

  // Execute
  (async () => {
    try {
      let commandArgs: string[];
      let params: any = undefined;

      if (options.stdin) {
        // Read data from stdin and parse as YAML (which handles both JSON and YAML)
        const stdinData = await readStdin();
        try {
          // YAML parser handles both JSON and YAML formats
          const parsedData = parseYaml(stdinData);

          // Get argv from parsed data or CLI
          let argv: string[] = [];
          if (parsedData.argv && Array.isArray(parsedData.argv)) {
            argv = parsedData.argv;
          }

          // Prepend command-line args (after --) to parsed argv
          const cliArgs = (parsed._ && parsed._.length > 0) ? parsed._ : [];
          commandArgs = [...cliArgs, ...argv];

          // Get params from parsed data
          if (parsedData.params && typeof parsedData.params === 'object') {
            params = parsedData.params;
          }

          // Validate we have either args or params
          if (commandArgs.length === 0) {
            console.error('Error: No command provided');
            console.error('Provide either:');
            console.error('  - CLI args after --');
            console.error('  - YAML with "argv" array');
            console.error('Example: argv: [call, server, tool]');
            process.exit(1);
          }
        } catch (error: any) {
          console.error('Error: Failed to parse stdin (expected YAML or JSON)');
          console.error(error.message);
          process.exit(1);
        }
      } else {
        // Get args after -- from parsed._
        if (!parsed._ || parsed._.length === 0) {
          console.error('Error: No command provided after --');
          console.error('Usage: mcpu-remote [--port=N | --pid=N] -- <command> [args...]');
          console.error('   or: mcpu-remote --stdin <<EOF');
          console.error();
          console.error('Examples:');
          console.error('  mcpu-remote -- tools');
          console.error('  mcpu-remote --port=7839 -- call playwright browser_navigate --url=...');
          process.exit(1);
        }
        commandArgs = parsed._;
      }

      const port = await findDaemonPort(options);

      // Handle control commands
      const firstArg = commandArgs[0];
      if (firstArg === 'stop' || firstArg === 'shutdown') {
        await sendShutdown(port);
      } else if (firstArg === 'start') {
        if (commandArgs.length < 2) {
          console.error('Error: start requires a server name');
          console.error('Usage: mcpu-remote -- start <server>');
          process.exit(1);
        }
        await startServer(port, commandArgs[1]);
      } else if (firstArg === 'list-connections') {
        await sendControlCommand(port, 'list');
      } else if (firstArg === 'disconnect') {
        if (commandArgs.length < 2) {
          console.error('Error: disconnect requires a server name');
          console.error('Usage: mcpu-remote -- disconnect <server>');
          process.exit(1);
        }
        await sendControlCommand(port, 'disconnect', commandArgs[1]);
      } else if (firstArg === 'reconnect') {
        if (commandArgs.length < 2) {
          console.error('Error: reconnect requires a server name');
          console.error('Usage: mcpu-remote -- reconnect <server>');
          process.exit(1);
        }
        await sendControlCommand(port, 'reconnect', commandArgs[1]);
      } else {
        // Regular CLI command
        await sendCommand(port, commandArgs, params);
      }
    } catch (error: any) {
      console.error('Error:', error.message || error);
      process.exit(1);
    }
  })();
}
