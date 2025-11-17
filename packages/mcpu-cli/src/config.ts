import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { ProjectMCPConfigSchema, type MCPServerConfig } from './types.js';

/**
 * Discovers MCP server configurations from multiple sources:
 * 1. --config flag (explicit config file)
 * 2. .config/mcpu/config.local.json in current directory (local project config, gitignored)
 * 3. $XDG_CONFIG_HOME/mcpu/config.json or ~/.config/mcpu/config.json (user config, follows XDG)
 *
 * Configs are merged with later sources taking precedence.
 */
export class ConfigDiscovery {
  private configs: Map<string, MCPServerConfig> = new Map();

  constructor(private options: {
    configFile?: string;
    verbose?: boolean;
  } = {}) {}

  async loadConfigs(): Promise<Map<string, MCPServerConfig>> {
    // Get XDG_CONFIG_HOME or fall back to ~/.config
    const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');

    // Priority order (highest to lowest)
    const sources = [
      // 1. Explicit config file
      this.options.configFile,

      // 2. Local project config
      join(process.cwd(), '.config', 'mcpu', 'config.local.json'),

      // 3. User config (XDG)
      join(configHome, 'mcpu', 'config.json'),
    ];

    // Load in reverse order so higher priority overwrites lower
    for (const source of sources.reverse()) {
      if (!source || !existsSync(source)) continue;

      try {
        await this.loadConfigFile(source);
        if (this.options.verbose) {
          console.error(`Loaded config from: ${source}`);
        }
      } catch (error) {
        if (this.options.verbose) {
          console.error(`Failed to load ${source}:`, error);
        }
      }
    }

    return this.configs;
  }

  private async loadConfigFile(filepath: string): Promise<void> {
    const content = await readFile(filepath, 'utf-8');
    const data = JSON.parse(content);

    // MCPU format (direct server configs object)
    const mcpConfig = ProjectMCPConfigSchema.parse(data);
    for (const [name, config] of Object.entries(mcpConfig)) {
      this.configs.set(name, this.normalizeConfig(config));
    }
  }

  private normalizeConfig(config: MCPServerConfig): MCPServerConfig {
    // HTTP configs don't need normalization
    if ('url' in config) {
      return config;
    }

    // Don't resolve common CLI tools like npx, node, etc
    const commonCLIs = ['npx', 'node', 'python', 'python3', 'uv', 'uvx'];

    const shouldResolve = !commonCLIs.includes(config.command) &&
                          !config.command.startsWith('/');

    const command = shouldResolve ? resolve(config.command) : config.command;

    return {
      ...config,
      command,
    };
  }

  /**
   * Get a specific server config by name
   */
  getServer(name: string): MCPServerConfig | undefined {
    return this.configs.get(name);
  }

  /**
   * Get all server names
   */
  getServerNames(): string[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Get all server configs
   */
  getAllServers(): Map<string, MCPServerConfig> {
    return this.configs;
  }
}

// Example config format:
/*
// .config/mcpu/config.local.json (project) or ~/.config/mcpu/config.json (user)
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
  },
  "github": {
    "command": "uvx",
    "args": ["mcp-server-github"],
    "env": {
      "GITHUB_TOKEN": "..."
    }
  },
  "playwright": {
    "type": "http",
    "url": "http://localhost:9000/mcp"
  }
}
*/
