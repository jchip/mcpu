import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { ProjectMCPConfigSchema, type MCPServerConfig, isStdioConfig, type StdioConfig } from './types.ts';

/**
 * Discovers MCP server configurations from multiple sources:
 * 1. --config flag (explicit config file)
 * 2. .config/mcpu/config.local.json in current directory (project local, gitignored)
 * 3. .config/mcpu/config.json in current directory (project shared, committed)
 * 4. $XDG_CONFIG_HOME/mcpu/config.json or ~/.config/mcpu/config.json (user config, follows XDG)
 *
 * Configs are merged with higher priority sources overwriting lower priority.
 */
export class ConfigDiscovery {
  private configs: Map<string, MCPServerConfig> = new Map();
  private options: {
    configFile?: string;
    verbose?: boolean;
  };

  constructor(options: {
    configFile?: string;
    verbose?: boolean;
  } = {}) {
    this.options = options;
  }

  async loadConfigs(cwd?: string): Promise<Map<string, MCPServerConfig>> {
    // Get XDG_CONFIG_HOME or fall back to ~/.config
    const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');

    // Use provided cwd or fall back to process.cwd()
    const workingDir = cwd || process.cwd();

    // Priority order (highest to lowest)
    const sources = [
      // 1. Explicit config file
      this.options.configFile,

      // 2. Project local config (gitignored)
      join(workingDir, '.config', 'mcpu', 'config.local.json'),

      // 3. Project shared config (committed)
      join(workingDir, '.config', 'mcpu', 'config.json'),

      // 4. User config (XDG)
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
      // Skip disabled servers (enabled: false)
      if (config.enabled === false) {
        if (this.options.verbose) {
          console.error(`Skipping disabled server: ${name}`);
        }
        continue;
      }
      this.configs.set(name, this.normalizeConfig(config));
    }
  }

  private normalizeConfig(config: MCPServerConfig): MCPServerConfig {
    // HTTP configs don't need normalization
    if (!isStdioConfig(config)) {
      return config;
    }

    // Only resolve relative paths (./foo or ../foo)
    // - ./blah or ../blah → resolve relative to CWD
    // - /blah → absolute, use as-is
    // - blah → bare command, let shell find via PATH
    const isRelativePath = config.command.startsWith('./') || config.command.startsWith('../');
    const command = isRelativePath ? resolve(config.command) : config.command;

    return {
      ...config,
      command,
    } as StdioConfig;
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
