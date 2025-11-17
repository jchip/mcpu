#!/usr/bin/env node

import { NixClap } from 'nix-clap';
import chalk from 'chalk';
import { serversCommand } from './commands/servers.js';
import { listCommand } from './commands/list.js';
import { showCommand } from './commands/info.js';
import { callCommand } from './commands/call.js';

const VERSION = '0.1.0';

// Create CLI with nix-clap
const nc = new NixClap({ name: 'mcpu' })
  .version(VERSION)
  .usage('$0 [options] <command>')
  .init2({
    options: {
      config: {
        desc: 'Use specific config file',
        args: '<file string>',
      },
      verbose: {
        desc: 'Show detailed logging',
      },
      json: {
        desc: 'Output in JSON format',
      },
      noCache: {
        desc: 'Skip cache, force fresh discovery',
      },
    },
    subCommands: {
      servers: {
        desc: 'List all configured MCP servers',
        options: {
          tools: {
            desc: 'List tool names',
          },
          'tools-desc': {
            desc: 'List tools with descriptions',
          },
        },
        exec: (cmd) => {
          const opts = cmd.rootCmd.jsonMeta.opts;
          const localOpts = cmd.jsonMeta.opts;

          // Determine tools mode based on flags
          let toolsMode: 'names' | 'desc' | undefined;
          if (localOpts['tools-desc']) {
            toolsMode = 'desc';
          } else if (localOpts.tools) {
            toolsMode = 'names';
          }

          serversCommand({
            json: opts.json as boolean | undefined,
            config: opts.config as string | undefined,
            verbose: opts.verbose as boolean | undefined,
            tools: toolsMode,
          });
        },
      },
      tools: {
        desc: 'List tools from all servers or specific servers',
        args: '[servers string..]',
        exec: (cmd) => {
          const opts = cmd.rootCmd.jsonMeta.opts;
          const args = cmd.jsonMeta.args;
          listCommand({
            servers: args.servers as string[] | undefined,
            json: opts.json as boolean | undefined,
            config: opts.config as string | undefined,
            verbose: opts.verbose as boolean | undefined,
            noCache: opts.noCache as boolean | undefined,
          });
        },
      },
      info: {
        desc: 'Show detailed information about one or more tools',
        args: '<server string> <tools string..>',
        exec: (cmd) => {
          const opts = cmd.rootCmd.jsonMeta.opts;
          const args = cmd.jsonMeta.args;
          showCommand(args.server as string, args.tools as string[], {
            json: opts.json as boolean | undefined,
            config: opts.config as string | undefined,
            verbose: opts.verbose as boolean | undefined,
            noCache: opts.noCache as boolean | undefined,
          });
        },
      },
      call: {
        desc: 'Execute a tool with the given arguments',
        args: '<server string> <tool string> [args string..]',
        allowUnknownOption: true,
        options: {
          stdin: {
            desc: 'Read arguments from stdin as JSON',
          },
        },
        exec: (cmd) => {
          const opts = cmd.rootCmd.jsonMeta.opts;
          const localOpts = cmd.jsonMeta.opts;
          const args = cmd.jsonMeta.args;

          // Collect all arguments including those from args and unknown options
          const allArgs: string[] = (args.args as string[] | undefined) || [];

          // Add unknown options as --key=value arguments
          for (const [key, value] of Object.entries(localOpts)) {
            if (key !== 'stdin' && value !== undefined) {
              allArgs.push(`--${key}=${value}`);
            }
          }

          callCommand(args.server as string, args.tool as string, allArgs, {
            json: opts.json as boolean | undefined,
            config: opts.config as string | undefined,
            verbose: opts.verbose as boolean | undefined,
            stdin: localOpts.stdin as boolean | undefined,
          });
        },
      },
    },
  });

// Custom help message
nc.on('pre-help', () => {
  console.log();
  console.log(chalk.bold('MCPU - Unify MCP servers and reduce schema size'));
  console.log();
});

nc.on('post-help', () => {
  console.log();
  console.log(chalk.bold('Examples:'));
  console.log();
  console.log('  # List all configured servers');
  console.log('  $ mcpu servers');
  console.log();
  console.log('  # List all tools from all servers');
  console.log('  $ mcpu tools');
  console.log();
  console.log('  # List tools from specific servers');
  console.log('  $ mcpu tools filesystem');
  console.log('  $ mcpu tools filesystem database');
  console.log();
  console.log('  # Show details about specific tools');
  console.log('  $ mcpu info filesystem read_file');
  console.log('  $ mcpu info filesystem read_file write_file');
  console.log();
  console.log('  # Call a tool with arguments');
  console.log('  $ mcpu call filesystem read_file --path=/etc/hosts');
  console.log();
  console.log('  # Call a tool with JSON from stdin');
  console.log('  $ echo \'{"path": "/etc/hosts"}\' | mcpu call filesystem read_file --stdin');
  console.log();
  console.log(chalk.bold('Config Sources (priority order):'));
  console.log('  1. --config flag');
  console.log('  2. .config/mcpu/config.local.json (local project config)');
  console.log('  3. $XDG_CONFIG_HOME/mcpu/config.json or ~/.config/mcpu/config.json');
  console.log();
});

// Parse and execute
nc.parse();
