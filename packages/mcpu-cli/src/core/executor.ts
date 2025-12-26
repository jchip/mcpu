import { stringify as stringifyYaml } from 'yaml';
import { ConfigDiscovery } from '../config.ts';
import { MCPClient, type MCPConnection } from '../client.ts';
import { SchemaCache } from '../cache.ts';
import type { CommandResult } from '../types/result.ts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { type ConnectionPool, getConnectionKey, parseConnectionKey } from '../daemon/connection-pool.ts';
import { ExecutionContext } from './context.ts';
import { formatToolInfo, abbreviateType, LEGEND_HEADER, TYPES_LINE, collectEnums, formatEnumLegend, extractEnumOrRange, formatParamType } from '../formatters.ts';
import { isStdioConfig, isUrlConfig, isWebSocketConfig, type CollapseOptionalsConfig } from '../types.ts';
import { fuzzyMatch } from '../utils/fuzzy.ts';
import { getErrorMessage } from '../utils/error.ts';

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
interface CollapseContext {
  config?: CollapseOptionalsConfig;
  toolCount: number;
}

function formatBriefArgs(tool: Tool, description?: string, forceParams?: boolean, enumRefs?: Map<string, string>, collapse?: CollapseContext): string {
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

  // Check if collapsing is enabled via config
  // Default: never collapse (show all params)
  const config = collapse?.config;
  const toolCount = collapse?.toolCount ?? 0;

  // Only collapse if config is set and thresholds are met
  let shouldCollapse = false;
  if (config) {
    const minOptionals = config.minOptionals;
    const minTools = config.minTools;

    // Both conditions must be met when both are specified
    // Otherwise just the one that is specified
    if (minOptionals !== undefined && minTools !== undefined) {
      shouldCollapse = optionalArgs.length >= minOptionals && toolCount >= minTools;
    } else if (minOptionals !== undefined) {
      shouldCollapse = optionalArgs.length >= minOptionals;
    } else if (minTools !== undefined) {
      shouldCollapse = toolCount >= minTools;
    }
  }

  if (shouldCollapse && optionalArgs.length > 0) {
    // Collapse: show only required params with optional count indicator
    if (requiredArgs.length === 0) {
      return ` - ARGS: (+${optionalArgs.length} optional)`;
    } else {
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
function formatToolsForError(tools: Tool[], serverName: string, collapseConfig?: CollapseOptionalsConfig): string {
  if (toolsShownForServer.has(serverName)) {
    return '';
  }

  // Mark as shown
  toolsShownForServer.add(serverName);

  const enumRefs = collectEnums(tools);
  const collapse: CollapseContext = { config: collapseConfig, toolCount: tools.length };

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
    const briefArgs = formatBriefArgs(tool, description, true, enumRefs, collapse);
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
  details?: boolean;  // Show command, env, and other config details
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

export interface UsageCommandArgs {
  server: string;
  tool?: string;
}

export interface CallCommandArgs {
  server: string;
  tool: string;
  args: string[];
  stdinData?: string;
  restart?: boolean;
  connId?: string;  // --conn-id option for specific connection instance
}

export interface ConfigCommandArgs {
  server: string;
  setConfig?: Record<string, any>;  // {extraArgs?:[], env?:{}, requestTimeout?:ms}
}

export interface SchemaCommandArgs {
  server: string;
  tools: string[];
}

export interface ConnectCommandArgs {
  server: string;
  connId?: string;    // User-provided connection ID
  newConn?: boolean;  // --new flag for auto-assign
}

export interface DisconnectCommandArgs {
  server: string;
  connId?: string;
}

export interface ReconnectCommandArgs {
  server: string;
  connId?: string;
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
  pool?: ConnectionPool,
  connId?: string
): Promise<{ connection: MCPConnection; isPersistent: boolean }> {
  if (pool) {
    const info = await pool.getConnection(serverName, config, connId);
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
    const cache = new SchemaCache();

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

    // Get server info from active connections and cache
    interface ServerInfo {
      connected: boolean;
      toolNames?: string[];
      fromCache?: boolean;
    }
    const serverInfos = new Map<string, ServerInfo>();

    // First, check active connections
    if (pool) {
      const activeConnections = pool.listConnections();

      for (const connInfo of activeConnections) {
        try {
          const conn = pool.getRawConnection(connInfo.server);
          if (conn) {
            const client = new MCPClient();
            const tools = await client.listTools(conn);
            serverInfos.set(connInfo.server, {
              connected: true,
              toolNames: tools.map(t => t.name),
            });
          }
        } catch (error) {
          // Ignore errors from getting connection info
        }
      }
    }

    // Then, check cache for disconnected servers
    for (const [name, config] of configs.entries()) {
      if (!serverInfos.has(name)) {
        // Not connected - check cache
        const cachedTools = await cache.get(name, config.cacheTTL);
        if (cachedTools) {
          serverInfos.set(name, {
            connected: false,
            toolNames: cachedTools.map(t => t.name),
            fromCache: true,
          });
        } else {
          serverInfos.set(name, {
            connected: false,
          });
        }
      }
    }

    if (ctx.json || ctx.yaml) {
      const servers = Array.from(configs.entries()).map(([name, config]) => {
        const info = serverInfos.get(name);
        return {
          name,
          connected: info?.connected ?? false,
          tools: info?.toolNames,
          fromCache: info?.fromCache,
          ...(args.details ? config : {}),
        };
      });

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
      } else {
        // Group servers by connection status
        const connected: Array<{ name: string; config: any; info: ServerInfo }> = [];
        const disconnected: Array<{ name: string; config: any; info: ServerInfo }> = [];

        for (const [name, config] of configs.entries()) {
          const info = serverInfos.get(name) || { connected: false };
          if (info.connected) {
            connected.push({ name, config, info });
          } else {
            disconnected.push({ name, config, info });
          }
        }

        // Format helper for config details
        const formatDetails = (config: any): string => {
          let details = '';
          if (isUrlConfig(config)) {
            const url = new URL(config.url);
            const isWs = isWebSocketConfig(config) || url.protocol === 'ws:' || url.protocol === 'wss:';
            details += `  Type: ${isWs ? 'websocket' : 'http'}, URL: ${config.url}\n`;
          } else if (isStdioConfig(config)) {
            const cmdParts = [config.command, ...(config.args || [])];
            details += `  Type: stdio, Command: ${cmdParts.join(' ')}\n`;
            if (config.env && Object.keys(config.env).length > 0) {
              details += `  ENV: ${JSON.stringify(config.env)}\n`;
            }
          }
          if (config.cacheTTL !== undefined) {
            details += `  Cache TTL: ${config.cacheTTL} min\n`;
          }
          if (config.requestTimeout !== undefined) {
            details += `  Request Timeout: ${config.requestTimeout} ms\n`;
          }
          return details;
        };

        // Format server entry
        const formatServer = (name: string, config: any, info: ServerInfo): string => {
          let line = `- ${name}`;

          // Tool names
          if (info.toolNames && info.toolNames.length > 0) {
            line += ` - tools: ${info.toolNames.join(' ')}`;
          }

          line += '\n';

          // Details if requested
          if (args.details) {
            line += formatDetails(config);
          }

          return line;
        };

        if (connected.length > 0) {
          output += 'connected:\n';
          for (const { name, config, info } of connected) {
            output += formatServer(name, config, info);
          }
          output += '\n';
        }

        if (disconnected.length > 0) {
          output += 'disconnected:\n';
          for (const { name, config, info } of disconnected) {
            output += formatServer(name, config, info);
          }
        }

        output += `\nTotal: ${configs.size} server${configs.size === 1 ? '' : 's'} (${connected.length} connected, ${disconnected.length} disconnected)\n`;
      }

      return {
        success: true,
        output,
        exitCode: 0,
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

          const collapseConfig = discovery.getCollapseOptionals();
          const collapse: CollapseContext = { config: collapseConfig, toolCount: tools.length };
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
              const briefArgs = args.showArgs === false ? '' : formatBriefArgs(tool, description, forceArgs, enumRefs, collapse);
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
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
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
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
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
 * Execute the 'usage' command - delegates to either 'tools' or 'info' based on arguments
 */
export async function executeUsageCommand(
  args: UsageCommandArgs,
  options: ExecuteOptions
): Promise<CommandResult> {
  try {
    // Load config to check server's usage preference
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

    // Determine which command to use
    // If tool is specified, use 'info'
    // Otherwise, use server's usage config (default: 'tools')
    if (args.tool) {
      // Delegate to info command
      return executeInfoCommand(
        {
          server: args.server,
          tools: [args.tool],
        },
        options
      );
    } else {
      const usageMode = config.usage || 'tools';

      if (usageMode === 'info') {
        // Delegate to info command (show all tools)
        return executeInfoCommand(
          {
            server: args.server,
          },
          options
        );
      } else {
        // Delegate to tools command
        return executeToolsCommand(
          {
            servers: [args.server],
          },
          options
        );
      }
    }
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
      exitCode: 1,
    };
  }
}

/**
 * Execute the 'call' command
 */
export async function executeCallCommand(
  args: CallCommandArgs,
  options: ExecuteOptions
): Promise<CommandResult> {
  try {
    // Parse server argument - could be "server" or "server[connId]"
    const parsed = parseConnectionKey(args.server);
    const serverName = parsed.server;
    const connId = args.connId || parsed.connId;

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

    const config = configs.get(serverName);

    if (!config) {
      return {
        success: false,
        error: `Server "${serverName}" not found. Available servers: ${Array.from(configs.keys()).join(', ')}`,
        exitCode: 1,
      };
    }

    const client = new MCPClient();
    const cache = new SchemaCache();
    const pool = options.connectionPool;

    let tools: Tool[] | null = null;
    let schemaFromCache = false;

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
          schemaFromCache = true;
        }
      }
    }

    if (!tools) {
      tools = await client.withConnection(serverName, config, async (conn) => {
        return await client.listTools(conn);
      });
      await cache.set(serverName, tools);
    }

    const meta = schemaFromCache
      ? { fromCache: true, cachedServers: [serverName] }
      : undefined;

    const tool = tools.find(t => t.name === args.tool);
    if (!tool) {
      const toolsList = formatToolsForError(tools, serverName);
      return {
        success: false,
        error: `Error: Tool "${args.tool}" not found on server "${serverName}".${toolsList}`,
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
    const { connection, isPersistent } = await getConnection(serverName, config, client, options.connectionPool, connId);

    try {
      const result = await client.callTool(connection, args.tool, toolArgs, config.requestTimeout);

      // Return raw result in meta - caller handles formatting
      return {
        success: true,
        exitCode: 0,
        meta: {
          ...meta,
          rawResult: {
            server: serverName,
            tool: args.tool,
            result,
          },
        },
      };
    } catch (callError: any) {
      const errorMsg = callError.message || String(callError);
      const toolsList = formatToolsForError(tools, serverName);

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
  } catch (error) {
    return {
      success: false,
      error: `Tool execution failed: ${getErrorMessage(error)}`,
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

  // Fail fast if setConfig property is missing - prevents accidental config clearing
  if (!setConfig) {
    return {
      success: false,
      error: 'setConfig command requires params. Use {extraArgs:[...], requestTimeout:N, env:{...}}',
      exitCode: 1,
    };
  }

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

  const isStdio = isStdioConfig(config);
  const changes: string[] = [];
  let requiresRestart = false;

  // Handle extraArgs (stdio only)
  if ('extraArgs' in setConfig) {
    if (!isStdio) {
      return {
        success: false,
        error: `Server "${server}" is not a stdio server. extraArgs only applies to stdio servers.`,
        exitCode: 1,
      };
    }
    const newExtraArgs = setConfig.extraArgs as string[] | undefined;
    const oldExtraArgs = (config as any).extraArgs;
    if (!extraArgsEqual(oldExtraArgs, newExtraArgs)) {
      (config as any).extraArgs = newExtraArgs;
      requiresRestart = true;
      if (newExtraArgs && newExtraArgs.length > 0) {
        changes.push(`extraArgs=[${newExtraArgs.join(', ')}]`);
      } else {
        changes.push('extraArgs cleared');
      }
    }
  }

  // Handle env (stdio only)
  if ('env' in setConfig) {
    if (!isStdio) {
      return {
        success: false,
        error: `Server "${server}" is not a stdio server. env only applies to stdio servers.`,
        exitCode: 1,
      };
    }
    const newEnv = setConfig.env as Record<string, string> | undefined;
    (config as any).env = newEnv ? { ...(config as any).env, ...newEnv } : undefined;
    requiresRestart = true;
    if (newEnv) {
      changes.push(`env={${Object.keys(newEnv).join(', ')}}`);
    } else {
      changes.push('env cleared');
    }
  }

  // Handle requestTimeout (all transports)
  if ('requestTimeout' in setConfig) {
    const newTimeout = setConfig.requestTimeout as number | undefined;
    config.requestTimeout = newTimeout;
    changes.push(newTimeout ? `requestTimeout=${newTimeout}ms` : 'requestTimeout cleared');
  }

  // Check if server is currently connected
  let serverRunning = false;
  if (connectionPool) {
    const connections = connectionPool.listConnections();
    serverRunning = connections.some(c => c.server === server);
  }

  let message = `Server "${server}" config updated`;
  if (changes.length > 0) {
    message += `: ${changes.join(', ')}`;
  } else {
    message += ' (no changes)';
  }

  if (requiresRestart && serverRunning) {
    message += '\nNote: Server is running. Restart required to apply changes.';
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
  const { server, connId, newConn } = args;
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

    // Get or create connection
    let info;
    if (newConn) {
      info = await connectionPool.getConnectionWithNewId(server, config);
    } else {
      info = await connectionPool.getConnection(server, config, connId);
    }

    // Build connection key for display
    const displayKey = getConnectionKey(server, info.connId);

    // Get stderr from the connection
    const stderr = connectionPool.getStderr(info.connection);

    let output = `Connected to server "${displayKey}"`;
    if (stderr) {
      output += `\n\n[${displayKey}] stderr:\n${stderr}`;
    }

    return {
      success: true,
      output,
      exitCode: 0,
    };
  } catch (error) {
    const displayKey = getConnectionKey(server, connId);
    return {
      success: false,
      error: `Failed to connect to "${displayKey}": ${getErrorMessage(error)}`,
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
  let { server, connId } = args;
  const { connectionPool } = options;

  if (!connectionPool) {
    return {
      success: false,
      error: 'Connection pool not available. This command only works in daemon mode.',
      exitCode: 1,
    };
  }

  // Support full key format: server[id]
  if (!connId) {
    const parsed = parseConnectionKey(server);
    server = parsed.server;
    connId = parsed.connId;
  }

  const displayKey = getConnectionKey(server, connId);

  try {
    await connectionPool.disconnect(server, connId);
    return {
      success: true,
      output: `Disconnected from server "${displayKey}"`,
      exitCode: 0,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to disconnect from "${displayKey}": ${getErrorMessage(error)}`,
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
  let { server, connId } = args;
  const { connectionPool } = options;

  if (!connectionPool) {
    return {
      success: false,
      error: 'Connection pool not available. This command only works in daemon mode.',
      exitCode: 1,
    };
  }

  // Support full key format: server[id]
  if (!connId) {
    const parsed = parseConnectionKey(server);
    server = parsed.server;
    connId = parsed.connId;
  }

  const displayKey = getConnectionKey(server, connId);

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

    await connectionPool.disconnect(server, connId);
    const info = await connectionPool.getConnection(server, config, connId);

    // Get stderr from the connection
    const stderr = connectionPool.getStderr(info.connection);

    let output = `Reconnected to server "${displayKey}"`;
    if (stderr) {
      output += `\n\n[${displayKey}] stderr:\n${stderr}`;
    }

    return {
      success: true,
      output,
      exitCode: 0,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to reconnect to "${displayKey}": ${getErrorMessage(error)}`,
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
      const displayKey = getConnectionKey(conn.server, conn.connId);
      lines.push(`  ${displayKey} (last used: ${lastUsedDate})`);
    }

    return {
      success: true,
      output: lines.join('\n'),
      exitCode: 0,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to list connections: ${getErrorMessage(error)}`,
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
  } catch (error) {
    return {
      success: false,
      error: `Failed to reload config: ${getErrorMessage(error)}`,
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
    case 'usage':
      return executeUsageCommand(args, options);
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
