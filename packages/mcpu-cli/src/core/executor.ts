import { stringify as stringifyYaml } from 'yaml';
import { ConfigDiscovery } from '../config.ts';
import { MCPClient, type MCPConnection } from '../client.ts';
import { SchemaCache } from '../cache.ts';
import type { CommandResult } from '../types/result.ts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ConnectionPool } from '../daemon/connection-pool.ts';
import { ExecutionContext } from './context.ts';
import { formatToolInfo, formatMcpResponse } from '../formatters.ts';
import { isStdioConfig, isUrlConfig, isWebSocketConfig } from '../types.ts';

/**
 * Core command executor - shared logic for CLI and daemon
 */

/**
 * Abbreviate type names to 3-letter codes
 */
function abbreviateType(type: string): string {
  const abbrevMap: Record<string, string> = {
    'string': 'str',
    'integer': 'int',
    'number': 'num',
    'boolean': 'bool',
    'object': 'obj',
    'array': 'arr',
  };
  return abbrevMap[type] || type;
}

/**
 * Extract brief argument summary from tool schema
 * Format: "`arg1?` type, `arg2` type"
 */
function formatBriefArgs(tool: Tool): string {
  if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
    return '';
  }

  const schema = tool.inputSchema as any;
  const properties = schema.properties || {};
  const required = new Set(schema.required || []);

  const args: string[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    const propSchema = prop as any;

    // Determine type string
    let typeStr = 'any';

    if (propSchema.type) {
      // Handle union types (array of types)
      if (Array.isArray(propSchema.type)) {
        typeStr = propSchema.type.map(abbreviateType).join('|');
      }
      // Handle single type
      else if (propSchema.type === 'array' && propSchema.items) {
        // Array type with items
        const itemType = Array.isArray(propSchema.items.type)
          ? propSchema.items.type.map(abbreviateType).join('|')
          : abbreviateType(propSchema.items.type || 'any');
        typeStr = `${itemType}[]`;
      } else {
        typeStr = abbreviateType(propSchema.type);
      }
    }

    // Handle enums (override type)
    if (propSchema.enum) {
      typeStr = propSchema.enum.join('|');
    }

    // Build parameter string: name? type
    const optionalMark = !required.has(name) ? '?' : '';
    const argStr = `${name}${optionalMark} ${typeStr}`;

    args.push(argStr);
  }

  return args.length > 0 ? ` PARAMS: ${args.join(', ')}` : '';
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
  configs?: Map<string, any>;  // Runtime config map from daemon (mutable)
}

export interface ServersCommandArgs {
  tools?: 'names' | 'desc';
  detailed?: boolean;
}

export interface ToolsCommandArgs {
  servers?: string[];
  /** Show only tool names, no descriptions */
  names?: boolean;
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
  mcpServerConfig?: { extraArgs?: string[] };
  restart?: boolean;
}

export interface ConfigCommandArgs {
  server: string;
  mcpServerConfig?: { extraArgs?: string[] };
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
    const pool = options.connectionPool;

    // Get server info from active connections only (don't spawn new connections)
    const serverInfos = new Map<string, { description?: string; toolCount?: number; tools?: Array<{ name: string; description?: string }> }>();

