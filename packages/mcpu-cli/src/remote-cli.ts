#!/usr/bin/env node

import { NixClap } from 'nix-clap';
import { PidManager } from './daemon/pid-manager.ts';
import { VERSION } from './version.ts';

const output = (text: string) => console.log(text);

/**
 * Find daemon port based on options
 */
async function findDaemonPort(port?: number, pid?: number): Promise<number> {
  if (port) return port;

  const pidManager = new PidManager();

  if (pid) {
    const info = await pidManager.readDaemonInfo(pid);
    if (!info) {
      throw new Error(`No daemon found with PID ${pid}`);
    }
    if (!pidManager.isProcessRunning(pid)) {
      await pidManager.removeDaemonInfo(pid);
      throw new Error(`Daemon with PID ${pid} is not running`);
    }
    return info.port;
  }

  const latestDaemon = await pidManager.findLatestDaemon();
  if (!latestDaemon) {
    throw new Error('No running daemon found. Start one with: mcpu-daemon');
  }

  return latestDaemon.port;
}

/**
 * Send command to daemon via HTTP
 */
async function sendCommand(port: number, argv: string[]): Promise<void> {
  const url = `http://localhost:${port}/cli`;
  const body = { argv, cwd: process.cwd() };

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
async function shutdownDaemons(limit?: number, port?: number, pid?: number): Promise<void> {
  const pidManager = new PidManager();

  if (limit === 1) {
    const targetPort = await findDaemonPort(port, pid);
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
  .usage('$0 [--port=N | --pid=N] [command] [-- args...]')
  .init2({
    desc: 'Connect to MCPU daemon and execute commands',
    options: {
      port: { desc: 'Connect to daemon on specific port', args: '<port number>' },
      pid: { desc: 'Connect to daemon with specific PID', args: '<pid number>' },
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

          if (cmdOpts.all) {
            await shutdownDaemons(undefined, rootOpts.port, rootOpts.pid);
          } else {
            await shutdownDaemons(1, rootOpts.port, rootOpts.pid);
          }
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

  // If there are remaining args after --, forward to daemon
  if (parsed._ && parsed._.length > 0) {
    try {
      const opts = parsed.command.jsonMeta.opts;
      const port = await findDaemonPort(opts.port, opts.pid);
      await sendCommand(port, parsed._);
    } catch (error: any) {
      console.error('Error:', error.message || error);
      process.exit(1);
    }
  }
})();
