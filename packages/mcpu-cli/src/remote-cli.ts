#!/usr/bin/env node

import { NixClap } from 'nix-clap';
import { parse as parseYaml } from 'yaml';
import { PidManager } from './daemon/pid-manager.ts';
import { VERSION } from './version.ts';

const output = (text: string) => console.log(text);

/**
 * Read YAML from stdin
 */
async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let resolved = false;

    // Check if stdin is a TTY (interactive terminal)
    if (process.stdin.isTTY) {
      reject(new Error('Cannot read from stdin: stdin is a TTY (use pipe or heredoc)'));
      return;
    }

    // Timeout after 5 seconds
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Timeout waiting for stdin input (5s)'));
      }
    }, 5000);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(data);
      }
    });
    process.stdin.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    // Resume stdin in case it's paused
    process.stdin.resume();
  });
}

/**
 * Find daemon port based on options
 */
async function findDaemonPort(port?: number, pid?: number, ppid?: number): Promise<number> {
  if (port) return port;

  const pidManager = new PidManager();

  if (pid) {
    const info = await pidManager.findDaemonByPid(pid);
    if (!info) {
      throw new Error(`No daemon found with PID ${pid}`);
    }
    if (!pidManager.isProcessRunning(pid)) {
      await pidManager.removeDaemonInfo(info.ppid, pid);
      throw new Error(`Daemon with PID ${pid} is not running`);
    }
    return info.port;
  }

  // If ppid specified, find daemon with that ppid
  if (ppid !== undefined && ppid > 0) {
    const daemon = await pidManager.findDaemonByPpid(ppid);
    if (!daemon) {
      throw new Error(`No daemon found for PPID ${ppid}. Start one with: mcpu-daemon --ppid=${ppid}`);
    }
    return daemon.port;
  }

  // No ppid specified: prefer singleton (ppid=0), fallback to latest session daemon (ppid>0)
  const allDaemons = await pidManager.findAllDaemons();

  // Try singletons first
  const singletons = allDaemons.filter(d => d.ppid === 0);
  if (singletons.length > 0) {
    singletons.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    return singletons[0].port;
  }

  // Fall back to latest session daemon (ppid > 0)
  if (allDaemons.length > 0) {
    allDaemons.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    return allDaemons[0].port;
  }

  throw new Error('No running daemon found. Start one with: mcpu-daemon');
}

/**
 * Send command to daemon via HTTP
 */
