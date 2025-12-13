import { stringify as stringifyYaml } from 'yaml';
import { ConfigDiscovery } from '../config.ts';
import { MCPClient, type MCPConnection } from '../client.ts';
import { SchemaCache } from '../cache.ts';
import type { CommandResult } from '../types/result.ts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ConnectionPool } from '../daemon/connection-pool.ts';
import { ExecutionContext } from './context.ts';
import { formatToolInfo, abbreviateType, LEGEND_HEADER, TYPES_LINE, collectEnums, formatEnumLegend, extractEnumOrRange, formatParamType } from '../formatters.ts';
import { isStdioConfig, isUrlConfig, isWebSocketConfig } from '../types.ts';
import { fuzzyMatch } from '../utils/fuzzy.ts';

/**
 * Core command executor - shared logic for CLI and daemon
 */

/**
 * Extract default value from description
 */
function extractDefault(propSchema: any): string | null {
  if (propSchema.description) {
    const defaultMatch = propSchema.description.match(/\(default:?\s*([^)]+)\)/i);
    if (defaultMatch) {
      return defaultMatch[1].trim();
    }
  }
  return null;
}

/**
 * Extract brief argument summary from tool schema
 * Format: "required_params, optional_params?"
 * @param tool - The tool to extract args from
 * @param description - Tool description to check for existing arg docs
 * @param forceParams - If true, skip the check for args already in description
 * @param enumRefs - Optional map of enum values to reference names
 * @param skipComplexCheck - If true, always show full params (for servers with few tools)
 */
function formatBriefArgs(tool: Tool, description?: string, forceParams?: boolean, enumRefs?: Map<string, string>, skipComplexCheck = false): string {
  if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
    return '';
  }

  const schema = tool.inputSchema as any;
  const properties = schema.properties || {};
  const required = new Set(schema.required || []);

  const paramCount = Object.keys(properties).length;

  // If no parameters, return empty
  if (paramCount === 0) {
    return '';
  }

  // If description is multi-line, check if it already documents the args
  // Skip this check if forceParams is true (user explicitly requested --params from CLI)
  if (!forceParams && description && description.includes('\n')) {
    const allArgNames = Object.keys(properties);
    // If description mentions most of the args (at least 75%), skip our ARGS: section
    const mentionedCount = allArgNames.filter(argName => description.includes(argName)).length;
    if (allArgNames.length > 0 && mentionedCount / allArgNames.length >= 0.75) {
      return '';
    }
  }

  const requiredArgs: string[] = [];
  const optionalArgs: string[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    const propSchema = prop as any;

    // Use shared formatParamType with depth=1 for tools (no object refs needed at depth=1)
    let typeStr = formatParamType(propSchema, enumRefs, undefined, 1);

    // Extract default value if present (not in schema default)
    if (propSchema.default === undefined) {
      const defaultVal = extractDefault(propSchema);
      if (defaultVal) {
        typeStr = `${typeStr}=${defaultVal}`;
      }
    } else {
      const defVal = typeof propSchema.default === 'string'
        ? propSchema.default
        : JSON.stringify(propSchema.default);
      typeStr = `${typeStr}=${defVal}`;
    }

    // Build parameter string: name type (no ? for required, ? for optional)
    const argStr = `${name} ${typeStr}`;

    if (required.has(name)) {
      requiredArgs.push(argStr);
    } else {
      optionalArgs.push(`${name}? ${typeStr}`);
    }
  }

  // Build full params string: required first, then optional
  const allArgs = [...requiredArgs, ...optionalArgs];
  const fullParamsStr = allArgs.join(', ');
  const requiredParamsStr = requiredArgs.join(', ');

  // Check complexity thresholds (skip if server has few tools)
  const isFullComplex = paramCount > 10 || fullParamsStr.length > 180;
  const isRequiredComplex = requiredArgs.length > 10 || requiredParamsStr.length > 180;

  // If full list is too complex, try showing only required params
  if (isFullComplex && !skipComplexCheck) {
    if (isRequiredComplex || requiredArgs.length === 0) {
      // Even required params are too complex, or no required params
      return ' - ARGS: (use info for details)';
    } else {
      // Show only required params with indicator
      return ` - ARGS: ${requiredParamsStr} (+${optionalArgs.length} optional)`;
    }
  }

  // Show all params
  return ` - ARGS: ${fullParamsStr}`;
}

// Track servers where tools listing has been shown (explicitly or via error)
const toolsShownForServer = new Set<string>();

/**
 * Mark that tools have been shown for a server
 */
export function markToolsShown(serverName: string): void {
  toolsShownForServer.add(serverName);
}

/**
 * Check if tools have been shown for a server
 */
export function hasToolsBeenShown(serverName: string): boolean {
  return toolsShownForServer.has(serverName);
}

