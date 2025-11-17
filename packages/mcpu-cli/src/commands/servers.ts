import chalk from 'chalk';
import { ConfigDiscovery } from '../config.js';
import { MCPClient } from '../client.js';

export interface ServersOptions {
  json?: boolean;
  config?: string;
  verbose?: boolean;
  tools?: 'names' | 'desc';
}

export async function serversCommand(options: ServersOptions): Promise<void> {
  const discovery = new ConfigDiscovery({
    configFile: options.config,
    verbose: options.verbose,
  });

  const configs = await discovery.loadConfigs();
  const client = new MCPClient();

  // Fetch server info (including description) for each server
  const serverInfos = new Map<string, { description?: string; toolCount?: number; tools?: Array<{ name: string; description?: string }> }>();

  for (const [name, config] of configs.entries()) {
    try {
      const info = await client.withConnection(name, config, async (conn) => {
        const tools = await client.listTools(conn);
        // Get server info from the connection (set during initialize)
        const serverInfo = (conn.client as any)._serverVersion;
        const description = serverInfo?.name ?
          `${serverInfo.name}${serverInfo.version ? ` v${serverInfo.version}` : ''}` :
          undefined;
        return {
          description,
          toolCount: tools.length,
          tools: options.tools ? tools.map(t => ({ name: t.name, description: t.description })) : undefined
        };
      });
      serverInfos.set(name, info);
    } catch (error) {
      if (options.verbose) {
        console.error(chalk.yellow(`Failed to connect to ${name}:`), error);
      }
      serverInfos.set(name, {});
    }
  }

  if (options.json) {
    // JSON output
    const servers = Array.from(configs.entries()).map(([name, config]) => ({
      name,
      ...config,
    }));

    console.log(JSON.stringify({
      servers,
      total: servers.length,
    }, null, 2));
  } else {
    // Human-readable output
    if (configs.size === 0) {
      console.log(chalk.yellow('No MCP servers configured.'));
      console.log();
      console.log('Configure servers in one of these locations:');
      console.log('  - .mcpu.local.json (local project config, gitignored)');
      console.log('  - ~/.claude/settings.json (Claude user settings)');
      console.log('  - ~/.mcpu/config.json (MCPU user config)');
      return;
    }

    console.log(chalk.bold(`Configured MCP Servers:\n`));

    for (const [name, config] of configs.entries()) {
      const info = serverInfos.get(name);

      console.log(chalk.cyan(name));

      // Show description if available
      if (info?.description) {
        console.log(`  ${chalk.dim(info.description)}`);
      }

      // Show tool count
      if (info?.toolCount !== undefined) {
        console.log(`  ${chalk.dim(`${info.toolCount} tool${info.toolCount === 1 ? '' : 's'}`)}`);
      }

      if ('url' in config) {
        // HTTP transport
        console.log(`  Type: http`);
        console.log(`  URL: ${config.url}`);
      } else {
        // stdio transport
        console.log(`  Command: ${config.command}`);
        if (config.args && config.args.length > 0) {
          console.log(`  Args: ${config.args.join(' ')}`);
        }
      }

      // Show tools if requested
      if (options.tools && info?.tools) {
        console.log();
        console.log(chalk.dim('  Tools:'));
        for (const tool of info.tools) {
          if (options.tools === 'names') {
            console.log(`    ${chalk.green(tool.name)}`);
          } else if (options.tools === 'desc') {
            console.log(`    ${chalk.green(tool.name)} - ${tool.description || 'No description'}`);
          }
        }
      }

      console.log();
    }

    console.log(chalk.dim(`Total: ${configs.size} server${configs.size === 1 ? '' : 's'}`));
  }
}