async function sendCommand(port: number, argv: string[], params?: any): Promise<void> {
  const url = `http://localhost:${port}/cli`;
  const body: any = { argv, cwd: process.cwd() };

  if (params !== undefined) {
    body.params = params;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await response.json() as any;

  if (result.success) {
    if (result.output) console.log(result.output);
    process.exit(result.exitCode || 0);
  } else {
    if (result.output) console.error(result.output);
    if (result.error && result.error !== result.output) {
      console.error(result.error);
    }
    process.exit(result.exitCode || 1);
  }
}

/**
 * Shutdown daemon(s)
 */
async function shutdownDaemons(limit?: number, port?: number, pid?: number, ppid?: number): Promise<void> {
  const pidManager = new PidManager();

  if (limit === 1) {
    const targetPort = await findDaemonPort(port, pid, ppid);
    const allDaemons = await pidManager.findAllDaemons();
    const targetDaemon = allDaemons.find(d => d.port === targetPort);

    if (!targetDaemon) {
      output('No daemon found at the discovered port');
      process.exit(1);
    }

    output(`Shutting down daemon PID ${targetDaemon.pid} (port ${targetDaemon.port})...`);

    try {
      await fetch(`http://localhost:${targetDaemon.port}/exit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error: any) {
      if (!error.message?.includes('ECONNRESET') && !error.message?.includes('socket hang up')) {
        output(`Failed to shutdown daemon: ${error.message}`);
        process.exit(1);
      }
    }

    output('Daemon shut down successfully');
    process.exit(0);
  }

  // Shutdown all daemons
  const daemons = await pidManager.findAllDaemons();

  if (daemons.length === 0) {
    output('No running daemons found');
    process.exit(0);
  }

  if (daemons.length > 1) {
    output(`Found ${daemons.length} running daemons`);
  }

  let successCount = 0;
  let failCount = 0;

  for (const daemon of daemons) {
    output(`Shutting down daemon PID ${daemon.pid} (port ${daemon.port})...`);
    try {
      await fetch(`http://localhost:${daemon.port}/exit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      successCount++;
      output(`  ✓ Daemon PID ${daemon.pid} shut down`);
    } catch (error: any) {
      if (error.message?.includes('ECONNRESET') || error.message?.includes('socket hang up')) {
        successCount++;
        output(`  ✓ Daemon PID ${daemon.pid} shut down`);
      } else {
        failCount++;
        output(`  ✗ Failed to shutdown daemon PID ${daemon.pid}: ${error.message}`);
      }
    }
  }

  if (daemons.length > 1) {
    output('');
    output(`Shut down ${successCount} of ${daemons.length} daemons`);
  }

  if (failCount > 0) {
    output(`${failCount} daemon(s) failed to shut down`);
    process.exit(1);
  }

  process.exit(0);
}

const nc = new NixClap({
  name: 'mcpu-remote',
  handlers: {
    'no-action': false,  // Allow no action - we'll forward to daemon
  }
})
  .version(VERSION)
  .usage('$0 [--port=N | --pid=N | --ppid=N] [--stdin] [command] [-- args...]')
  .init2({
    desc: 'Connect to MCPU daemon and execute commands',
    options: {
      port: { desc: 'Connect to daemon on specific port', args: '<port number>' },
      pid: { desc: 'Connect to daemon with specific PID', args: '<pid number>' },
      ppid: { desc: 'Connect to daemon for specific parent PID', args: '<ppid number>' },
      stdin: { desc: 'Read parameters from stdin as YAML' },
    },
    subCommands: {
      stop: {
        alias: ['shutdown'],
        desc: 'Stop daemon(s)',
        options: {
          all: { desc: 'Stop all running daemons' },
        },
        exec: async (cmd: any) => {
          const rootOpts = cmd.rootCmd?.jsonMeta.opts || {};
          const cmdOpts = cmd.jsonMeta.opts;

          const ppid = rootOpts.ppid ? parseInt(rootOpts.ppid as string, 10) : undefined;

          if (cmdOpts.all) {
            await shutdownDaemons(undefined, rootOpts.port, rootOpts.pid, ppid);
          } else {
            await shutdownDaemons(1, rootOpts.port, rootOpts.pid, ppid);
          }
        },
      },
      cleanup: {
        desc: 'Remove stale daemon PID files',
        exec: async () => {
          const pidManager = new PidManager();
          const allDaemons = await pidManager.findAllDaemons();

          if (allDaemons.length === 0) {
            output('No daemon PID files found');
            process.exit(0);
          }

          let removed = 0;
          let alive = 0;

          for (const daemon of allDaemons) {
            try {
              const response = await fetch(`http://localhost:${daemon.port}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(1000),
              });

              if (response.ok) {
                alive++;
                output(`✓ Daemon PID ${daemon.pid} on port ${daemon.port} is running`);
              }
            } catch (error) {
              removed++;
              output(`✗ Removing stale PID file for daemon ${daemon.pid} (port ${daemon.port})`);
              await pidManager.removeDaemonInfo(daemon.ppid, daemon.pid);
            }
          }

          output('');
          output(`Summary: ${alive} running, ${removed} stale PID files removed`);
          process.exit(0);
        },
      },
    },
  });

(async () => {
  const parsed = await nc.parseAsync();

  // If a subcommand was executed, we're done
  if (parsed.execCmd) {
    process.exit(0);
  }

  // If there are remaining args after --, or --stdin is set, forward to daemon
  const opts = parsed.command.jsonMeta.opts;
  if ((parsed._ && parsed._.length > 0) || opts.stdin) {
    try {
      const ppid = opts.ppid ? parseInt(opts.ppid as string, 10) : undefined;
      const port = await findDaemonPort(opts.port, opts.pid, ppid);

      // Handle --stdin flag
      let params: any = undefined;
      let argv = parsed._ || [];

      if (opts.stdin) {
        const yamlInput = await readStdin();

        if (!yamlInput || yamlInput.trim() === '') {
          console.error('Error: --stdin specified but no input received');
          process.exit(1);
        }

        try {
          const yamlData = parseYaml(yamlInput);

          if (!yamlData) {
            console.error('Error: Empty YAML input');
            process.exit(1);
          }

          // Extract argv from YAML if present
          if (yamlData.argv) {
            // Prepend CLI args to YAML argv
            argv = [...(parsed._ || []), ...yamlData.argv];
          }

          // Extract params from YAML
          if (yamlData.params !== undefined) {
            params = yamlData.params;
          } else if (!yamlData.argv) {
            // If no params key and no argv key, treat entire YAML as params
            params = yamlData;
          }
        } catch (error: any) {
          console.error('Error: Failed to parse YAML from stdin:', error.message);
          process.exit(1);
        }
      }

      await sendCommand(port, argv, params);
    } catch (error: any) {
      console.error('Error:', error.message || error);
      process.exit(1);
    }
  }
})();
