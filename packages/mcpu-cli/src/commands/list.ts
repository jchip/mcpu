import chalk from 'chalk';
import { ConfigDiscovery } from '../config.ts';
import { MCPClient } from '../client.ts';
import { SchemaCache } from '../cache.ts';
import { abbreviateType, LEGEND_HEADER, TYPES_LINE } from '../formatters.ts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface ListOptions {
  servers?: string[];
  json?: boolean;
  config?: string;
  verbose?: boolean;
  noCache?: boolean;
}

/**
 * Estimate token count for tool listings
 * Rough estimate: 1 token ≈ 4 characters
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Format object type with its properties
 */
function formatObjectType(propSchema: any): string {
  if (propSchema.type !== 'object' || !propSchema.properties) {
    return 'o';
  }

  const props = propSchema.properties;
  const required = new Set(propSchema.required || []);
  const propStrs: string[] = [];

  // Limit to first 4 properties to keep it compact
  const propEntries = Object.entries(props).slice(0, 4);
  const hasMore = Object.keys(props).length > 4;

  for (const [name, prop] of propEntries) {
    const p = prop as any;
    let typeStr = 'any';

    if (p.type) {
      if (Array.isArray(p.type)) {
        typeStr = p.type.map(abbreviateType).join('|');
      } else {
        typeStr = abbreviateType(p.type);
      }
    }

    const opt = required.has(name) ? '' : '?';
    propStrs.push(`${name}${opt}:${typeStr}`);
  }

  const propsStr = propStrs.join(',');
  const ellipsis = hasMore ? ',...' : '';
  return `o{${propsStr}${ellipsis}}`;
}

/**
 * Extract brief argument summary from tool schema
 * Format: "required_params, optional_params?"
 * @param tool - The tool to format
 * @param skipComplexCheck - If true, always show full params (for servers with few tools)
 */
