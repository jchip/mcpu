/**
 * Core execution logic - shared between direct CLI and daemon
 *
 * Architecture:
 * - Parse argv with nix-clap to get structured command/args/options
 * - Execute command using executor
 * - Return result (for daemon to send back or CLI to print/exit)
 */

import { NixClap } from 'nix-clap';
import { executeCommand } from './executor.ts';
import type { CommandResult } from '../types/result.ts';
import type { ConnectionPool } from '../daemon/connection-pool.ts';

export interface CoreExecutionOptions {
  argv: string[];
  params?: any;
  cwd?: string;
  connectionPool?: ConnectionPool;
}

/**
 * Create NixClap CLI instance for parsing with custom output/exit handlers
 */
function createParserCLI() {
  const VERSION = '0.1.0';

  // Capture output and exit information
  let capturedOutput = '';
  let exitCode: number | null = null;

  const nc = new NixClap({
    name: 'mcpu',
    skipExec: true,
    // Custom output handler - captures instead of writing to stdout
    output: (text: string) => {
      capturedOutput += text;
    },
    // Custom exit handler - captures code without exiting process
    exit: (code: number) => {
      exitCode = code;
      // Don't call process.exit() here!
    },
    // Keep default handlers enabled so help/version work
    noDefaultHandlers: false,
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
          desc: 'Output raw/unprocessed schema data',
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
        },
        tools: {
          desc: 'List tools from all servers or specific servers',
          args: '[servers string..]',
        },
        info: {
          desc: 'Show detailed information about one or more tools',
          args: '<server string> <tools string..>',
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
        },
        connect: {
          desc: 'Connect to an MCP server (daemon mode only)',
          args: '<server string>',
        },
        disconnect: {
          desc: 'Disconnect from an MCP server (daemon mode only)',
          args: '<server string>',
        },
        reconnect: {
          desc: 'Reconnect to an MCP server (daemon mode only)',
          args: '<server string>',
        },
        connections: {
          alias: ['list-connections'],
          desc: 'List active server connections (daemon mode only)',
        },
      },
    });

  return {
    nc,
    getOutput: () => capturedOutput,
    getExitCode: () => exitCode,
  };
}

/**
 * Core execution - parse and execute command
 */
export async function coreExecute(options: CoreExecutionOptions): Promise<CommandResult> {
  const { argv, params, cwd, connectionPool } = options;

  try {
    // Parse command line with custom output/exit handlers
    const { nc, getOutput, getExitCode } = createParserCLI();
    const parsed = nc.parse(argv, 0);

    // Check if help/version was triggered (via custom exit handler)
    const exitCode = getExitCode();
    if (exitCode !== null) {
      // Help or version was shown
      return {
        success: exitCode === 0,
        output: getOutput(),
        exitCode,
      };
    }

    // Check for parse errors
    if (parsed.errorNodes && parsed.errorNodes.length > 0) {
      const errors = parsed.errorNodes.map(n => n.error.message).join(', ');
      return {
        success: false,
        error: `Parse error: ${errors}`,
        output: getOutput(),
        exitCode: 1,
      };
    }

    // Get command name from argv - first non-option argument
    let commandName: string | null = null;
    for (const arg of argv) {
      if (!arg.startsWith('-')) {
        commandName = arg;
        break;
      }
    }

    if (!commandName) {
      return {
        success: false,
        error: 'No command specified',
        output: getOutput(),
        exitCode: 1,
      };
    }

    // Extract global options from root command
    const opts = parsed.command.jsonMeta.opts;
    const globalOptions = {
      json: opts.json as boolean | undefined,
      yaml: opts.yaml as boolean | undefined,
      raw: opts.raw as boolean | undefined,
      config: opts.config as string | undefined,
      verbose: opts.verbose as boolean | undefined,
      noCache: opts.noCache as boolean | undefined,
      cwd,
      connectionPool,
    };

    // Get the sub-command data from parsed result
    const subCommands = parsed.command.jsonMeta.subCommands;
    const commandData = subCommands?.[commandName];
    if (!commandData) {
      return {
        success: false,
        error: `Unknown command: ${commandName}`,
        exitCode: 1,
      };
    }

    // Extract command options and args
    const localOpts = commandData.opts || {};
    const args = commandData.args || {};

    // Execute based on command
    switch (commandName) {
      case 'servers': {

        // Determine tools mode
        let toolsMode: 'names' | 'desc' | undefined;
        if (localOpts['tools-desc']) {
          toolsMode = 'desc';
        } else if (localOpts.tools) {
          toolsMode = 'names';
        }

        return await executeCommand('servers', {
          tools: toolsMode,
          detailed: localOpts.detailed as boolean | undefined,
        }, globalOptions);
      }

      case 'tools': {
        return await executeCommand('tools', {
          servers: args.servers as string[] | undefined,
        }, globalOptions);
      }

      case 'info': {
        return await executeCommand('info', {
          server: args.server as string,
          tools: args.tools as string[],
        }, globalOptions);
      }

      case 'call': {
        // Collect all arguments
        const allArgs: string[] = (args.args as string[] | undefined) || [];

        // Add unknown options as --key=value arguments
        for (const [key, value] of Object.entries(localOpts)) {
          if (key !== 'stdin' && value !== undefined) {
            allArgs.push(`--${key}=${value}`);
          }
        }

        return await executeCommand('call', {
          server: args.server as string,
          tool: args.tool as string,
          args: allArgs,
          stdinData: params ? JSON.stringify(params) : undefined,
        }, {
          ...globalOptions,
          stdin: localOpts.stdin as boolean | undefined,
        });
      }

      case 'connect': {
        return await executeCommand('connect', {
          server: args.server as string,
        }, globalOptions);
      }

      case 'disconnect': {
        return await executeCommand('disconnect', {
          server: args.server as string,
        }, globalOptions);
      }

      case 'reconnect': {
        return await executeCommand('reconnect', {
          server: args.server as string,
        }, globalOptions);
      }

      case 'connections':
      case 'list-connections': {
        return await executeCommand('connections', {}, globalOptions);
      }

      default:
        return {
          success: false,
          error: `Unknown command: ${commandName}`,
          exitCode: 1,
        };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || String(error),
      exitCode: 1,
    };
  }
}
