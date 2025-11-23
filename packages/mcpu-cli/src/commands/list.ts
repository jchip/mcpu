import chalk from 'chalk';
import { ConfigDiscovery } from '../config.ts';
import { MCPClient } from '../client.ts';
import { SchemaCache } from '../cache.ts';
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
 * Extract brief argument summary from tool schema
 * Format: "arg1, arg2=default, arg3?"
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
    let argStr = name;

    // Add type hint for strings with specific values
    if (propSchema.type === 'string' && propSchema.default) {
      argStr += `="${propSchema.default}"`;
    } else if (propSchema.type === 'boolean' && propSchema.default !== undefined) {
      argStr += `=${propSchema.default}`;
    }

    // Mark optional args
    if (!required.has(name)) {
      argStr += '?';
    }

    args.push(argStr);
  }

  return args.length > 0 ? `, args: ${args.join(', ')}` : '';
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
      console.log(chalk.bold(`\nTools from ${chalk.cyan(serverName)}:\n`));

      if (tools.length === 0) {
        console.log(chalk.yellow('  No tools available'));
      } else {
        for (const tool of tools) {
          const briefArgs = formatBriefArgs(tool);
          console.log(`${chalk.green(tool.name)} - ${tool.description || 'No description'}${chalk.dim(briefArgs)}`);
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
        for (const tool of tools) {
          const briefArgs = formatBriefArgs(tool);
          const description = tool.description || 'No description';
          console.log(`  ${chalk.green(tool.name)} - ${description}${chalk.dim(briefArgs)}`);

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
