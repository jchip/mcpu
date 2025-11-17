import { ConfigDiscovery } from '../config.ts';
import { MCPClient, type MCPConnection } from '../client.ts';
import { SchemaCache } from '../cache.ts';
import type { CommandResult } from '../types/result.ts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ConnectionPool } from '../daemon/connection-pool.ts';

/**
 * Core command executor - shared logic for CLI and daemon
 */

export interface ExecuteOptions {
  json?: boolean;
  config?: string;
  verbose?: boolean;
  noCache?: boolean;
  stdin?: boolean;
  connectionPool?: ConnectionPool;  // Optional connection pool for persistent connections
}

export interface ServersCommandArgs {
  tools?: 'names' | 'desc';
}

export interface ToolsCommandArgs {
  servers?: string[];
}

export interface InfoCommandArgs {
  server: string;
  tools: string[];
}

export interface CallCommandArgs {
  server: string;
  tool: string;
  args: string[];
  stdinData?: string;
}

/**
 * Helper to get MCP connection - uses pool if available, otherwise creates ephemeral
 */
async function getConnection(
  serverName: string,
  config: any,
  client: MCPClient,
  pool?: ConnectionPool
): Promise<{ connection: MCPConnection; isPersistent: boolean }> {
  if (pool) {
    const connection = await pool.getConnection(serverName, config);
    return { connection, isPersistent: true };
  } else {
    const connection = await client.connect(serverName, config);
    return { connection, isPersistent: false };
  }
}

/**
 * Execute the 'servers' command
 */
