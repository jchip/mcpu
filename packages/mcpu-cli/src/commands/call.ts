import colors from 'ansi-colors';
import { parse as parseYaml } from 'yaml';
import { ConfigDiscovery } from '../config.ts';
import { MCPClient } from '../client.ts';
import { SchemaCache } from '../cache.ts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getErrorMessage } from '../utils/error.ts';

export interface CallOptions {
  json?: boolean;
  config?: string;
  verbose?: boolean;
  stdin?: boolean;
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
 * Parse CLI arguments into tool parameters
 * Supports:
 * - --key=value (string by default)
 * - --key:number=123 (explicit number)
 * - --key:boolean=true (explicit boolean)
 * - --key=val1,val2 (comma-separated array)
 */
function parseArgs(args: string[], schema?: any): Record<string, any> {
  const result: Record<string, any> = {};
  const properties = schema?.properties || {};

  for (const arg of args) {
    if (!arg.startsWith('--')) continue;

    const match = arg.match(/^--([^=:]+)(?::([^=]+))?=(.+)$/);
    if (!match) {
      console.error(colors.yellow(`Skipping invalid argument: ${arg}`));
      continue;
    }

    const [, key, explicitType, value] = match;
    const propSchema = properties[key];

    // Determine the type
    let type = explicitType;
    if (!type && propSchema) {
      type = propSchema.type;
    }

    // Convert value based on type
    let convertedValue: any = value;

    if (type === 'number' || type === 'integer') {
      convertedValue = Number(value);
      if (isNaN(convertedValue)) {
        console.error(colors.red(`Invalid number value for ${key}: ${value}`));
        process.exit(1);
      }
    } else if (type === 'boolean') {
      convertedValue = value === 'true' || value === 'yes' || value === '1';
    } else if (type === 'array') {
      convertedValue = value.split(',').map(v => v.trim());
    } else {
      // String (default)
      convertedValue = value;
    }

    result[key] = convertedValue;
  }

  return result;
}

/**
 * Read YAML/JSON from stdin
 */
async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
    process.stdin.on('error', reject);
  });
}

/**
 * Call a tool and return the result
 */
export async function callCommand(
  server: string,
  tool: string,
  args: string[],
  options: CallOptions
): Promise<void> {
  const serverName = server;
  const toolName = tool;

  const discovery = new ConfigDiscovery({
    configFile: options.config,
    verbose: options.verbose,
  });

  const configs = await discovery.loadConfigs();
  const config = configs.get(serverName);

  if (!config) {
    console.error(colors.red(`Server "${serverName}" not found.`));
    console.error(`Available servers: ${Array.from(configs.keys()).join(', ')}`);
    process.exit(1);
  }

  const client = new MCPClient();
  const cache = new SchemaCache();

  try {
    // Get tool schema to help with argument parsing
    let tools: Tool[] | null = await cache.get(serverName);

    if (!tools) {
      if (options.verbose) {
        console.error(colors.dim(`Connecting to ${serverName} to get tool schema...`));
      }

      tools = await client.withConnection(serverName, config, async (conn) => {
        return await client.listTools(conn);
      });

      await cache.set(serverName, tools);
    }

    const tool = tools.find(t => t.name === toolName);
    if (!tool) {
      console.error(colors.red(`Tool "${toolName}" not found on server "${serverName}".`));
      process.exit(1);
    }

    // Parse arguments
    let toolArgs: Record<string, any> = {};

    if (options.stdin) {
      // Read YAML/JSON from stdin
      const inputStr = await readStdin();
      try {
        toolArgs = parseYaml(inputStr);
      } catch (error) {
        console.error(colors.red('Failed to parse YAML/JSON from stdin:'), error);
        process.exit(1);
      }
    } else {
      // Parse CLI arguments
      toolArgs = parseArgs(args, tool.inputSchema);
    }

    if (options.verbose) {
      console.error(colors.dim(`Calling ${serverName}:${toolName} with args:`), toolArgs);
    }

    // Execute the tool
    const result = await client.withConnection(serverName, config, async (conn) => {
      return await client.callTool(conn, toolName, toolArgs, config.requestTimeout);
    });

    // Output result
    if (options.json) {
      console.log(JSON.stringify({ result }, null, 2));
    } else {
      // Try to format nicely for human reading
      if (typeof result === 'string') {
        console.log(result);
      } else if (typeof result === 'object') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result);
      }
    }
  } catch (error) {
    console.error(colors.red('Tool execution failed:'));
    console.error(getErrorMessage(error));
    if (options.verbose && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}