    if (pool) {
      const activeConnections = pool.listConnections();

      for (const connInfo of activeConnections) {
        try {
          const conn = pool.getRawConnection(connInfo.server);
          if (conn) {
            const client = new MCPClient();
            const tools = await client.listTools(conn);
            const serverInfo = (conn.client as any)._serverVersion;
            const description = serverInfo?.name ?
              `${serverInfo.name}${serverInfo.version ? ` v${serverInfo.version}` : ''}` :
              undefined;

            serverInfos.set(connInfo.server, {
              description,
              toolCount: tools.length,
              tools: args.tools ? tools.map(t => ({ name: t.name, description: t.description })) : undefined
            });
          }
        } catch (error) {
          // Ignore errors from getting connection info
        }
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

          if (isUrlConfig(config)) {
            const url = new URL(config.url);
            const isWs = isWebSocketConfig(config) || url.protocol === 'ws:' || url.protocol === 'wss:';
            output += `  Type: ${isWs ? 'websocket' : 'http'}\n`;
            output += `  URL: ${config.url}\n`;
          } else if (isStdioConfig(config)) {
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
        // Concise format - grouped by connection status
        const connected: string[] = [];
        const disconnected: string[] = [];

        for (const [name, config] of configs.entries()) {
          const info = serverInfos.get(name);
          const hasConnection = info && (info.description || info.toolCount !== undefined);

          const parts = [`- ${name}`];
          parts.push(hasConnection ? 'connected' : 'disconnected');

          // Type info
          if (isUrlConfig(config)) {
            const url = new URL(config.url);
            const isWs = isWebSocketConfig(config) || url.protocol === 'ws:' || url.protocol === 'wss:';
            parts.push(`Type: ${isWs ? 'websocket' : 'http'}`);
            parts.push(`URL: ${config.url}`);
          } else if (isStdioConfig(config)) {
            parts.push(`Type: stdio`);
            if (hasConnection) {
              // Connected: don't show command
            } else {
              // Disconnected: show full command
              const cmdParts = [config.command, ...(config.args || [])];
              parts.push(`Command: ${cmdParts.join(' ')}`);
            }

            // ENV
            if (config.env && Object.keys(config.env).length > 0) {
              parts.push(`ENV: ${JSON.stringify(config.env)}`);
            }
          }

          // Server info (only if connected)
          if (info?.description) {
            parts.push(info.description);
          }

          if (info?.toolCount !== undefined) {
            parts.push(`Tools: ${info.toolCount}`);
          }

          if (hasConnection) {
            connected.push(parts.join(' - '));
          } else {
            disconnected.push(parts.join(' - '));
          }
        }

        if (connected.length > 0) {
          output += 'connected:\n';
          output += connected.join('\n') + '\n\n';
        }

        if (disconnected.length > 0) {
          output += 'disconnected:\n';
          output += disconnected.join('\n') + '\n';
        }

        output += `\nTotal: ${configs.size} server${configs.size === 1 ? '' : 's'} (${connected.length} connected, ${disconnected.length} disconnected)\n`;
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
    const cachedServers: string[] = [];
    const pool = options.connectionPool;

    for (const [serverName, config] of serversToQuery.entries()) {
      try {
        let tools: Tool[] | null = null;
        let fromCache = false;

        if (!options.noCache) {
          const cacheResult = await cache.getWithExpiry(serverName, config.cacheTTL);
          if (cacheResult) {
            if (cacheResult.expired) {
              // TTL expired - force sync refresh if we have a pool connection
              if (pool) {
                await pool.refreshCacheSync(serverName);
                tools = await cache.get(serverName, config.cacheTTL);
              }
              // If no pool or refresh failed, fall through to fetch fresh
            } else {
              // Cache valid
              tools = cacheResult.tools;
              fromCache = true;
            }
          }
        }

        if (!tools) {
          tools = await client.withConnection(serverName, config, async (conn) => {
            return await client.listTools(conn);
          });
          await cache.set(serverName, tools);
        }

        if (fromCache) {
          cachedServers.push(serverName);
        }

        for (const tool of tools) {
          allTools.push({ server: serverName, tool });
        }
      } catch (error) {
        // Skip failed connections silently unless verbose
      }
    }

    const ctx = getContext(options);

    const meta = cachedServers.length > 0
      ? { fromCache: true, cachedServers }
      : undefined;

    if (ctx.json || ctx.yaml) {
      const output = formatOutput({
        tools: allTools.map(({ server, tool }) => ({
          server,
          name: tool.name,
          description: tool.description,
        })),
        total: allTools.length,
        servers: serversToQuery.size,
        ...(cachedServers.length > 0 && { cachedServers }),
      }, ctx);

      return {
        success: true,
        output,
        exitCode: 0,
        meta,
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
            if (args.names) {
              output += `  ${tool.name}\n`;
            } else {
              const briefArgs = formatBriefArgs(tool);
              output += `  ${tool.name} - ${tool.description || 'No description'}${briefArgs}\n`;
            }
          }
          output += '\n';
        }
      }

      output += `\nTotal: ${allTools.length} tools across ${serversToQuery.size} servers`;
      if (cachedServers.length > 0) {
        output += ` (cached: ${cachedServers.join(', ')})`;
      }
      output += '\n';

      return {
        success: true,
        output,
        exitCode: 0,
        meta,
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
    const pool = options.connectionPool;

    let availableTools: Tool[] | null = null;
    let fromCache = false;

    if (!options.noCache) {
      const cacheResult = await cache.getWithExpiry(args.server, config.cacheTTL);
      if (cacheResult) {
        if (cacheResult.expired) {
          // TTL expired - force sync refresh if we have a pool connection
          if (pool) {
            await pool.refreshCacheSync(args.server);
            availableTools = await cache.get(args.server, config.cacheTTL);
          }
          // If no pool or refresh failed, fall through to fetch fresh
        } else {
          // Cache valid
          availableTools = cacheResult.tools;
          fromCache = true;
        }
      }
    }

    if (!availableTools) {
      availableTools = await client.withConnection(args.server, config, async (conn) => {
        return await client.listTools(conn);
      });
      await cache.set(args.server, availableTools);
    }

    const meta = fromCache
      ? { fromCache: true, cachedServers: [args.server] }
      : undefined;

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

      // --yaml or --raw flags imply structured output with complete tool object
      if (ctx.json || ctx.yaml || options.raw) {
        // Output complete tool object without processing
        results.push(tool);
      } else {
        // Use enhanced text formatter
        results.push(formatToolInfo(tool, args.server));
      }
    }

    const ctx = getContext(options);

    if (ctx.json || ctx.yaml || options.raw) {
      // If --raw is used without explicit format, default to JSON (native MCP format)
      const outputCtx = options.raw && !ctx.json && !ctx.yaml
        ? new ExecutionContext({ cwd: ctx.cwd, verbose: ctx.verbose, json: true, yaml: false, raw: ctx.raw, configFile: ctx.configFile, noCache: ctx.noCache })
        : ctx;

      const outputData = results.length === 1 ? results[0] : results;
      // Include cache status in structured output
      const wrappedOutput = fromCache
        ? { ...outputData, _meta: { fromCache: true } }
        : outputData;

      return {
        success: true,
        output: formatOutput(wrappedOutput, outputCtx),
        exitCode: 0,
        meta,
      };
    } else {
      let output = results.join('');
      if (fromCache) {
        output += `\n(from cache)\n`;
      }
      return {
        success: true,
        output,
        exitCode: 0,
        meta,
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
    // Use daemon's config map if available, otherwise load fresh
    let configs: Map<string, any>;
    if (options.configs) {
      configs = options.configs;
    } else {
      const discovery = new ConfigDiscovery({
        configFile: options.config,
        verbose: options.verbose,
      });
      configs = await discovery.loadConfigs(options.cwd);
    }

    const config = configs.get(args.server);

    if (!config) {
      return {
        success: false,
        error: `Server "${args.server}" not found. Available servers: ${Array.from(configs.keys()).join(', ')}`,
        exitCode: 1,
      };
    }

    // Handle mcpServerConfig.extraArgs if provided
    if (args.mcpServerConfig?.extraArgs !== undefined && isStdioConfig(config)) {
      const newExtraArgs = args.mcpServerConfig.extraArgs;
      const oldExtraArgs = config.extraArgs;
      const argsChanged = !extraArgsEqual(oldExtraArgs, newExtraArgs);

      // Check if server is currently connected
      let serverRunning = false;
      if (options.connectionPool) {
        const connections = options.connectionPool.listConnections();
        serverRunning = connections.some(c => c.server === args.server);
      }

      if (argsChanged && serverRunning) {
        if (!args.restart) {
          // Error: server running with different args, no --restart flag
          return {
            success: false,
            error: `Server "${args.server}" is running with different extraArgs. Use --restart to apply new extraArgs.`,
            exitCode: 1,
          };
        }
        // Restart: disconnect server, store new args
        options.connectionPool!.disconnect(args.server);
        config.extraArgs = newExtraArgs;
      } else if (!serverRunning) {
        // Server not running: just store the args
        config.extraArgs = newExtraArgs;
      }
      // If server running with same args: proceed normally, no change needed
    }

    const client = new MCPClient();
    const cache = new SchemaCache();
    const pool = options.connectionPool;

    let tools: Tool[] | null = null;
    let schemaFromCache = false;

    if (!options.noCache) {
      const cacheResult = await cache.getWithExpiry(args.server, config.cacheTTL);
      if (cacheResult) {
        if (cacheResult.expired) {
          // TTL expired - force sync refresh if we have a pool connection
          if (pool) {
            await pool.refreshCacheSync(args.server);
            tools = await cache.get(args.server, config.cacheTTL);
          }
          // If no pool or refresh failed, fall through to fetch fresh
        } else {
          // Cache valid
          tools = cacheResult.tools;
          schemaFromCache = true;
        }
      }
    }

    if (!tools) {
      tools = await client.withConnection(args.server, config, async (conn) => {
        return await client.listTools(conn);
      });
      await cache.set(args.server, tools);
    }

    const meta = schemaFromCache
      ? { fromCache: true, cachedServers: [args.server] }
      : undefined;

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

    // Check if --stdin flag is used in daemon mode (not allowed)
    if (options.stdin && options.connectionPool && !args.stdinData) {
      return {
        success: false,
        error: '--stdin flag not supported when running through daemon. Use: mcpu-remote --stdin -- call ...',
        exitCode: 1,
      };
    }

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
          ? new ExecutionContext({ cwd: ctx.cwd, verbose: ctx.verbose, json: true, yaml: false, raw: ctx.raw, configFile: ctx.configFile, noCache: ctx.noCache })
          : ctx;
        output = formatOutput(result, outputCtx);
      } else {
        // Default: unwrap MCP response to extract meaningful content (like Claude CLI does)
        output = formatMcpResponse(result);
      }

      return {
        success: true,
        output,
        exitCode: 0,
        meta,
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
 * Helper to compare extraArgs arrays
 */
function extraArgsEqual(a?: string[], b?: string[]): boolean {
  const arrA = a || [];
  const arrB = b || [];
  if (arrA.length !== arrB.length) return false;
  return arrA.every((v, i) => v === arrB[i]);
}

/**
 * Execute the 'config' command - configure MCP server runtime settings
 */
async function executeConfigCommand(
  args: ConfigCommandArgs,
  options: ExecuteOptions
): Promise<CommandResult> {
  const { server, mcpServerConfig } = args;
  const { configs, connectionPool } = options;

  if (!configs) {
    return {
      success: false,
      error: 'Config map not available. This command only works in daemon mode.',
      exitCode: 1,
    };
  }

  const config = configs.get(server);
  if (!config) {
    return {
      success: false,
      error: `Server "${server}" not found in config`,
      exitCode: 1,
    };
  }

  // Check if this is a stdio config (only stdio supports extraArgs)
  if (!isStdioConfig(config)) {
    return {
      success: false,
      error: `Server "${server}" is not a stdio server. extraArgs only applies to stdio servers.`,
      exitCode: 1,
    };
  }

  const newExtraArgs = mcpServerConfig?.extraArgs;
  const oldExtraArgs = config.extraArgs;
  const changed = !extraArgsEqual(oldExtraArgs, newExtraArgs);

  // Store the new extraArgs
  config.extraArgs = newExtraArgs;

  // Check if server is currently connected
  let serverRunning = false;
  if (connectionPool) {
    const connections = connectionPool.listConnections();
    serverRunning = connections.some(c => c.server === server);
  }

  let message = `Server "${server}" config updated`;
  if (newExtraArgs && newExtraArgs.length > 0) {
    message += `: extraArgs = [${newExtraArgs.join(', ')}]`;
  } else {
    message += `: extraArgs cleared`;
  }

  if (changed && serverRunning) {
    message += `\nNote: Server is running with previous args. Restart required to apply new extraArgs.`;
  }

  return {
    success: true,
    output: message,
    exitCode: 0,
  };
}

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
    case 'config':
      return executeConfigCommand(args, options);
    default:
      return {
        success: false,
        error: `Unknown command: ${command}`,
        exitCode: 1,
      };
  }
}
