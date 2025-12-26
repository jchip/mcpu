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
import { executeBatch, type BatchParams } from './batch.ts';
import { executeExec, type ExecParams } from '../commands/exec.ts';
import { ConfigDiscovery } from '../config.ts';
import type { CommandResult } from '../types/result.ts';
import type { ConnectionPool } from '../daemon/connection-pool.ts';
import { getErrorMessage } from '../utils/error.ts';

export interface CoreExecutionOptions {
  argv: string[];
  params?: any;
  batch?: Record<string, { argv: string[]; params?: Record<string, unknown> }>;  // For batch command
  cwd?: string;
  connectionPool?: ConnectionPool;
  configs?: Map<string, any>;  // Runtime config map from daemon
  configDiscovery?: ConfigDiscovery;  // Config discovery instance
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
        cache: {
          desc: 'Use cache (--no-cache to skip)',
        },
      },
      subCommands: {
        servers: {
          desc: 'List all configured MCP servers',
          args: '[pattern string]',
          options: {
            details: {
              desc: 'Show command, env, and other config details',
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
          options: {
            names: {
              desc: 'Show only tool names, no descriptions',
            },
            'full-desc': {
              desc: 'Show full multi-line descriptions (use --no-full-desc for first line only, default)',
            },
            'show-args': {
              desc: 'Show argument information',
            },
          },
        },
        info: {
          desc: 'Show detailed information about one or more tools',
          args: '<server string> [tools string..]',
        },
        usage: {
          desc: 'Show usage for a server (tools or info based on config)',
          args: '<server string> [tool string]',
        },
        call: {
          desc: 'Execute a tool with the given arguments',
          args: '<server string> <tool string> [args string..]',
          allowUnknownOption: true,
          options: {
            stdin: {
              desc: 'Read arguments from stdin as YAML',
            },
            restart: {
              desc: 'Restart server if extraArgs changed',
            },
            'conn-id': {
              desc: 'Use specific connection instance',
              args: '<id string>',
            },
          },
        },
        connect: {
          desc: 'Connect to an MCP server (daemon mode only)',
          args: '<server string> [connId string]',
          options: {
            new: {
              desc: 'Auto-assign a new connection ID',
            },
          },
        },
        disconnect: {
          desc: 'Disconnect from an MCP server (daemon mode only)',
          args: '<server string> [connId string]',
        },
        reconnect: {
          desc: 'Reconnect to an MCP server (daemon mode only)',
          args: '<server string> [connId string]',
        },
        connections: {
          alias: ['list-connections'],
          desc: 'List active server connections (daemon mode only)',
        },
        setConfig: {
          desc: 'Set MCP server runtime extraArgs',
          args: '<server string>',
        },
        reload: {
          desc: 'Reload config from disk (daemon/MCP mode)',
        },
        batch: {
          desc: 'Execute multiple tool calls in a single request',
        },
        exec: {
          desc: 'Execute code in isolated worker with mcpuMux access',
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
  const { argv, params, batch, cwd, connectionPool, configs, configDiscovery } = options;

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
      noCache: opts.cache === false ? true : undefined,
      cwd,
      connectionPool,
      configs,
      configDiscovery,
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
          pattern: args.pattern as string | undefined,
          tools: toolsMode,
          details: localOpts.details as boolean | undefined,
        }, globalOptions);
      }

      case 'tools': {
        // Get source of showArgs option to detect if user explicitly set --show-args from CLI
        const source = commandData.source || {};
        return await executeCommand('tools', {
          servers: args.servers as string[] | undefined,
          names: localOpts.names as boolean | undefined,
          fullDesc: localOpts.fullDesc as boolean | undefined,
          showArgs: localOpts.showArgs as boolean | undefined,
          showArgsSource: source.showArgs as string | undefined,
        }, globalOptions);
      }

      case 'info': {
        return await executeCommand('info', {
          server: args.server as string,
          tools: args.tools as string[],
        }, globalOptions);
      }

      case 'usage': {
        return await executeCommand('usage', {
          server: args.server as string,
          tool: args.tool as string | undefined,
        }, globalOptions);
      }

      case 'call': {
        // Collect all arguments
        const allArgs: string[] = (args.args as string[] | undefined) || [];

        // Add unknown options as --key=value arguments (exclude known options)
        for (const [key, value] of Object.entries(localOpts)) {
          if (key !== 'stdin' && key !== 'restart' && key !== 'connId' && value !== undefined) {
            allArgs.push(`--${key}=${value}`);
          }
        }

        return await executeCommand('call', {
          server: args.server as string,
          tool: args.tool as string,
          args: allArgs,
          stdinData: params ? JSON.stringify(params) : undefined,
          restart: localOpts.restart as boolean | undefined,
          connId: localOpts.connId as string | undefined,
        }, {
          ...globalOptions,
          stdin: localOpts.stdin as boolean | undefined,
        });
      }

      case 'connect': {
        return await executeCommand('connect', {
          server: args.server as string,
          connId: args.connId as string | undefined,
          newConn: localOpts.new as boolean | undefined,
        }, globalOptions);
      }

      case 'disconnect': {
        return await executeCommand('disconnect', {
          server: args.server as string,
          connId: args.connId as string | undefined,
        }, globalOptions);
      }

      case 'reconnect': {
        return await executeCommand('reconnect', {
          server: args.server as string,
          connId: args.connId as string | undefined,
        }, globalOptions);
      }

      case 'connections':
      case 'list-connections': {
        return await executeCommand('connections', {}, globalOptions);
      }

      case 'setConfig': {
        // params contains config: {extraArgs?:[], env?:{}, requestTimeout?:ms}
        return await executeCommand('setConfig', {
          server: args.server as string,
          setConfig: params,
        }, globalOptions);
      }

      case 'reload': {
        return await executeCommand('reload', {}, globalOptions);
      }

      case 'batch': {
        // Batch command: batch contains the call map, params contains options (timeout, resp_mode)
        if (!batch || Object.keys(batch).length === 0) {
          return {
            success: false,
            error: 'Batch command requires batch parameter',
            exitCode: 1,
          };
        }

        const batchParams: BatchParams = {
          calls: batch,
          response_mode: params?.resp_mode || params?.response_mode,
          timeout: params?.timeout,
        };

        return await executeBatch(batchParams, {
          argv: [],
          cwd,
          connectionPool,
          configs,
          configDiscovery,
        });
      }

      case 'exec': {
        // Check if exec is enabled
        if (configDiscovery && !configDiscovery.isExecEnabled()) {
          return {
            success: false,
            error: 'exec command is disabled via configuration (execEnabled: false)',
            exitCode: 1,
          };
        }

        // Exec command: params contains file, code, timeout
        const execParams: ExecParams = {
          file: params?.file as string | undefined,
          code: params?.code as string | undefined,
          timeout: params?.timeout as number | undefined,
        };

        return await executeExec(execParams, {
          argv: [],
          cwd,
          connectionPool,
          configs,
          configDiscovery,
        });
      }

      default:
        return {
          success: false,
          error: `Unknown command: ${commandName}`,
          exitCode: 1,
        };
    }
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
      exitCode: 1,
    };
  }
}