/**
 * Format a compact tools list for inclusion in error messages
 * Returns empty string if tools already shown for this server
 * Marks server as "tools shown" when returning usage
 */
function formatToolsForError(tools: Tool[], serverName: string): string {
  if (toolsShownForServer.has(serverName)) {
    return '';
  }

  // Mark as shown
  toolsShownForServer.add(serverName);

  const enumRefs = collectEnums(tools);
  const skipComplexCheck = tools.length <= 3;

  let output = `\n\nUsage: Available tools on "${serverName}":\n`;
  output += `${TYPES_LINE}\n`;

  // Add enum legend if any
  if (enumRefs.size > 0) {
    for (const [enumValue, ref] of enumRefs.entries()) {
      output += `${ref}: ${enumValue}\n`;
    }
  }

  for (const tool of tools) {
    const description = (tool.description || 'No description').split('\n')[0].trim();
    const briefArgs = formatBriefArgs(tool, description, true, enumRefs, skipComplexCheck);
    output += `- ${tool.name} - ${description}${briefArgs}\n`;
  }

  return output;
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
  configDiscovery?: ConfigDiscovery;  // Config discovery instance
}

export interface ServersCommandArgs {
  pattern?: string;
  tools?: 'names' | 'desc';
  detailed?: boolean;
}

export interface ToolsCommandArgs {
  servers?: string[];
  /** Show only tool names, no descriptions */
  names?: boolean;
  /** Show full multi-line descriptions instead of first line only */
  fullDesc?: boolean;
  /** Show argument information (use --no-args to hide) */
  showArgs?: boolean;
  /** Source of args option - 'cli' means user explicitly set it */
  showArgsSource?: string;
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
  setConfig?: { extraArgs?: string[] };
  restart?: boolean;
}

