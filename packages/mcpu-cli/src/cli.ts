#!/usr/bin/env node

import { NixClap } from 'nix-clap';
import chalk from 'chalk';
import { coreExecute } from './core/core.ts';

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
      yaml: {
        desc: 'Output in YAML format',
      },
      raw: {
        desc: 'Output raw/unprocessed schema (for info command)',
      },
      noCache: {
        desc: 'Skip cache, force fresh discovery',
      },
    },
    subCommands: {
      servers: {
        desc: 'List all configured MCP servers',
        options: {
          detailed: {
            desc: 'Show detailed multi-line format',
          },
          tools: {
            desc: 'List tool names',
          },
          'tools-desc': {
            desc: 'List tools with descriptions',
          },
        },
        exec: async () => {
          const result = await coreExecute({ argv: process.argv.slice(2) });
          if (result.output) {
            console.log(result.output);
          }
          if (!result.success && result.error) {
            console.error(result.error);
          }
          process.exit(result.exitCode || 0);
        },
      },
      tools: {
        desc: 'List tools from all servers or specific servers',
        args: '[servers string..]',
        exec: async () => {
          const result = await coreExecute({ argv: process.argv.slice(2) });
          if (result.output) {
            console.log(result.output);
          }
          if (!result.success && result.error) {
            console.error(result.error);
          }
          process.exit(result.exitCode || 0);
        },
      },
      info: {
        desc: 'Show detailed information about one or more tools',
        args: '<server string> <tools string..>',
        exec: async () => {
          const result = await coreExecute({ argv: process.argv.slice(2) });
          if (result.output) {
            console.log(result.output);
          }
          if (!result.success && result.error) {
            console.error(result.error);
          }
          process.exit(result.exitCode || 0);
        },
      },
      call: {
        desc: 'Execute a tool with the given arguments',
        args: '<server string> <tool string> [args string..]',
        allowUnknownOption: true,
        options: {
          stdin: {
            desc: 'Read arguments from stdin as YAML',
          },
        },
        exec: async () => {
          const result = await coreExecute({ argv: process.argv.slice(2) });
          if (result.output) {
            console.log(result.output);
          }
          if (!result.success && result.error) {
            console.error(result.error);
          }
          process.exit(result.exitCode || 0);
        },
      },
    },
  });

// Custom help message
nc.on('pre-help', () => {
  console.log();
  console.log(chalk.bold('MCPU - Universal MCP gateway for any AI agent'));
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
  console.log('  # Call a tool with YAML from stdin');
  console.log('  $ mcpu call filesystem read_file --stdin <<< \'path: /etc/hosts\'');
  console.log();
  console.log(chalk.bold('Config Sources (priority order):'));
  console.log('  1. --config flag');
  console.log('  2. .config/mcpu/config.local.json (local project config)');
  console.log('  3. $XDG_CONFIG_HOME/mcpu/config.json or ~/.config/mcpu/config.json');
  console.log();
});

// Parse and execute
await nc.parseAsync();
