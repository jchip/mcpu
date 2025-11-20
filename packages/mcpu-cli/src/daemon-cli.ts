#!/usr/bin/env node

import { NixClap } from 'nix-clap';
import { daemonCommand } from './commands/daemon.ts';
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
    },
    exec: (cmd) => {
      const opts = cmd.jsonMeta.opts;
      const port = opts.port ? parseInt(opts.port as string, 10) : undefined;

      daemonCommand({
        port,
        config: opts.config as string | undefined,
        verbose: opts.verbose as boolean | undefined,
      });
    },
  })
  .on('pre-help', () => {
    console.log();
    console.log('MCPU Daemon - Persistent MCP server connections');
    console.log();
  })
  .on('post-help', () => {
    console.log();
    console.log('Examples:');
    console.log();
    console.log('  # Start daemon with OS-assigned port');
    console.log('  $ mcpu-daemon');
    console.log();
    console.log('  # Start daemon on specific port');
    console.log('  $ mcpu-daemon --port=7839');
    console.log();
    console.log('  # Run in background');
    console.log('  $ mcpu-daemon &');
    console.log();
  })
  .parse();
