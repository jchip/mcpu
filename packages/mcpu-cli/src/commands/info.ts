import chalk from 'chalk';
import { ConfigDiscovery } from '../config.ts';
import { MCPClient } from '../client.ts';
import { SchemaCache } from '../cache.ts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface ShowOptions {
  json?: boolean;
  config?: string;
  verbose?: boolean;
  noCache?: boolean;
}

/**
 * Parse server:tool format
 */
function parseToolReference(ref: string): { server: string; tool: string } {
  const parts = ref.split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid tool reference: ${ref}. Use format: server:tool`);
  }
  return { server: parts[0], tool: parts[1] };
}

/**
 * Format JSON schema property for display
 */
function formatProperty(name: string, prop: any, required: boolean): string {
  const requiredMark = required ? '' : '?';
  let typeStr = prop.type || 'any';

  // Handle enum values
  if (prop.enum) {
    typeStr = prop.enum.join('|');
  }

  // Handle arrays
  if (prop.type === 'array' && prop.items) {
    typeStr = `${prop.items.type || 'any'}[]`;
  }

  const desc = prop.description ? ` - ${prop.description}` : '';
  const defaultVal = prop.default !== undefined ? ` (default: ${JSON.stringify(prop.default)})` : '';

  return `  ${chalk.cyan(name)}${requiredMark}  ${chalk.yellow(typeStr)}${desc}${defaultVal}`;
}

/**
 * Show detailed information about one or more tools
 */
export async function showCommand(server: string, tools: string[], options: ShowOptions): Promise<void> {
  const serverName = server;

  const discovery = new ConfigDiscovery({
    configFile: options.config,
    verbose: options.verbose,
  });

  const configs = await discovery.loadConfigs();
  const config = configs.get(serverName);

  if (!config) {
    console.error(chalk.red(`Server "${serverName}" not found.`));
    console.error(`Available servers: ${Array.from(configs.keys()).join(', ')}`);
    process.exit(1);
  }

  const client = new MCPClient();
  const cache = new SchemaCache();

  try {
    // Get available tools from server (from cache or server)
    let availableTools: Tool[] | null = null;
    if (!options.noCache) {
      availableTools = await cache.get(serverName);
      if (options.verbose && availableTools) {
        console.error(chalk.dim(`Using cached tools for ${serverName}`));
      }
    }

    if (!availableTools) {
      if (options.verbose) {
        console.error(chalk.dim(`Connecting to ${serverName}...`));
      }

      availableTools = await client.withConnection(serverName, config, async (conn) => {
        return await client.listTools(conn);
      });

      await cache.set(serverName, availableTools);
    }

    // Process each requested tool
    const results = [];
    for (const toolName of tools) {
      // Find the specific tool
      const tool = availableTools.find(t => t.name === toolName);
      if (!tool) {
        console.error(chalk.red(`Tool "${toolName}" not found on server "${serverName}".`));
        console.error(`Available tools: ${availableTools.map(t => t.name).join(', ')}`);
        process.exit(1);
      }

      if (options.json) {
        // JSON output - compressed schema
        const schema = tool.inputSchema as any;
        const properties = schema?.properties || {};
        const required = schema?.required || [];

        const args = Object.entries(properties).map(([name, prop]: [string, any]) => ({
          name,
          type: prop.type || 'any',
          required: required.includes(name),
          description: prop.description,
          default: prop.default,
          enum: prop.enum,
        }));

        results.push({
          server: serverName,
          tool: toolName,
          description: tool.description,
          arguments: args,
        });
      } else {
        // Human-readable CLI-style output
        console.log();
        console.log(chalk.bold.green(toolName));
        console.log();

        if (tool.description) {
          console.log(tool.description);
          console.log();
        }

        // Show input schema
        const schema = tool.inputSchema as any;
        if (schema && schema.properties) {
          const properties = schema.properties;
          const required = schema?.required || [];

          console.log(chalk.bold('Arguments:'));

          if (Object.keys(properties).length === 0) {
            console.log('  (no arguments)');
          } else {
            for (const [name, prop] of Object.entries(properties)) {
              console.log(formatProperty(name, prop, required.includes(name)));
            }
          }
          console.log();
        }

        // Show example usage
        console.log(chalk.bold('Example:'));
        if (schema && schema.properties) {
          const properties = schema.properties;
          const exampleArgs = Object.keys(properties)
            .slice(0, 2) // Show first 2 args as example
            .map(name => `--${name}=<value>`)
            .join(' ');

          console.log(`  mcpu call ${serverName} ${toolName}${exampleArgs ? ' ' + exampleArgs : ''}`);
        } else {
          console.log(`  mcpu call ${serverName} ${toolName}`);
        }
        console.log();
      }
    }

    // Output JSON results if in JSON mode
    if (options.json) {
      console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
    }
  } catch (error) {
    console.error(chalk.red(`Failed to get tool information:`), error);
    process.exit(1);
  }
}
