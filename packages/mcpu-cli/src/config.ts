import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { ProjectMCPConfigSchema, type MCPServerConfig, isStdioConfig, type StdioConfig, type ServerAutoSaveConfig, type ToolAutoSaveConfig } from './types.ts';

/**
 * Resolved auto-save config (all fields required after merge)
 */
export interface ResolvedAutoSaveConfig {
  enabled: boolean;
  thresholdSize: number;
  dir: string;
  previewSize: number;
}

/**
 * Response auto-save configuration defaults
 */
export const AUTO_SAVE_DEFAULTS: ResolvedAutoSaveConfig = {
  enabled: true,
  thresholdSize: 10240, // 10KB
  dir: '.temp/mcpu-responses',
  previewSize: 500,
};

/**
 * Extended server config with autoSaveResponse
 */
export type ExtendedServerConfig = MCPServerConfig & {
  autoSaveResponse?: ServerAutoSaveConfig;
};

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
  private configs: Map<string, ExtendedServerConfig> = new Map();
  private globalAutoSave: Partial<ResolvedAutoSaveConfig> = {};
  private resolvedCache: Map<string, ResolvedAutoSaveConfig> = new Map(); // memoize: "server:tool" -> config
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

    // Extract global autoSaveResponse config (if present)
    if (data.autoSaveResponse && typeof data.autoSaveResponse === 'object') {
      const global = data.autoSaveResponse;
      if (typeof global.enabled === 'boolean') this.globalAutoSave.enabled = global.enabled;
      if (typeof global.thresholdSize === 'number') this.globalAutoSave.thresholdSize = global.thresholdSize;
      if (typeof global.dir === 'string') this.globalAutoSave.dir = global.dir;
      if (typeof global.previewSize === 'number') this.globalAutoSave.previewSize = global.previewSize;
    }

    // MCPU format (direct server configs object)
    // Filter out global config key before parsing servers
    const serverData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key !== 'autoSaveResponse') {
        serverData[key] = value;
      }
    }

    const mcpConfig = ProjectMCPConfigSchema.parse(serverData);
    for (const [name, config] of Object.entries(mcpConfig)) {
      // Skip disabled servers (enabled: false)
      if (config.enabled === false) {
        if (this.options.verbose) {
          console.error(`Skipping disabled server: ${name}`);
        }
        continue;
      }
      // Preserve autoSaveResponse from original data if present
      const extConfig = this.normalizeConfig(config) as ExtendedServerConfig;
      const originalServer = data[name] as any;
      if (originalServer?.autoSaveResponse !== undefined) {
        extConfig.autoSaveResponse = originalServer.autoSaveResponse;
      }
      this.configs.set(name, extConfig);
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
  getServer(name: string): ExtendedServerConfig | undefined {
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
  getAllServers(): Map<string, ExtendedServerConfig> {
    return this.configs;
  }

  /**
   * Get resolved auto-save config for a server/tool combination.
   * Merges: defaults <- global <- server <- tool (byTools)
   * Results are memoized per server:tool key.
   */
  getAutoSaveConfig(server: string, tool: string): ResolvedAutoSaveConfig {
    const cacheKey = `${server}:${tool}`;

    // Return memoized result if available
    const cached = this.resolvedCache.get(cacheKey);
    if (cached) return cached;

    // Start with defaults
    const resolved: ResolvedAutoSaveConfig = { ...AUTO_SAVE_DEFAULTS };

    // Merge global config
    if (this.globalAutoSave.enabled !== undefined) resolved.enabled = this.globalAutoSave.enabled;
    if (this.globalAutoSave.thresholdSize !== undefined) resolved.thresholdSize = this.globalAutoSave.thresholdSize;
    if (this.globalAutoSave.dir !== undefined) resolved.dir = this.globalAutoSave.dir;
    if (this.globalAutoSave.previewSize !== undefined) resolved.previewSize = this.globalAutoSave.previewSize;

    // Merge server-level config
    const serverConfig = this.configs.get(server)?.autoSaveResponse;
    if (serverConfig) {
      if (serverConfig.enabled !== undefined) resolved.enabled = serverConfig.enabled;
      if (serverConfig.thresholdSize !== undefined) resolved.thresholdSize = serverConfig.thresholdSize;
      if (serverConfig.dir !== undefined) resolved.dir = serverConfig.dir;
      if (serverConfig.previewSize !== undefined) resolved.previewSize = serverConfig.previewSize;

      // Merge tool-level config (byTools)
      const toolConfig = serverConfig.byTools?.[tool];
      if (toolConfig) {
        if (toolConfig.enabled !== undefined) resolved.enabled = toolConfig.enabled;
        if (toolConfig.thresholdSize !== undefined) resolved.thresholdSize = toolConfig.thresholdSize;
        if (toolConfig.dir !== undefined) resolved.dir = toolConfig.dir;
        if (toolConfig.previewSize !== undefined) resolved.previewSize = toolConfig.previewSize;
      }
    }

    // Memoize and return
    this.resolvedCache.set(cacheKey, resolved);
    return resolved;
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