export interface ConfigCommandArgs {
  server: string;
  setConfig?: { extraArgs?: string[] };
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

export interface ReloadCommandArgs {
  // No args needed
}

/**
 * Format data as JSON or YAML based on context
 */
function formatOutput(data: any, ctx: ExecutionContext): string {
  if (ctx.yaml) {
    return stringifyYaml(data);
  }
  // Compact JSON for AI context efficiency (~40% smaller than pretty-printed)
  return JSON.stringify(data);
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

    const allConfigs = await discovery.loadConfigs(ctx.cwd);
    const pool = options.connectionPool;

    // Filter configs by pattern if provided
    let configs = allConfigs;
    if (args.pattern) {
      configs = new Map(
        Array.from(allConfigs.entries()).filter(([name, config]) => {
          // Match server name
          if (fuzzyMatch(name, args.pattern!)) return true;

          // Match command for stdio configs
          if (isStdioConfig(config)) {
            const fullCommand = [config.command, ...(config.args || [])].join(' ');
            if (fuzzyMatch(fullCommand, args.pattern!)) return true;
          }

          // Match URL for http configs
          if (isUrlConfig(config)) {
            if (fuzzyMatch(config.url, args.pattern!)) return true;
          }

          return false;
        })
      );
    }

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

        // Mark that tools have been shown for this server
        markToolsShown(serverName);

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
      // Only show "All Available Tools" header if querying multiple servers
      let output = serversToQuery.size > 1 ? 'All Available Tools:\n\n' : '';

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

        // Add legend header if not in names-only mode
        if (!args.names) {
          output += `${LEGEND_HEADER}\n${TYPES_LINE}\n\n`;
        }

        for (const [server, tools] of toolsByServer.entries()) {
          output += `MCP server ${server}:\n`;

          // Collect enum references for this server's tools
          const enumRefs = args.names ? new Map() : collectEnums(tools);

          // Add enum legend under server header if there are any
          if (!args.names && enumRefs.size > 0) {
            for (const [enumValue, ref] of enumRefs.entries()) {
              output += `  ${ref}: ${enumValue}\n`;
            }
          }

          const skipComplexCheck = tools.length <= 3;
          for (const tool of tools) {
            if (args.names) {
              output += `  - ${tool.name}\n`;
            } else {
              // Show first line by default, full description if --full-desc
              const description = args.fullDesc === true
                ? (tool.description || 'No description')
                : (tool.description || 'No description').split('\n')[0].trim();
              // --no-args sets showArgs to false
              // forceArgs=true when user explicitly set --args from CLI
              const forceArgs = args.showArgsSource === 'cli';
              const briefArgs = args.showArgs === false ? '' : formatBriefArgs(tool, description, forceArgs, enumRefs, skipComplexCheck);
              output += `  - ${tool.name} - ${description}${briefArgs}\n`;
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

    // Collect tools first to validate all exist
    const toolsForInfo: Tool[] = [];
    for (const toolName of toolsToShow) {
      const tool = availableTools.find(t => t.name === toolName);
      if (!tool) {
        return {
          success: false,
          error: `Tool "${toolName}" not found on server "${args.server}". Available tools: ${availableTools.map(t => t.name).join(', ')}`,
          exitCode: 1,
        };
      }
      toolsForInfo.push(tool);
    }

    const ctx = getContext(options);

    // --yaml or --raw flags imply structured output with complete tool object
    if (ctx.json || ctx.yaml || options.raw) {
      // If --raw is used without explicit format, default to JSON (native MCP format)
      const outputCtx = options.raw && !ctx.json && !ctx.yaml
        ? new ExecutionContext({ cwd: ctx.cwd, verbose: ctx.verbose, json: true, yaml: false, raw: ctx.raw, configFile: ctx.configFile, noCache: ctx.noCache })
        : ctx;

      const outputData = toolsForInfo.length === 1 ? toolsForInfo[0] : toolsForInfo;
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
      // Text output: collect enums and build header/body/footer
      const enumRefs = collectEnums(toolsForInfo);
      const enumLegend = formatEnumLegend(enumRefs);

      // Header: # Legend section with types and enums
      let header = `${LEGEND_HEADER}\n${TYPES_LINE}`;
      if (enumLegend) {
        header += '\n' + enumLegend;
      }
      header += '\n\n';

      // Body: formatted tools
      const body = toolsForInfo.map(t => formatToolInfo(t, enumRefs)).join('');

      // Footer: cache status
      const footer = fromCache ? '(from cache)\n' : '';

      return {
        success: true,
        output: header + body + footer,
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

    // Handle setConfig.extraArgs if provided
    if (args.setConfig?.extraArgs !== undefined && isStdioConfig(config)) {
      const newExtraArgs = args.setConfig.extraArgs;
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
      const toolsList = formatToolsForError(tools, args.server);
      return {
        success: false,
        error: `Error: Tool "${args.tool}" not found on server "${args.server}".${toolsList}`,
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
      const result = await client.callTool(connection, args.tool, toolArgs, config.requestTimeout);

      // Return raw result in meta - caller handles formatting
      return {
        success: true,
        exitCode: 0,
        meta: {
          ...meta,
          rawResult: {
            server: args.server,
            tool: args.tool,
            result,
          },
        },
      };
    } catch (callError: any) {
      const errorMsg = callError.message || String(callError);
      const toolsList = formatToolsForError(tools, args.server);

      return {
        success: false,
        error: `Error: ${errorMsg}${toolsList}`,
        exitCode: 1,
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
  const { server, setConfig } = args;
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

  const newExtraArgs = setConfig?.extraArgs;
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

/**
 * Reload command - reload config from disk and disconnect removed servers
 */
async function executeReloadCommand(
  args: ReloadCommandArgs,
  options: ExecuteOptions
): Promise<CommandResult> {
  const { connectionPool, configs, configDiscovery } = options;

  if (!connectionPool || !configs) {
    return {
      success: false,
      error: 'Connection pool or configs not available. This command requires daemon or MCP mode.',
      exitCode: 1,
    };
  }

  try {
    const ctx = getContext(options);

    // Always create a fresh ConfigDiscovery to ensure clean state
    const discovery = new ConfigDiscovery({
      configFile: ctx.configFile,
      verbose: ctx.verbose,
    });

    // Reload configs from disk (cwd=undefined to avoid project-specific paths)
    const newConfigs = await discovery.loadConfigs();

    // Get current active connections
    const activeConnections = connectionPool.listConnections();

    // Find servers to disconnect (in active connections but not in new config)
    const serversToDisconnect: string[] = [];
    for (const conn of activeConnections) {
      if (!newConfigs.has(conn.server)) {
        serversToDisconnect.push(conn.server);
      }
    }

    // Disconnect removed servers
    for (const server of serversToDisconnect) {
      await connectionPool.disconnect(server);
    }

    // Update the configs map (clear and repopulate to handle removals)
    configs.clear();
    for (const [name, config] of newConfigs.entries()) {
      configs.set(name, config);
    }

    // Build result message
    const lines: string[] = [];
    lines.push(`Config reloaded: ${newConfigs.size} server(s) configured`);

    if (serversToDisconnect.length > 0) {
      lines.push(`Disconnected ${serversToDisconnect.length} removed server(s): ${serversToDisconnect.join(', ')}`);
    }

    // Show current connection status
    const remainingConnections = connectionPool.listConnections();
    if (remainingConnections.length > 0) {
      lines.push(`Active connections: ${remainingConnections.map(c => c.server).join(', ')}`);
    }

    return {
      success: true,
      output: lines.join('\n'),
      exitCode: 0,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to reload config: ${error.message || error}`,
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
    case 'setConfig':
      return executeConfigCommand(args, options);
    case 'reload':
      return executeReloadCommand(args, options);
    default:
      return {
        success: false,
        error: `Unknown command: ${command}`,
        exitCode: 1,
      };
  }
}
