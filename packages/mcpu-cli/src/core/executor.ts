import { stringify as stringifyYaml } from 'yaml';
import { ConfigDiscovery } from '../config.ts';
import { MCPClient, type MCPConnection } from '../client.ts';
import { SchemaCache } from '../cache.ts';
import type { CommandResult } from '../types/result.ts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ConnectionPool } from '../daemon/connection-pool.ts';
import { ExecutionContext } from './context.ts';

/**
 * Core command executor - shared logic for CLI and daemon
 */

/**
 * Unwrap MCP response according to the MCP spec
 * https://spec.modelcontextprotocol.io/
 *
 * Handles standard MCP response format:
 * {
 *   content: Array<{type, text?, data?, mimeType?, uri?, ...}>,
 *   isError?: boolean
 * }
 */
function unwrapMcpResponse(response: unknown): string {
  // Handle non-object responses
  if (typeof response === 'string') {
    return response;
  }

  if (typeof response !== 'object' || response === null) {
    return String(response);
  }

  const mcpResponse = response as any;

  // Check for error responses
  if (mcpResponse.isError === true) {
    const errorText = mcpResponse.content?.[0]?.text || 'Unknown error';
    throw new Error(errorText);
  }

  // Handle standard MCP response with content array
  if ('content' in mcpResponse && Array.isArray(mcpResponse.content)) {
    const content = mcpResponse.content;
    const parts: string[] = [];

    for (const item of content) {
      if (item.type === 'text' && item.text) {
        parts.push(item.text);
      } else if (item.type === 'image') {
        // For images, show metadata (actual image data would be base64)
        parts.push(`[Image: ${item.mimeType || 'unknown type'}]`);
      } else if (item.type === 'resource') {
        // For resources, show URI and any text
        const resourceInfo = [`[Resource: ${item.uri || 'unknown'}]`];
        if (item.text) {
          resourceInfo.push(item.text);
        }
        parts.push(resourceInfo.join('\n'));
      }
    }

    return parts.join('\n');
  }

  // Fallback: stringify the response
  return JSON.stringify(response, null, 2);
}

export interface ExecuteOptions {
  json?: boolean;
  yaml?: boolean;
  raw?: boolean;  // Output raw/complete schema without processing
  config?: string;
  verbose?: boolean;
  noCache?: boolean;
  stdin?: boolean;
  connectionPool?: ConnectionPool;  // Optional connection pool for persistent connections
  cwd?: string;  // Client's working directory for resolving paths
  context?: ExecutionContext;  // Execution context (preferred over individual options)
}

export interface ServersCommandArgs {
  tools?: 'names' | 'desc';
  detailed?: boolean;
}

export interface ToolsCommandArgs {
  servers?: string[];
}

export interface InfoCommandArgs {
  server: string;
  tools?: string[];
}

export interface CallCommandArgs {
  server: string;
  tool: string;
  args: string[];
  stdinData?: string;
}

export interface SchemaCommandArgs {
  server: string;
  tools: string[];
}

export interface ConnectCommandArgs {
  server: string;
}

export interface DisconnectCommandArgs {
  server: string;
}

export interface ReconnectCommandArgs {
  server: string;
}

export interface ConnectionsCommandArgs {
  // No args needed
}

/**
 * Format data as JSON or YAML based on context
 */
function formatOutput(data: any, ctx: ExecutionContext): string {
  if (ctx.yaml) {
    return stringifyYaml(data);
  }
  if (ctx.json) {
    return JSON.stringify(data, null, 2);
  }
  // Fallback to JSON for structured data
  return JSON.stringify(data, null, 2);
}

/**
 * Get or create execution context from options
 */
