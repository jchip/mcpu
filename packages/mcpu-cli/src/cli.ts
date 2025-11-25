#!/usr/bin/env node

import { NixClap } from 'nix-clap';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { coreExecute } from './core/core.ts';
import { VERSION } from './version.ts';
import { addServer, addServerJson, parseEnvFlags, parseHeaderFlags, type Scope } from './commands/mcp-add.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create CLI with nix-clap
const nc = new NixClap({
  name: 'mcpu',
  handlers: {
    'no-action': () => {
      nc.showHelp(null);
      process.exit(0);
    },
  },
})
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
        options: {
          names: {
            desc: 'Show only tool names, no descriptions',
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
      'add-json': {
        desc: 'Add an MCP server with a JSON config string',
        args: '<name string> <json string>',
        options: {
          scope: {
            alias: 's',
            desc: 'Config scope: local (default), project, or user',
            args: '<scope string>',
          },
        },
        exec: async (cmd: any) => {
          const opts = cmd.jsonMeta.opts;
          const args = cmd.jsonMeta.args;

          const name = args.name;
          const json = args.json;
          const scope = (opts.scope || 'local') as Scope;

          const result = await addServerJson(name, json, scope);

          console.log(result.message);
          process.exit(result.success ? 0 : 1);
        },
      },
      add: {
        desc: 'Add a new MCP server (alias for "mcp add")',
        args: '<name string> [url-or-command string]',
        allowUnknownOption: true,
        options: {
          transport: {
            alias: 't',
            desc: 'Transport type: stdio, http, or sse',
            args: '<type string>',
          },
          scope: {
            alias: 's',
            desc: 'Config scope: local (default), project, or user',
            args: '<scope string>',
          },
          env: {
            alias: 'e',
            desc: 'Environment variable (KEY=VALUE), can be repeated',
            args: '<env string>',
          },
          header: {
            desc: 'HTTP header (KEY=VALUE), can be repeated',
            args: '<header string>',
          },
        },
        exec: async (cmd: any) => {
          const opts = cmd.jsonMeta.opts;
          const args = cmd.jsonMeta.args;

          // Get args after -- from process.argv
          const ddIndex = process.argv.indexOf('--');
          const restArgs = ddIndex !== -1 ? process.argv.slice(ddIndex + 1) : [];

          const name = args.name;
          const transport = (opts.transport || 'stdio') as 'stdio' | 'http' | 'sse';
          const scope = (opts.scope || 'local') as Scope;

          // Parse env flags (can be string or array)
          const envFlags = Array.isArray(opts.env) ? opts.env : (opts.env ? [opts.env] : []);
          const env = parseEnvFlags(envFlags);

          // Parse header flags (can be string or array)
          const headerFlags = Array.isArray(opts.header) ? opts.header : (opts.header ? [opts.header] : []);
          const headers = parseHeaderFlags(headerFlags);

          // For http/sse, the second positional arg is the URL
          // For stdio, remaining args after -- form the command
          let url: string | undefined;
          let command: string[] | undefined;

          if (transport === 'http' || transport === 'sse') {
            url = args['url-or-command'];
          } else {
            // Stdio: command is everything after --
            if (restArgs.length > 0) {
              command = restArgs;
            } else if (args['url-or-command']) {
              // Allow single command without --
              command = [args['url-or-command']];
            }
          }

          const result = await addServer({
            name,
            transport,
            scope,
            url,
            command,
            env,
            headers,
          });

          console.log(result.message);
          process.exit(result.success ? 0 : 1);
        },
      },
      mcp: {
        desc: 'MCP server management commands',
        subCommands: {
          'add-json': {
            desc: 'Add an MCP server with a JSON config string',
            args: '<name string> <json string>',
            options: {
              scope: {
                alias: 's',
                desc: 'Config scope: local (default), project, or user',
                args: '<scope string>',
              },
            },
            exec: async (cmd: any) => {
              const opts = cmd.jsonMeta.opts;
              const args = cmd.jsonMeta.args;

              const name = args.name;
              const json = args.json;
              const scope = (opts.scope || 'local') as Scope;

              const result = await addServerJson(name, json, scope);

              console.log(result.message);
              process.exit(result.success ? 0 : 1);
            },
          },
          add: {
            desc: 'Add a new MCP server',
            args: '<name string> [url-or-command string]',
            allowUnknownOption: true,
            options: {
              transport: {
                alias: 't',
                desc: 'Transport type: stdio, http, or sse',
                args: '<type string>',
              },
              scope: {
                alias: 's',
                desc: 'Config scope: local (default), project, or user',
                args: '<scope string>',
              },
              env: {
                alias: 'e',
                desc: 'Environment variable (KEY=VALUE), can be repeated',
                args: '<env string>',
              },
              header: {
                desc: 'HTTP header (KEY=VALUE), can be repeated',
                args: '<header string>',
              },
            },
            exec: async (cmd: any) => {
              const opts = cmd.jsonMeta.opts;
              const args = cmd.jsonMeta.args;

              // Get args after -- from process.argv
              const ddIndex = process.argv.indexOf('--');
              const restArgs = ddIndex !== -1 ? process.argv.slice(ddIndex + 1) : [];

              const name = args.name;
              const transport = (opts.transport || 'stdio') as 'stdio' | 'http' | 'sse';
              const scope = (opts.scope || 'local') as Scope;

              // Parse env flags (can be string or array)
              const envFlags = Array.isArray(opts.env) ? opts.env : (opts.env ? [opts.env] : []);
              const env = parseEnvFlags(envFlags);

              // Parse header flags (can be string or array)
              const headerFlags = Array.isArray(opts.header) ? opts.header : (opts.header ? [opts.header] : []);
              const headers = parseHeaderFlags(headerFlags);

              // For http/sse, the second positional arg is the URL
              // For stdio, remaining args after -- form the command
              let url: string | undefined;
              let command: string[] | undefined;

              if (transport === 'http' || transport === 'sse') {
                url = args['url-or-command'];
              } else {
                // Stdio: command is everything after --
                if (restArgs.length > 0) {
                  command = restArgs;
                } else if (args['url-or-command']) {
                  // Allow single command without --
                  command = [args['url-or-command']];
                }
              }

              const result = await addServer({
                name,
                transport,
                scope,
                url,
                command,
                env,
                headers,
              });

              console.log(result.message);
              process.exit(result.success ? 0 : 1);
            },
          },
        },
      },
      setup: {
        desc: 'Print setup instructions for AI agents',
        exec: async () => {
          // Read AGENT-INSTRUCTIONS.md from the setup directory
          const setupDir = join(__dirname, '..', 'setup');
          const agentInstructionsPath = join(setupDir, 'AGENT-INSTRUCTIONS.md');

          let agentInstructions: string;
          try {
            agentInstructions = readFileSync(agentInstructionsPath, 'utf-8');
          } catch (err) {
            console.error(`Error: Could not read ${agentInstructionsPath}`);
            process.exit(1);
          }

          console.log(`Please complete the following tasks:
1. Please add the MCPU Instructions to the agent file user specified, in an appropriate location. Integrate it naturally into any existing structure.
If user didn't specify an agent file, then use AGENTS.md.

--- BEGIN MCPU Instructions CONTENT ---
${agentInstructions}
--- END MCPU Instructions CONTENT ---

2. Update CLAUDE.md (if present, and not the file used in step 1)
See AGENTS.md for details about using MCPU to talk to MCP servers.
`);
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
