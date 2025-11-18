#!/usr/bin/env node

import { NixClap, type ParseResult } from 'nix-clap';
import { PidManager } from './daemon/pid-manager.ts';
import { request } from 'undici';

const VERSION = '0.1.0';

export interface RemoteOptions {
  port?: number;
  pid?: number;
  json?: boolean;
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

    const response = await request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const result = await response.body.json() as any;

    if (result.success) {
      if (result.output) {
        console.log(result.output);
      }
      process.exit(result.exitCode || 0);
    } else {
      if (result.error) {
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

const nc = new NixClap({ name: 'mcpu-remote' })
  .version(VERSION)
  .usage('$0 [--port=N | --pid=N] [--json] -- <command> [args...]')
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
      json: {
        desc: 'Read JSON { argv?: [...], params?: {...} } from stdin',
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
  console.log('  # Connect to specific port');
  console.log('  $ mcpu-remote --port=7839 -- tools');
  console.log();
  console.log('  # Connect to specific PID');
  console.log('  $ mcpu-remote --pid=12345 -- tools');
  console.log();
  console.log('  # Use JSON with argv (command arguments)');
  console.log('  $ mcpu-remote --json <<EOF');
  console.log('  { "argv": ["call", "playwright", "browser_navigate", "--url=https://example.com"] }');
  console.log('  EOF');
  console.log();
  console.log('  # Use JSON with params (MCP tool parameters)');
  console.log('  $ mcpu-remote --json -- call playwright browser_navigate <<EOF');
  console.log('  { "params": { "url": "https://example.com" } }');
  console.log('  EOF');
  console.log();
  console.log('  # Use JSON with both argv and params');
  console.log('  $ mcpu-remote --json <<EOF');
  console.log('  {');
  console.log('    "argv": ["call", "playwright", "browser_type"],');
  console.log('    "params": { "element": "...", "text": "..." }');
  console.log('  }');
  console.log('  EOF');
  console.log();
  console.log('  # CLI args are prepended to JSON argv');
  console.log('  $ mcpu-remote --json -- call playwright <<EOF');
  console.log('  { "argv": ["browser_navigate"], "params": { "url": "https://example.com" } }');
  console.log('  EOF');
  console.log();
});

/**
 * Read JSON from stdin
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
    json: opts.json === true,
  };

  // Execute
  (async () => {
    try {
      let commandArgs: string[];
      let params: any = undefined;

      if (options.json) {
        // Read JSON from stdin
        const stdinData = await readStdin();
        try {
          const jsonData = JSON.parse(stdinData);

          // Get argv from JSON or CLI
          let argv: string[] = [];
          if (jsonData.argv && Array.isArray(jsonData.argv)) {
            argv = jsonData.argv;
          }

          // Prepend command-line args (after --) to JSON argv
          const cliArgs = (parsed._ && parsed._.length > 0) ? parsed._ : [];
          commandArgs = [...cliArgs, ...argv];

          // Get params from JSON
          if (jsonData.params && typeof jsonData.params === 'object') {
            params = jsonData.params;
          }

          // Validate we have either args or params
          if (commandArgs.length === 0) {
            console.error('Error: No command provided');
            console.error('Provide either:');
            console.error('  - CLI args after --');
            console.error('  - JSON with "argv" array');
            console.error('Example: { "argv": ["call", "server", "tool"] }');
            process.exit(1);
          }
        } catch (error: any) {
          console.error('Error: Failed to parse JSON from stdin');
          console.error(error.message);
          process.exit(1);
        }
      } else {
        // Get args after -- from parsed._
        if (!parsed._ || parsed._.length === 0) {
          console.error('Error: No command provided after --');
          console.error('Usage: mcpu-remote [--port=N | --pid=N] -- <command> [args...]');
          console.error('   or: mcpu-remote --json <<EOF');
          console.error();
          console.error('Examples:');
          console.error('  mcpu-remote -- tools');
          console.error('  mcpu-remote --port=7839 -- call playwright browser_navigate --url=...');
          process.exit(1);
        }
        commandArgs = parsed._;
      }

      const port = await findDaemonPort(options);
      await sendCommand(port, commandArgs, params);
    } catch (error: any) {
      console.error('Error:', error.message || error);
      process.exit(1);
    }
  })();
}