export async function executeServersCommand(
  args: ServersCommandArgs,
  options: ExecuteOptions
): Promise<CommandResult> {
  try {
    const discovery = new ConfigDiscovery({
      configFile: options.config,
      verbose: options.verbose,
    });

    const configs = await discovery.loadConfigs();
    const client = new MCPClient();

    // Fetch server info for each server
    const serverInfos = new Map<string, { description?: string; toolCount?: number; tools?: Array<{ name: string; description?: string }> }>();

    for (const [name, config] of configs.entries()) {
      try {
        const info = await client.withConnection(name, config, async (conn) => {
          const tools = await client.listTools(conn);
          const serverInfo = (conn.client as any)._serverVersion;
          const description = serverInfo?.name ?
            `${serverInfo.name}${serverInfo.version ? ` v${serverInfo.version}` : ''}` :
            undefined;
          return {
            description,
            toolCount: tools.length,
            tools: args.tools ? tools.map(t => ({ name: t.name, description: t.description })) : undefined
          };
        });
        serverInfos.set(name, info);
      } catch (error) {
        serverInfos.set(name, {});
      }
    }

    if (options.json) {
      const servers = Array.from(configs.entries()).map(([name, config]) => ({
        name,
        ...config,
      }));

      const output = JSON.stringify({
        servers,
        total: servers.length,
      }, null, 2);

      return {
        success: true,
        output,
        exitCode: 0,
      };
    } else {
      let output = '';

      if (configs.size === 0) {
        output += 'No MCP servers configured.\n\n';
        output += 'Configure servers in one of these locations:\n';
        output += '  - .mcpu.local.json (local project config, gitignored)\n';
        output += '  - ~/.claude/settings.json (Claude user settings)\n';
        output += '  - ~/.mcpu/config.json (MCPU user config)\n';
      } else {
        output += 'Configured MCP Servers:\n\n';

        for (const [name, config] of configs.entries()) {
          const info = serverInfos.get(name);

          output += `${name}\n`;

          if (info?.description) {
            output += `  ${info.description}\n`;
          }

          if (info?.toolCount !== undefined) {
            output += `  ${info.toolCount} tool${info.toolCount === 1 ? '' : 's'}\n`;
          }

          if ('url' in config) {
            output += `  Type: http\n`;
            output += `  URL: ${config.url}\n`;
          } else {
            output += `  Command: ${config.command}\n`;
            if (config.args && config.args.length > 0) {
              output += `  Args: ${config.args.join(' ')}\n`;
            }
          }

          if (args.tools && info?.tools) {
            output += '\n  Tools:\n';
            for (const tool of info.tools) {
              if (args.tools === 'names') {
                output += `    ${tool.name}\n`;
              } else if (args.tools === 'desc') {
                output += `    ${tool.name} - ${tool.description || 'No description'}\n`;
              }
            }
          }

          output += '\n';
        }

        output += `Total: ${configs.size} server${configs.size === 1 ? '' : 's'}\n`;
      }

      return {
        success: true,
        output,
        exitCode: 0,
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

/**
 * Execute the 'tools' command
 */
export async function executeToolsCommand(
  args: ToolsCommandArgs,
  options: ExecuteOptions
): Promise<CommandResult> {
  try {
    const discovery = new ConfigDiscovery({
      configFile: options.config,
      verbose: options.verbose,
    });

    const configs = await discovery.loadConfigs();
    const client = new MCPClient();
    const cache = new SchemaCache();

    if (configs.size === 0) {
      return {
        success: false,
        error: 'No MCP servers configured. Run `mcpu servers` for configuration help.',
        exitCode: 1,
      };
    }

    // Determine which servers to query
    let serversToQuery = configs;
    if (args.servers && args.servers.length > 0) {
      serversToQuery = new Map();
      for (const serverName of args.servers) {
        const config = configs.get(serverName);
        if (!config) {
          return {
            success: false,
            error: `Server "${serverName}" not found. Available servers: ${Array.from(configs.keys()).join(', ')}`,
            exitCode: 1,
          };
        }
        serversToQuery.set(serverName, config);
      }
    }

    // Collect tools from servers
    const allTools: Array<{ server: string; tool: Tool }> = [];

    for (const [serverName, config] of serversToQuery.entries()) {
      try {
        let tools: Tool[] | null = null;
        if (!options.noCache) {
          tools = await cache.get(serverName);
        }

        if (!tools) {
          tools = await client.withConnection(serverName, config, async (conn) => {
            return await client.listTools(conn);
          });
          await cache.set(serverName, tools);
        }

        for (const tool of tools) {
          allTools.push({ server: serverName, tool });
        }
      } catch (error) {
        // Skip failed connections silently unless verbose
      }
    }

    if (options.json) {
      const output = JSON.stringify({
        tools: allTools.map(({ server, tool }) => ({
          server,
          name: tool.name,
          description: tool.description,
        })),
        total: allTools.length,
        servers: serversToQuery.size,
      }, null, 2);

      return {
        success: true,
        output,
        exitCode: 0,
      };
    } else {
      let output = 'All Available Tools:\n\n';

      if (allTools.length === 0) {
        output += 'No tools available\n';
      } else {
        const toolsByServer = new Map<string, Tool[]>();
        for (const { server, tool } of allTools) {
          if (!toolsByServer.has(server)) {
            toolsByServer.set(server, []);
          }
          toolsByServer.get(server)!.push(tool);
        }

        for (const [server, tools] of toolsByServer.entries()) {
          output += `MCP server ${server}:\n`;
          for (const tool of tools) {
            output += `  ${tool.name} - ${tool.description || 'No description'}\n`;
          }
          output += '\n';
        }
      }

      output += `\nTotal: ${allTools.length} tools across ${serversToQuery.size} servers\n`;

      return {
        success: true,
        output,
        exitCode: 0,
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

/**
 * Execute the 'info' command
 */
export async function executeInfoCommand(
  args: InfoCommandArgs,
  options: ExecuteOptions
): Promise<CommandResult> {
  try {
    const discovery = new ConfigDiscovery({
      configFile: options.config,
      verbose: options.verbose,
    });

    const configs = await discovery.loadConfigs();
    const config = configs.get(args.server);

    if (!config) {
      return {
        success: false,
        error: `Server "${args.server}" not found. Available servers: ${Array.from(configs.keys()).join(', ')}`,
        exitCode: 1,
      };
    }

    const client = new MCPClient();
    const cache = new SchemaCache();

    let availableTools: Tool[] | null = null;
    if (!options.noCache) {
      availableTools = await cache.get(args.server);
    }

    if (!availableTools) {
      availableTools = await client.withConnection(args.server, config, async (conn) => {
        return await client.listTools(conn);
      });
      await cache.set(args.server, availableTools);
    }

    const results = [];
    for (const toolName of args.tools) {
      const tool = availableTools.find(t => t.name === toolName);
      if (!tool) {
        return {
          success: false,
          error: `Tool "${toolName}" not found on server "${args.server}". Available tools: ${availableTools.map(t => t.name).join(', ')}`,
          exitCode: 1,
        };
      }

      if (options.json) {
        const schema = tool.inputSchema as any;
        const properties = schema?.properties || {};
        const required = schema?.required || [];

        const argsInfo = Object.entries(properties).map(([name, prop]: [string, any]) => ({
          name,
          type: prop.type || 'any',
          required: required.includes(name),
          description: prop.description,
          default: prop.default,
          enum: prop.enum,
        }));

        results.push({
          server: args.server,
          tool: toolName,
          description: tool.description,
          arguments: argsInfo,
        });
      } else {
        let output = `\n${toolName}\n\n`;

        if (tool.description) {
          output += `${tool.description}\n\n`;
        }

        const schema = tool.inputSchema as any;
        if (schema && schema.properties) {
          const properties = schema.properties;
          const required = schema?.required || [];

          output += 'Arguments:\n';

          if (Object.keys(properties).length === 0) {
            output += '  (no arguments)\n';
          } else {
            for (const [name, prop] of Object.entries(properties)) {
              const propSchema = prop as any;
              const requiredMark = required.includes(name) ? '' : '?';
              let typeStr = propSchema.type || 'any';

              if (propSchema.enum) {
                typeStr = propSchema.enum.join('|');
              }

              if (propSchema.type === 'array' && propSchema.items) {
                typeStr = `${propSchema.items.type || 'any'}[]`;
              }

              const desc = propSchema.description ? ` - ${propSchema.description}` : '';
              const defaultVal = propSchema.default !== undefined ? ` (default: ${JSON.stringify(propSchema.default)})` : '';

              output += `  ${name}${requiredMark}  ${typeStr}${desc}${defaultVal}\n`;
            }
          }
          output += '\n';
        }

        output += 'Example:\n';
        output += `  mcpu call ${args.server} ${toolName}\n\n`;

        results.push(output);
      }
    }

    if (options.json) {
      return {
        success: true,
        output: JSON.stringify(results.length === 1 ? results[0] : results, null, 2),
        exitCode: 0,
      };
    } else {
      return {
        success: true,
        output: results.join(''),
        exitCode: 0,
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

/**
 * Parse CLI arguments into tool parameters
 */
function parseArgs(args: string[], schema?: any): Record<string, any> {
  const result: Record<string, any> = {};
  const properties = schema?.properties || {};

  for (const arg of args) {
    if (!arg.startsWith('--')) continue;

    const match = arg.match(/^--([^=:]+)(?::([^=]+))?=(.+)$/);
    if (!match) continue;

    const [, key, explicitType, value] = match;
    const propSchema = properties[key];

    let type = explicitType;
    if (!type && propSchema) {
      type = propSchema.type;
    }

    let convertedValue: any = value;

    if (type === 'number' || type === 'integer') {
      convertedValue = Number(value);
      if (isNaN(convertedValue)) {
        throw new Error(`Invalid number value for ${key}: ${value}`);
      }
    } else if (type === 'boolean') {
      convertedValue = value === 'true' || value === 'yes' || value === '1';
    } else if (type === 'array' || type === 'object') {
      // Try to parse as JSON first for arrays/objects
      try {
        convertedValue = JSON.parse(value);
      } catch {
        // If JSON parse fails and it's an array, fall back to comma-separated
        if (type === 'array') {
          convertedValue = value.split(',').map(v => v.trim());
        } else {
          convertedValue = value;
        }
      }
    } else {
      convertedValue = value;
    }

    result[key] = convertedValue;
  }

  return result;
}

/**
 * Execute the 'call' command
 */
export async function executeCallCommand(
  args: CallCommandArgs,
  options: ExecuteOptions
): Promise<CommandResult> {
  try {
    const discovery = new ConfigDiscovery({
      configFile: options.config,
      verbose: options.verbose,
    });

    const configs = await discovery.loadConfigs();
    const config = configs.get(args.server);

    if (!config) {
      return {
        success: false,
        error: `Server "${args.server}" not found. Available servers: ${Array.from(configs.keys()).join(', ')}`,
        exitCode: 1,
      };
    }

    const client = new MCPClient();
    const cache = new SchemaCache();

    let tools: Tool[] | null = await cache.get(args.server);

    if (!tools) {
      tools = await client.withConnection(args.server, config, async (conn) => {
        return await client.listTools(conn);
      });
      await cache.set(args.server, tools);
    }

    const tool = tools.find(t => t.name === args.tool);
    if (!tool) {
      return {
        success: false,
        error: `Tool "${args.tool}" not found on server "${args.server}".`,
        exitCode: 1,
      };
    }

    // Parse arguments
    let toolArgs: Record<string, any> = {};

    if (args.stdinData || options.stdin) {
      // Read JSON from stdin data or stdin
      const jsonStr = args.stdinData || '';
      try {
        toolArgs = JSON.parse(jsonStr);
      } catch (error) {
        return {
          success: false,
          error: 'Failed to parse JSON from stdin',
          exitCode: 1,
        };
      }
    } else {
      toolArgs = parseArgs(args.args, tool.inputSchema);
    }

    // Execute the tool - use persistent connection if pool is available
    const { connection, isPersistent } = await getConnection(args.server, config, client, options.connectionPool);

    try {
      const result = await client.callTool(connection, args.tool, toolArgs);

      // Format output
      let output: string;
      if (options.json) {
        output = JSON.stringify({ result }, null, 2);
      } else {
        if (typeof result === 'string') {
          output = result;
        } else if (typeof result === 'object') {
          output = JSON.stringify(result, null, 2);
        } else {
          output = String(result);
        }
      }

      return {
        success: true,
        output,
        exitCode: 0,
      };
    } finally {
      // Only disconnect if not using persistent connection
      if (!isPersistent) {
        await client.disconnect(connection);
      }
    }
  } catch (error: any) {
    return {
      success: false,
      error: `Tool execution failed: ${error.message || String(error)}`,
      exitCode: 1,
    };
  }
}

/**
 * Main executor - route commands to appropriate handlers
 */
export async function executeCommand(
  command: string,
  args: any,
  options: ExecuteOptions
): Promise<CommandResult> {
  switch (command) {
    case 'servers':
      return executeServersCommand(args, options);
    case 'tools':
      return executeToolsCommand(args, options);
    case 'info':
      return executeInfoCommand(args, options);
    case 'call':
      return executeCallCommand(args, options);
    default:
      return {
        success: false,
        error: `Unknown command: ${command}`,
        exitCode: 1,
      };
  }
}
