#!/usr/bin/env node

import { NixClap } from 'nix-clap';
import { daemonCommand } from './commands/daemon.ts';
import { PidManager } from './daemon/pid-manager.ts';
import { VERSION } from './version.ts';

new NixClap({ name: 'mcpu-daemon' })
  .version(VERSION)
  .usage('$0 [options]')
  .init2({
    desc: 'Start MCPU daemon for persistent MCP server connections',
    options: {
      port: {
        desc: 'Port to listen on (default: OS assigned)',
        args: '<port number>',
      },
      config: {
        desc: 'Use specific config file',
        args: '<file string>',
      },
      verbose: {
        desc: 'Show detailed logging',
      },
      ppid: {
        desc: 'Parent process ID (0 for shared singleton)',
        args: '<ppid number>',
      },
      new: {
        desc: 'Force new instance (for ppid=0 only)',
      },
      'auto-disconnect': {
        desc: 'Enable automatic disconnection of idle MCP connections',
      },
      'idle-timeout': {
        desc: 'Idle timeout in minutes before disconnecting (default: 5)',
        args: '<minutes number>',
      },
    },
    exec: async (cmd) => {
      const opts = cmd.jsonMeta.opts;
      const port = opts.port ? parseInt(opts.port as string, 10) : undefined;
      const ppid = opts.ppid ? parseInt(opts.ppid as string, 10) : 0;
      const forceNew = opts.new as boolean | undefined;
      const autoDisconnect = opts['auto-disconnect'] as boolean | undefined;
      const idleTimeoutMinutes = opts['idle-timeout'] ? parseInt(opts['idle-timeout'] as string, 10) : undefined;
      const idleTimeoutMs = idleTimeoutMinutes ? idleTimeoutMinutes * 60 * 1000 : undefined;

      const pidManager = new PidManager();

      // If ppid > 0, check for existing instance with this ppid
      if (ppid > 0) {
        const existing = await pidManager.findDaemonByPpid(ppid);
        if (existing) {
          console.log(`Daemon for PPID ${ppid} already running on port ${existing.port} (PID: ${existing.pid})`);
          process.exit(0);
        }
        // No existing daemon for this ppid, start new one
      } else {
        // ppid === 0 (singleton mode)
        if (!forceNew) {
          // Check all ppid=0 instances
          const allDaemons = await pidManager.findAllDaemons();
          const singletons = allDaemons.filter(d => d.ppid === 0);

          for (const daemon of singletons) {
            // Ping to check if alive
            try {
              const response = await fetch(`http://localhost:${daemon.port}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(1000),
              });

              if (response.ok) {
                // Found alive singleton
                console.log(`Daemon already running on port ${daemon.port} (PID: ${daemon.pid})`);
                process.exit(0);
              }
            } catch (error) {
              // Not alive, remove stale file
              if (opts.verbose) {
                console.log(`Removing stale PID file for daemon ${daemon.pid}`);
              }
              await pidManager.removeDaemonInfo(daemon.ppid, daemon.pid);
            }
          }
        }
        // No alive singleton found (or --new), start new one
      }

      // Start new daemon
      daemonCommand({
        port,
        config: opts.config as string | undefined,
        verbose: opts.verbose as boolean | undefined,
        ppid,
        autoDisconnect,
        idleTimeoutMs,
      });
    },
  })
  .parse();