function formatBriefArgs(tool: Tool, skipComplexCheck = false): string {
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

  const requiredArgs: string[] = [];
  const optionalArgs: string[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    const propSchema = prop as any;

    // Determine type string
    let typeStr = 'any';

    if (propSchema.type) {
      // Handle union types (array of types)
      if (Array.isArray(propSchema.type)) {
        typeStr = propSchema.type.map(abbreviateType).join('|');
      }
      // Handle object type with properties
      else if (propSchema.type === 'object') {
        typeStr = formatObjectType(propSchema);
      }
      // Handle array type
      else if (propSchema.type === 'array' && propSchema.items) {
        // Check if array items are objects with properties
        if (propSchema.items.type === 'object' && propSchema.items.properties) {
          typeStr = `${formatObjectType(propSchema.items)}[]`;
        } else {
          const itemType = Array.isArray(propSchema.items.type)
            ? propSchema.items.type.map(abbreviateType).join('|')
            : abbreviateType(propSchema.items.type || 'any');
          typeStr = `${itemType}[]`;
        }
      } else {
        typeStr = abbreviateType(propSchema.type);
      }
    }

    // Handle enums (override type)
    if (propSchema.enum) {
      typeStr = propSchema.enum.join('|');
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
  const isFullComplex = paramCount > 10 || fullParamsStr.length > 160;
  const isRequiredComplex = requiredArgs.length > 10 || requiredParamsStr.length > 160;

  // If full list is too complex, try showing only required params
  if (isFullComplex && !skipComplexCheck) {
    if (isRequiredComplex || requiredArgs.length === 0) {
      // Even required params are too complex, or no required params
      return ' PARAMS: (use info for details)';
    } else {
      // Show only required params with indicator
      return ` PARAMS: ${requiredParamsStr} (+${optionalArgs.length} optional)`;
    }
  }

  // Show all params
  return ` PARAMS: ${fullParamsStr}`;
}

/**
 * List tools from specific servers or all servers
 */
export async function listCommand(options: ListOptions): Promise<void> {
  const discovery = new ConfigDiscovery({
    configFile: options.config,
    verbose: options.verbose,
  });

  const configs = await discovery.loadConfigs();
  const client = new MCPClient();
  const cache = new SchemaCache();

  if (configs.size === 0) {
    console.error(chalk.red('No MCP servers configured.'));
    console.error('Run `mcpu servers` for configuration help.');
    process.exit(1);
  }

  // If servers are specified, list tools from those servers only
  if (options.servers && options.servers.length > 0) {
    const serversToQuery = new Map();

    for (const serverName of options.servers) {
      const config = configs.get(serverName);
      if (!config) {
        console.error(chalk.red(`Server "${serverName}" not found.`));
        console.error(`Available servers: ${Array.from(configs.keys()).join(', ')}`);
        process.exit(1);
      }
      serversToQuery.set(serverName, config);
    }

    if (serversToQuery.size === 1) {
      const [[serverName, config]] = serversToQuery.entries();
      await listServerTools(serverName, config, client, cache, options);
    } else {
      await listAllTools(serversToQuery, client, cache, options);
    }
    return;
  }

  // List tools from all servers
  await listAllTools(configs, client, cache, options);
}

/**
 * List tools from a specific server
 */
async function listServerTools(
  serverName: string,
  config: any,
  client: MCPClient,
  cache: SchemaCache,
  options: ListOptions
): Promise<void> {
  try {
    // Try cache first (with per-server TTL)
    let tools: Tool[] | null = null;
    if (!options.noCache) {
      tools = await cache.get(serverName, config.cacheTTL);
      if (options.verbose && tools) {
        console.error(chalk.dim(`Using cached tools for ${serverName}`));
      }
    }

    // Fetch from server if not cached
    if (!tools) {
      if (options.verbose) {
        console.error(chalk.dim(`Connecting to ${serverName}...`));
      }

      tools = await client.withConnection(serverName, config, async (conn) => {
        return await client.listTools(conn);
      });

      // Cache the results
      await cache.set(serverName, tools);
    }

    if (options.json) {
      // JSON output
      console.log(JSON.stringify({
        server: serverName,
        tools: tools.map(t => ({
          name: t.name,
          description: t.description,
        })),
        total: tools.length,
      }, null, 2));
    } else {
      // Human-readable output
      console.log(chalk.dim(`${LEGEND_HEADER}\n${TYPES_LINE}\n`));
      console.log(chalk.bold(`Tools from ${chalk.cyan(serverName)}:\n`));

      if (tools.length === 0) {
        console.log(chalk.yellow('  No tools available'));
      } else {
        const skipComplexCheck = tools.length <= 3;
        for (const tool of tools) {
          const briefArgs = formatBriefArgs(tool, skipComplexCheck);
          // Only show first line of description
          const description = (tool.description || 'No description').split('\n')[0].trim();
          console.log(`  - ${chalk.green(tool.name)} - ${description}${chalk.dim(briefArgs)}`);
        }
      }

      console.log(chalk.dim(`\nTotal: ${tools.length} tool${tools.length === 1 ? '' : 's'}`));
    }
  } catch (error) {
    console.error(chalk.red(`Failed to list tools from ${serverName}:`), error);
    process.exit(1);
  }
}

/**
 * List tools from all servers (flat list)
 */
async function listAllTools(
  configs: Map<string, any>,
  client: MCPClient,
  cache: SchemaCache,
  options: ListOptions
): Promise<void> {
  const allTools: Array<{ server: string; tool: Tool }> = [];
  let totalTokens = 0;

  for (const [serverName, config] of configs.entries()) {
    try {
      // Try cache first (with per-server TTL)
      let tools: Tool[] | null = null;
      if (!options.noCache) {
        tools = await cache.get(serverName, config.cacheTTL);
        if (options.verbose && tools) {
          console.error(chalk.dim(`Using cached tools for ${serverName}`));
        }
      }

      // Fetch from server if not cached
      if (!tools) {
        if (options.verbose) {
          console.error(chalk.dim(`Connecting to ${serverName}...`));
        }

        tools = await client.withConnection(serverName, config, async (conn) => {
          return await client.listTools(conn);
        });

        // Cache the results
        await cache.set(serverName, tools);
      }

      // Add to flat list
      for (const tool of tools) {
        allTools.push({ server: serverName, tool });
      }
    } catch (error) {
      if (options.verbose) {
        console.error(chalk.yellow(`Failed to connect to ${serverName}:`), error);
      }
    }
  }

  if (options.json) {
    // JSON output
    console.log(JSON.stringify({
      tools: allTools.map(({ server, tool }) => ({
        server,
        name: tool.name,
        description: tool.description,
      })),
      total: allTools.length,
      servers: configs.size,
    }, null, 2));
  } else {
    // Human-readable output
    console.log(chalk.bold('\nAll Available Tools:\n'));
    console.log(chalk.dim('Types: s=string, i=integer, n=number, z=null, b=bool, o=object\n'));

    if (allTools.length === 0) {
      console.log(chalk.yellow('No tools available'));
    } else {
      // Group by server
      const toolsByServer = new Map<string, Tool[]>();
      for (const { server, tool } of allTools) {
        if (!toolsByServer.has(server)) {
          toolsByServer.set(server, []);
        }
        toolsByServer.get(server)!.push(tool);
      }

      // Display grouped by server
      for (const [server, tools] of toolsByServer.entries()) {
        console.log(chalk.bold(`MCP server ${chalk.cyan(server)}:`));
        const skipComplexCheck = tools.length <= 3;
        for (const tool of tools) {
          const briefArgs = formatBriefArgs(tool, skipComplexCheck);
          // Only show first line of description
          const description = (tool.description || 'No description').split('\n')[0].trim();
          console.log(`  - ${chalk.green(tool.name)} - ${description}${chalk.dim(briefArgs)}`);

          // Estimate tokens for this entry
          totalTokens += estimateTokens(`${tool.name} - ${description}${briefArgs}\n`);
        }
        console.log();
      }
    }

    console.log();
    console.log(chalk.dim(`Total: ${allTools.length} tools across ${configs.size} servers`));
    console.log(chalk.dim(`Estimated tokens: ~${totalTokens}`));
  }
}