function getContext(options: ExecuteOptions): ExecutionContext {
  if (options.context) {
    return options.context;
  }
  return new ExecutionContext({
    cwd: options.cwd,
    verbose: options.verbose,
    json: options.json,
    yaml: options.yaml,
    raw: options.raw,
    configFile: options.config,
    noCache: options.noCache,
  });
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
    const info = await pool.getConnection(serverName, config);
    return { connection: info.connection, isPersistent: true };
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
    const ctx = getContext(options);
    const discovery = new ConfigDiscovery({
      configFile: ctx.configFile,
      verbose: ctx.verbose,
    });

    const configs = await discovery.loadConfigs(ctx.cwd);
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

    if (ctx.json || ctx.yaml) {
      const servers = Array.from(configs.entries()).map(([name, config]) => ({
        name,
        ...config,
      }));

      const output = formatOutput({
        servers,
        total: servers.length,
      }, ctx);

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
        output += '  - .config/mcpu/config.local.json (local project config, gitignored)\n';
        output += '  - ~/.config/mcpu/config.json (user config)\n';
      } else if (args.detailed) {
        // Detailed format - multi-line per server
        output += 'Configured MCP Servers:\n\n';

        for (const [name, config] of configs.entries()) {
          const info = serverInfos.get(name);

          output += `${name}\n`;

          if (info?.description) {
            output += `  Server: ${info.description}\n`;
          }

          if (info?.toolCount !== undefined) {
            output += `  Tools: ${info.toolCount}\n`;
          }

          if ('url' in config) {
            const url = new URL(config.url);
            const isWebSocket = config.type === 'websocket' || url.protocol === 'ws:' || url.protocol === 'wss:';
            output += `  Type: ${isWebSocket ? 'websocket' : 'http'}\n`;
            output += `  URL: ${config.url}\n`;
          } else {
            output += `  Type: stdio\n`;
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
      } else {
        // Concise format - one line per server
        for (const [name, config] of configs.entries()) {
          const info = serverInfos.get(name);
          const parts = [`- ${name}`];

          if ('url' in config) {
            const url = new URL(config.url);
            const isWebSocket = config.type === 'websocket' || url.protocol === 'ws:' || url.protocol === 'wss:';
            parts.push(`Type: ${isWebSocket ? 'websocket' : 'http'}`);
            parts.push(`URL: ${config.url}`);
          } else {
            parts.push(`Type: stdio`);
            parts.push(`Command: ${config.command}`);
          }

          if (info?.description) {
            parts.push(info.description);
          }

          if (info?.toolCount !== undefined) {
            parts.push(`Tools: ${info.toolCount}`);
          }

          output += parts.join(' - ') + '\n';
        }

        output += `\nTotal: ${configs.size} server${configs.size === 1 ? '' : 's'}\n`;
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

    const configs = await discovery.loadConfigs(options.cwd);
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

    const ctx = getContext(options);

    if (ctx.json || ctx.yaml) {
      const output = formatOutput({
        tools: allTools.map(({ server, tool }) => ({
          server,
          name: tool.name,
          description: tool.description,
        })),
        total: allTools.length,
        servers: serversToQuery.size,
      }, ctx);

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

    const configs = await discovery.loadConfigs(options.cwd);
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

    // If no tools specified, show all tools
    const toolsToShow = args.tools && args.tools.length > 0
      ? args.tools
      : availableTools.map(t => t.name);

    const results = [];
    for (const toolName of toolsToShow) {
      const tool = availableTools.find(t => t.name === toolName);
      if (!tool) {
        return {
          success: false,
          error: `Tool "${toolName}" not found on server "${args.server}". Available tools: ${availableTools.map(t => t.name).join(', ')}`,
          exitCode: 1,
        };
      }

      const ctx = getContext(options);

      // --raw flag implies structured output (default to YAML)
      if (ctx.json || ctx.yaml || options.raw) {
        // If raw flag is set, output complete tool object without processing
        if (options.raw) {
          results.push(tool);
        } else {
          // Processed/simplified schema output
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
        }
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

    const ctx = getContext(options);

    if (ctx.json || ctx.yaml || options.raw) {
      // If --raw is used without explicit format, default to JSON (native MCP format)
      const outputCtx = options.raw && !ctx.json && !ctx.yaml
        ? { ...ctx, json: true }
        : ctx;

      return {
        success: true,
        output: formatOutput(results.length === 1 ? results[0] : results, outputCtx),
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

    const configs = await discovery.loadConfigs(options.cwd);
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
      const ctx = getContext(options);
      let output: string;

      // If json/yaml/raw requested, return full MCP response structure verbatim
      if (ctx.json || ctx.yaml || ctx.raw) {
        // --raw defaults to JSON (native MCP format), unless --yaml is explicitly set
        const outputCtx = ctx.raw && !ctx.json && !ctx.yaml
          ? { ...ctx, json: true }
          : ctx;
        output = formatOutput(result, outputCtx);
      } else {
        // Default: unwrap MCP response to extract meaningful content (like Claude CLI does)
        output = unwrapMcpResponse(result);
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
/**
 * Connect command - manually connect to a server
 */
async function executeConnectCommand(
  args: ConnectCommandArgs,
  options: ExecuteOptions
): Promise<CommandResult> {
  const { server } = args;
  const { connectionPool } = options;

  if (!connectionPool) {
    return {
      success: false,
      error: 'Connection pool not available. This command only works in daemon mode.',
      exitCode: 1,
    };
  }

  try {
    const ctx = getContext(options);
    const discovery = new ConfigDiscovery({
      configFile: ctx.configFile,
      verbose: ctx.verbose,
    });

    await discovery.loadConfigs(ctx.cwd);
    const config = discovery.getServer(server);
    if (!config) {
      return {
        success: false,
        error: `Server "${server}" not found in config`,
        exitCode: 1,
      };
    }

    const info = await connectionPool.getConnection(server, config);

    // Get stderr from the connection
    const stderr = connectionPool.getStderr(info.connection);

    let output = `Connected to server "${server}"`;
    if (stderr) {
      output += `\n\n[${server}] stderr:\n${stderr}`;
    }

    return {
      success: true,
      output,
      exitCode: 0,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to connect to "${server}": ${error.message || error}`,
      exitCode: 1,
    };
  }
}

/**
 * Disconnect command - disconnect from a server
 */
async function executeDisconnectCommand(
  args: DisconnectCommandArgs,
  options: ExecuteOptions
): Promise<CommandResult> {
  const { server } = args;
  const { connectionPool } = options;

  if (!connectionPool) {
    return {
      success: false,
      error: 'Connection pool not available. This command only works in daemon mode.',
      exitCode: 1,
    };
  }

  try {
    connectionPool.disconnect(server);
    return {
      success: true,
      output: `Disconnected from server "${server}"`,
      exitCode: 0,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to disconnect from "${server}": ${error.message || error}`,
      exitCode: 1,
    };
  }
}

/**
 * Reconnect command - reconnect to a server
 */
async function executeReconnectCommand(
  args: ReconnectCommandArgs,
  options: ExecuteOptions
): Promise<CommandResult> {
  const { server } = args;
  const { connectionPool } = options;

  if (!connectionPool) {
    return {
      success: false,
      error: 'Connection pool not available. This command only works in daemon mode.',
      exitCode: 1,
    };
  }

  try {
    const ctx = getContext(options);
    const discovery = new ConfigDiscovery({
      configFile: ctx.configFile,
      verbose: ctx.verbose,
    });

    await discovery.loadConfigs(ctx.cwd);
    const config = discovery.getServer(server);
    if (!config) {
      return {
        success: false,
        error: `Server "${server}" not found in config`,
        exitCode: 1,
      };
    }

    await connectionPool.disconnect(server);
    const info = await connectionPool.getConnection(server, config);

    // Get stderr from the connection
    const stderr = connectionPool.getStderr(info.connection);

    let output = `Reconnected to server "${server}"`;
    if (stderr) {
      output += `\n\n[${server}] stderr:\n${stderr}`;
    }

    return {
      success: true,
      output,
      exitCode: 0,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to reconnect to "${server}": ${error.message || error}`,
      exitCode: 1,
    };
  }
}

/**
 * Connections command - list active connections
 */
async function executeConnectionsCommand(
  args: ConnectionsCommandArgs,
  options: ExecuteOptions
): Promise<CommandResult> {
  const { connectionPool } = options;

  if (!connectionPool) {
    return {
      success: false,
      error: 'Connection pool not available. This command only works in daemon mode.',
      exitCode: 1,
    };
  }

  try {
    const connections = connectionPool.listConnections();

    if (connections.length === 0) {
      return {
        success: true,
        output: 'No active connections',
        exitCode: 0,
      };
    }

    const lines = ['Active connections:'];
    for (const conn of connections) {
      const lastUsedDate = new Date(conn.lastUsed).toLocaleString();
      lines.push(`  ${conn.server} (last used: ${lastUsedDate})`);
    }

    return {
      success: true,
      output: lines.join('\n'),
      exitCode: 0,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to list connections: ${error.message || error}`,
      exitCode: 1,
    };
  }
}

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
    case 'connect':
      return executeConnectCommand(args, options);
    case 'disconnect':
      return executeDisconnectCommand(args, options);
    case 'reconnect':
      return executeReconnectCommand(args, options);
    case 'connections':
      return executeConnectionsCommand(args, options);
    default:
      return {
        success: false,
        error: `Unknown command: ${command}`,
        exitCode: 1,
      };
  }
}
