import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { ClaudeSettingsSchema, type MCPServerConfig } from '../types.ts';
import { getMcpuServerConfig } from './setup.ts';

/**
 * Base class for AI assistant profiles
 */
export abstract class AIAssistantProfile {
  abstract readonly name: string;
  abstract readonly shortName: string; // For display in sources (e.g., "CLI", "Desktop")
  protected abstract getConfigPath(): string;
  protected abstract getConfigDirEnvVar(): string | undefined;

  get configPath(): string {
    return this.getConfigPath();
  }

  exists(): boolean {
    return existsSync(this.configPath);
  }

  createBackup(): void {
    if (this.exists()) {
      copyFileSync(this.configPath, `${this.configPath}.mcpu.bak`);
    }
  }

  ensureConfigDir(): void {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Read MCP servers from this profile's config
   * Returns null if config doesn't exist or can't be read
   */
  abstract getMcpServers(): Record<string, MCPServerConfig> | null;

  /**
   * Update this profile's config to use only MCPU
   */
  abstract setMcpuOnly(): void;
}

/**
 * Standard JSON-based profile (Claude Desktop, Gemini, Antigravity, Cursor)
 */
abstract class JsonProfile extends AIAssistantProfile {
  protected readJsonConfig(): Record<string, unknown> | null {
    if (!this.exists()) {
      return null;
    }

    try {
      const content = readFileSync(this.configPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  protected writeJsonConfig(data: Record<string, unknown>): void {
    this.ensureConfigDir();
    writeFileSync(this.configPath, JSON.stringify(data, null, 2) + '\n');
  }

  getMcpServers(): Record<string, MCPServerConfig> | null {
    const data = this.readJsonConfig();
    if (!data) return null;

    try {
      const parsed = ClaudeSettingsSchema.parse(data);
      return parsed.mcpServers || {};
    } catch {
      return null;
    }
  }

  setMcpuOnly(): void {
    let data: Record<string, unknown> = {};

    if (this.exists()) {
      this.createBackup();
      data = this.readJsonConfig() || {};
    }

    data.mcpServers = {
      mcpu: getMcpuServerConfig(),
    };

    this.writeJsonConfig(data);
  }
}

/**
 * Claude Desktop profile
 */
export class ClaudeDesktopProfile extends JsonProfile {
  readonly name = 'Claude Desktop';
  readonly shortName = 'Desktop';

  protected getConfigDirEnvVar(): string | undefined {
    return process.env.CLAUDE_DESKTOP_CONFIG_DIR;
  }

  protected getConfigPath(): string {
    if (this.getConfigDirEnvVar()) {
      return join(this.getConfigDirEnvVar()!, 'claude_desktop_config.json');
    }

    const home = homedir();
    const os = platform();

    let configDir: string;
    switch (os) {
      case 'darwin':
        configDir = join(home, 'Library', 'Application Support', 'Claude');
        break;
      case 'win32':
        configDir = join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude');
        break;
      default:
        configDir = join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude');
    }

    return join(configDir, 'claude_desktop_config.json');
  }
}

/**
 * Claude CLI profile
 * Special handling: has both user-level and project-level configs
 */
export class ClaudeCliProfile extends JsonProfile {
  readonly name = 'Claude CLI';
  readonly shortName = 'CLI';

  protected getConfigDirEnvVar(): string | undefined {
    return process.env.CLAUDE_CONFIG_DIR;
  }

  protected getConfigPath(): string {
    if (this.getConfigDirEnvVar()) {
      return join(this.getConfigDirEnvVar()!, '.claude.json');
    }
    return join(homedir(), '.claude', '.claude.json');
  }

  getMcpServers(): Record<string, MCPServerConfig> | null {
    const data = this.readJsonConfig();
    if (!data) return null;

    const servers: Record<string, MCPServerConfig> = {};

    // Read top-level mcpServers (user-level)
    if (data.mcpServers && typeof data.mcpServers === 'object') {
      for (const [name, config] of Object.entries(data.mcpServers)) {
        if (config && typeof config === 'object' && 'command' in config) {
          servers[name] = config as MCPServerConfig;
        }
      }
    }

    return servers;
  }

  setMcpuOnly(): void {
    let data: Record<string, unknown> = {};

    if (this.exists()) {
      this.createBackup();
      data = this.readJsonConfig() || {};
    }

    // Replace mcpServers with just MCPU
    data.mcpServers = {
      mcpu: getMcpuServerConfig(),
    };

    // Clear project-level mcpServers
    if (data.projects && typeof data.projects === 'object') {
      for (const projectData of Object.values(data.projects)) {
        const proj = projectData as Record<string, unknown>;
        if (proj.mcpServers) {
          proj.mcpServers = {};
        }
      }
    }

    this.writeJsonConfig(data);
  }
}

/**
 * Gemini CLI profile
 */
export class GeminiCliProfile extends JsonProfile {
  readonly name = 'Gemini CLI';
  readonly shortName = 'Gemini';

  protected getConfigDirEnvVar(): string | undefined {
    return process.env.GEMINI_CONFIG_DIR;
  }

  protected getConfigPath(): string {
    const configDir = this.getConfigDirEnvVar() || join(homedir(), '.gemini');
    return join(configDir, 'settings.json');
  }

  getMcpServers(): Record<string, MCPServerConfig> | null {
    const data = this.readJsonConfig();
    if (!data) return null;

    const servers: Record<string, MCPServerConfig> = {};

    // Gemini uses 'command' for stdio, 'url' for SSE, 'httpUrl' for HTTP
    if (data.mcpServers && typeof data.mcpServers === 'object') {
      for (const [name, config] of Object.entries(data.mcpServers)) {
        if (config && typeof config === 'object') {
          const cfg = config as Record<string, unknown>;
          if ('command' in cfg || 'url' in cfg || 'httpUrl' in cfg) {
            servers[name] = config as MCPServerConfig;
          }
        }
      }
    }

    return servers;
  }
}

/**
 * Antigravity profile (uses Gemini format)
 */
export class AntigravityProfile extends JsonProfile {
  readonly name = 'Antigravity';
  readonly shortName = 'Antigravity';

  protected getConfigDirEnvVar(): string | undefined {
    return process.env.GEMINI_CONFIG_DIR;
  }

  protected getConfigPath(): string {
    const configDir = this.getConfigDirEnvVar() || join(homedir(), '.gemini');
    return join(configDir, 'antigravity', 'mcp_config.json');
  }

  getMcpServers(): Record<string, MCPServerConfig> | null {
    const data = this.readJsonConfig();
    if (!data) return null;

    const servers: Record<string, MCPServerConfig> = {};

    if (data.mcpServers && typeof data.mcpServers === 'object') {
      for (const [name, config] of Object.entries(data.mcpServers)) {
        if (config && typeof config === 'object') {
          const cfg = config as Record<string, unknown>;
          if ('command' in cfg || 'url' in cfg || 'httpUrl' in cfg) {
            servers[name] = config as MCPServerConfig;
          }
        }
      }
    }

    return servers;
  }
}

/**
 * Cursor profile
 */
export class CursorProfile extends JsonProfile {
  readonly name = 'Cursor';
  readonly shortName = 'Cursor';

  protected getConfigDirEnvVar(): string | undefined {
    return process.env.CURSOR_CONFIG_DIR;
  }

  protected getConfigPath(): string {
    const configDir = this.getConfigDirEnvVar() || join(homedir(), '.cursor');
    return join(configDir, 'mcp.json');
  }
}

/**
 * Codex CLI profile (TOML format, different structure)
 */
export class CodexCliProfile extends AIAssistantProfile {
  readonly name = 'Codex CLI';
  readonly shortName = 'Codex';

  protected getConfigDirEnvVar(): string | undefined {
    return process.env.CODEX_CONFIG_DIR;
  }

  protected getConfigPath(): string {
    const configDir = this.getConfigDirEnvVar() || join(homedir(), '.codex');
    return join(configDir, 'config.toml');
  }

  private readTomlConfig(): Record<string, unknown> | null {
    if (!this.exists()) {
      return null;
    }

    try {
      const content = readFileSync(this.configPath, 'utf-8');
      return parseToml(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private writeTomlConfig(data: Record<string, unknown>): void {
    this.ensureConfigDir();
    writeFileSync(this.configPath, stringifyToml(data) + '\n');
  }

  getMcpServers(): Record<string, MCPServerConfig> | null {
    const data = this.readTomlConfig();
    if (!data) return null;

    const servers: Record<string, MCPServerConfig> = {};

    // Read mcp_servers section (note: underscore, not hyphen)
    const mcpServers = data.mcp_servers as Record<string, unknown> | undefined;
    if (mcpServers && typeof mcpServers === 'object') {
      for (const [name, config] of Object.entries(mcpServers)) {
        if (config && typeof config === 'object') {
          const cfg = config as Record<string, unknown>;
          if ('command' in cfg || 'url' in cfg) {
            const serverConfig: MCPServerConfig = {
              command: cfg.command as string,
            };
            if (cfg.args) {
              serverConfig.args = cfg.args as string[];
            }
            if (cfg.env && typeof cfg.env === 'object') {
              serverConfig.env = cfg.env as Record<string, string>;
            }
            servers[name] = serverConfig;
          }
        }
      }
    }

    return servers;
  }

  setMcpuOnly(): void {
    let data: Record<string, unknown> = {};

    if (this.exists()) {
      this.createBackup();
      data = this.readTomlConfig() || {};
    }

    // Get MCPU config (always stdio with command/args)
    const mcpuConfig = getMcpuServerConfig() as { command: string; args?: string[] };

    // Replace mcp_servers with just MCPU (note: underscore for Codex)
    const mcpuTomlConfig: Record<string, unknown> = {
      command: mcpuConfig.command,
    };
    if (mcpuConfig.args && mcpuConfig.args.length > 0) {
      mcpuTomlConfig.args = mcpuConfig.args;
    }

    data.mcp_servers = {
      mcpu: mcpuTomlConfig,
    };

    this.writeTomlConfig(data);
  }
}

/**
 * Get all profiles in priority order (Desktop wins, then CLI, etc.)
 */
export function getAllProfiles(): AIAssistantProfile[] {
  return [
    new ClaudeDesktopProfile(),
    new ClaudeCliProfile(),
    new GeminiCliProfile(),
    new AntigravityProfile(),
    new CursorProfile(),
    new CodexCliProfile(),
  ];
}
