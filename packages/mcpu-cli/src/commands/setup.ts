import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { ClaudeSettingsSchema, type MCPServerConfig } from '../types.ts';

// Gemini CLI constants
const GEMINI_DIR = '.gemini';
const GEMINI_SETTINGS_FILE = 'settings.json';
const ANTIGRAVITY_CONFIG_FILE = 'antigravity/mcp_config.json';

// Cursor constants
const CURSOR_DIR = '.cursor';
const CURSOR_MCP_FILE = 'mcp.json';

// Codex CLI constants
const CODEX_DIR = '.codex';
const CODEX_CONFIG_FILE = 'config.toml';

/**
 * Check if mcpu-mcp command is available globally
 */
export function isMcpuMcpAvailable(): boolean {
  try {
    // Use 'which' on Unix, 'where' on Windows
    const cmd = platform() === 'win32' ? 'where mcpu-mcp' : 'which mcpu-mcp';
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect if currently running via npx
 */
export function isRunningViaNpx(): boolean {
  // Check npm_execpath for npx
  const execPath = process.env.npm_execpath || '';
  if (execPath.includes('npx')) {
    return true;
  }

  // Check if running from a temp npx cache directory
  const scriptPath = process.argv[1] || '';
  if (scriptPath.includes('_npx') || scriptPath.includes('.npm/_cacache')) {
    return true;
  }

  return false;
}

/**
 * Get the appropriate MCP server config for Claude CLI
 */
export function getMcpuServerConfig(): MCPServerConfig {
  // If mcpu-mcp is globally available, use it directly
  if (isMcpuMcpAvailable()) {
    return {
      command: 'mcpu-mcp',
      args: [],
    };
  }

  // If running via npx, use npx command
  if (isRunningViaNpx()) {
    return {
      command: 'npx',
      args: ['--package=@mcpu/cli', '-c', 'mcpu-mcp'],
    };
  }

  // Fallback: assume global install (will fail if not installed)
  return {
    command: 'mcpu-mcp',
    args: [],
  };
}

export interface ClaudeConfigPaths {
  configDir: string;
  configFile: string;
  projectsDir: string;
}

export interface DiscoveredServers {
  global: Record<string, MCPServerConfig>;
  projects: Record<string, Record<string, MCPServerConfig>>;
}

export interface MigrationPlan {
  servers: Record<string, MCPServerConfig>;
  duplicates: Array<{
    name: string;
    sources: string[];
    kept: string;
  }>;
  sources: {
    desktop?: string;
    cli?: string;
    gemini?: string;
    antigravity?: string;
    cursor?: string;
    codex?: string;
  };
  mcpuConfigPath: string;
}

export interface SetupResult {
  success: boolean;
  message: string;
  plan?: MigrationPlan;
}

/**
 * Get Claude Desktop's config path based on platform
 */
export function getClaudeDesktopConfigPath(): string | null {
  // Honor CLAUDE_DESKTOP_CONFIG_DIR environment variable
  if (process.env.CLAUDE_DESKTOP_CONFIG_DIR) {
    return join(process.env.CLAUDE_DESKTOP_CONFIG_DIR, 'claude_desktop_config.json');
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
    default: // linux and others
      configDir = join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude');
  }

  return join(configDir, 'claude_desktop_config.json');
}

/**
 * Get Claude CLI (Code) config path
 */
export function getClaudeCliConfigPath(): string {
  // Honor CLAUDE_CONFIG_DIR environment variable
  if (process.env.CLAUDE_CONFIG_DIR) {
    return join(process.env.CLAUDE_CONFIG_DIR, 'settings.json');
  }
  return join(homedir(), '.claude.json');
}

/**
 * Get Gemini CLI config directory based on platform
 */
export function getGeminiConfigDir(): string {
  // Honor GEMINI_CONFIG_DIR environment variable
  if (process.env.GEMINI_CONFIG_DIR) {
    return process.env.GEMINI_CONFIG_DIR;
  }
  return join(homedir(), GEMINI_DIR);
}

/**
 * Get Gemini CLI user settings path
 */
export function getGeminiCliConfigPath(): string {
  return join(getGeminiConfigDir(), GEMINI_SETTINGS_FILE);
}

/**
 * Get Antigravity MCP config path
 */
export function getAntigravityConfigPath(): string {
  return join(getGeminiConfigDir(), ANTIGRAVITY_CONFIG_FILE);
}

/**
 * Get Cursor config directory
 */
export function getCursorConfigDir(): string {
  // Honor CURSOR_CONFIG_DIR environment variable
  if (process.env.CURSOR_CONFIG_DIR) {
    return process.env.CURSOR_CONFIG_DIR;
  }
  return join(homedir(), CURSOR_DIR);
}

/**
 * Get Cursor MCP config path
 */
export function getCursorConfigPath(): string {
  return join(getCursorConfigDir(), CURSOR_MCP_FILE);
}

/**
 * Get Codex CLI config directory
 */
export function getCodexConfigDir(): string {
  // Honor CODEX_CONFIG_DIR environment variable
  if (process.env.CODEX_CONFIG_DIR) {
    return process.env.CODEX_CONFIG_DIR;
  }
  return join(homedir(), CODEX_DIR);
}

/**
 * Get Codex CLI config path
 */
export function getCodexConfigPath(): string {
  return join(getCodexConfigDir(), CODEX_CONFIG_FILE);
}

/**
 * Legacy function for backwards compatibility
 */
export function getClaudeConfigPaths(): ClaudeConfigPaths | null {
  const desktopPath = getClaudeDesktopConfigPath();
  if (!desktopPath) return null;

  const configDir = dirname(desktopPath);
  return {
    configDir,
    configFile: desktopPath,
    projectsDir: join(configDir, 'projects'),
  };
}

/**
 * Read and parse Claude Desktop's config file
 */
export function readClaudeConfig(configPath: string): Record<string, MCPServerConfig> | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const data = JSON.parse(content);
    const parsed = ClaudeSettingsSchema.parse(data);
    return parsed.mcpServers || {};
  } catch {
    return null;
  }
}

/**
 * Read Claude CLI (Code) config and extract MCP servers
 * CLI format: { mcpServers: {...}, projects: { "/path": { mcpServers: {...} } } }
 */
export function readClaudeCliConfig(configPath: string): DiscoveredServers | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const data = JSON.parse(content);

    const global: Record<string, MCPServerConfig> = {};
    const projects: Record<string, Record<string, MCPServerConfig>> = {};

    // Read top-level mcpServers (user-level)
    if (data.mcpServers && typeof data.mcpServers === 'object') {
      for (const [name, config] of Object.entries(data.mcpServers)) {
        if (config && typeof config === 'object' && 'command' in config) {
          global[name] = config as MCPServerConfig;
        }
      }
    }

    // Read project-level mcpServers
    if (data.projects && typeof data.projects === 'object') {
      for (const [projectPath, projectData] of Object.entries(data.projects)) {
        const proj = projectData as Record<string, unknown>;
        if (proj.mcpServers && typeof proj.mcpServers === 'object') {
          const projectServers: Record<string, MCPServerConfig> = {};
          for (const [name, config] of Object.entries(proj.mcpServers as Record<string, unknown>)) {
            if (config && typeof config === 'object' && 'command' in config) {
              projectServers[name] = config as MCPServerConfig;
            }
          }
          if (Object.keys(projectServers).length > 0) {
            // Use last path segment as project name for display
            const projectName = projectPath.split('/').pop() || projectPath;
            projects[`cli:${projectName}`] = projectServers;
          }
        }
      }
    }

    return { global, projects };
  } catch {
    return null;
  }
}

/**
 * Read Gemini CLI config and extract MCP servers
 * Gemini CLI format: { mcpServers: {...}, ... }
 */
export function readGeminiCliConfig(configPath: string): Record<string, MCPServerConfig> | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const data = JSON.parse(content);

    const servers: Record<string, MCPServerConfig> = {};

    // Read mcpServers
    if (data.mcpServers && typeof data.mcpServers === 'object') {
      for (const [name, config] of Object.entries(data.mcpServers)) {
        if (config && typeof config === 'object') {
          // Gemini uses 'command' for stdio, 'url' for SSE, 'httpUrl' for HTTP
          const cfg = config as Record<string, unknown>;
          if ('command' in cfg || 'url' in cfg || 'httpUrl' in cfg) {
            servers[name] = config as MCPServerConfig;
          }
        }
      }
    }

    return servers;
  } catch {
    return null;
  }
}

/**
 * Read Codex CLI config and extract MCP servers
 * Codex CLI format (TOML): [mcp_servers.<name>] with command, args, env
 */
export function readCodexCliConfig(configPath: string): Record<string, MCPServerConfig> | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const data = parseToml(content);

    const servers: Record<string, MCPServerConfig> = {};

    // Read mcp_servers section (note: underscore, not hyphen)
    const mcpServers = data.mcp_servers as Record<string, unknown> | undefined;
    if (mcpServers && typeof mcpServers === 'object') {
      for (const [name, config] of Object.entries(mcpServers)) {
        if (config && typeof config === 'object') {
          const cfg = config as Record<string, unknown>;
          // Codex uses 'command' for stdio, 'url' for HTTP
          if ('command' in cfg || 'url' in cfg) {
            // Convert Codex format to MCPServerConfig
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
  } catch {
    return null;
  }
}

/**
 * Read project-level MCP server configs from Claude Desktop's projects directory
 */
export function readProjectConfigs(projectsDir: string): Record<string, Record<string, MCPServerConfig>> {
  const projects: Record<string, Record<string, MCPServerConfig>> = {};

  if (!existsSync(projectsDir)) {
    return projects;
  }

  try {
    const { readdirSync } = require('node:fs');
    const entries = readdirSync(projectsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const projectSettingsPath = join(projectsDir, entry.name, 'settings.json');
      if (!existsSync(projectSettingsPath)) continue;

      try {
        const content = readFileSync(projectSettingsPath, 'utf-8');
        const data = JSON.parse(content);
        const parsed = ClaudeSettingsSchema.parse(data);

        if (parsed.mcpServers && Object.keys(parsed.mcpServers).length > 0) {
          projects[`desktop:${entry.name}`] = parsed.mcpServers;
        }
      } catch {
        // Skip invalid project configs
      }
    }
  } catch {
    // Ignore errors reading projects directory
  }

  return projects;
}

/**
 * Discover all MCP servers from Claude Desktop, Claude CLI, Gemini CLI, Antigravity, Cursor, and Codex
 */
export function discoverServers(): { discovered: DiscoveredServers; sources: { desktop?: string; cli?: string; gemini?: string; antigravity?: string; cursor?: string; codex?: string } } | null {
  const global: Record<string, MCPServerConfig> = {};
  const projects: Record<string, Record<string, MCPServerConfig>> = {};
  const sources: { desktop?: string; cli?: string; gemini?: string; antigravity?: string; cursor?: string; codex?: string } = {};

  // Read Claude Desktop config
  const desktopPath = getClaudeDesktopConfigPath();
  if (desktopPath && existsSync(desktopPath)) {
    sources.desktop = desktopPath;
    const desktopServers = readClaudeConfig(desktopPath);
    if (desktopServers) {
      for (const [name, config] of Object.entries(desktopServers)) {
        global[name] = config;
      }
    }

    // Read Desktop project configs
    const projectsDir = join(dirname(desktopPath), 'projects');
    const desktopProjects = readProjectConfigs(projectsDir);
    Object.assign(projects, desktopProjects);
  }

  // Read Claude CLI config
  const cliPath = getClaudeCliConfigPath();
  if (existsSync(cliPath)) {
    sources.cli = cliPath;
    const cliData = readClaudeCliConfig(cliPath);
    if (cliData) {
      // CLI global servers (merge, Desktop wins on conflict)
      for (const [name, config] of Object.entries(cliData.global)) {
        if (!global[name]) {
          global[name] = config;
        }
      }
      // CLI project servers
      Object.assign(projects, cliData.projects);
    }
  }

  // Read Gemini CLI config
  const geminiPath = getGeminiCliConfigPath();
  if (existsSync(geminiPath)) {
    sources.gemini = geminiPath;
    const geminiServers = readGeminiCliConfig(geminiPath);
    if (geminiServers) {
      // Gemini servers (merge, Desktop and Claude CLI win on conflict)
      for (const [name, config] of Object.entries(geminiServers)) {
        if (!global[name]) {
          global[name] = config;
        }
      }
    }
  }

  // Read Antigravity config (same format as Gemini CLI)
  const antigravityPath = getAntigravityConfigPath();
  if (existsSync(antigravityPath)) {
    sources.antigravity = antigravityPath;
    const antigravityServers = readGeminiCliConfig(antigravityPath);
    if (antigravityServers) {
      // Antigravity servers (merge, others win on conflict)
      for (const [name, config] of Object.entries(antigravityServers)) {
        if (!global[name]) {
          global[name] = config;
        }
      }
    }
  }

  // Read Cursor config (same format as Claude Desktop)
  const cursorPath = getCursorConfigPath();
  if (existsSync(cursorPath)) {
    sources.cursor = cursorPath;
    const cursorServers = readClaudeConfig(cursorPath); // Same format as Claude Desktop
    if (cursorServers) {
      // Cursor servers (merge, others win on conflict)
      for (const [name, config] of Object.entries(cursorServers)) {
        if (!global[name]) {
          global[name] = config;
        }
      }
    }
  }

  // Read Codex CLI config (TOML format)
  const codexPath = getCodexConfigPath();
  if (existsSync(codexPath)) {
    sources.codex = codexPath;
    const codexServers = readCodexCliConfig(codexPath);
    if (codexServers) {
      // Codex servers (merge, others win on conflict)
      for (const [name, config] of Object.entries(codexServers)) {
        if (!global[name]) {
          global[name] = config;
        }
      }
    }
  }

  if (Object.keys(global).length === 0 && Object.keys(projects).length === 0) {
    return null;
  }

  return { discovered: { global, projects }, sources };
}

/**
 * Deduplicate servers - global wins over project-level
 * Skips 'mcpu' itself to avoid circular reference
 */
export function deduplicateServers(discovered: DiscoveredServers): {
  servers: Record<string, MCPServerConfig>;
  duplicates: MigrationPlan['duplicates'];
} {
  const servers: Record<string, MCPServerConfig> = {};
  const duplicates: MigrationPlan['duplicates'] = [];
  const sources: Record<string, string[]> = {};

  // Track all sources for each server name (skip mcpu itself)
  for (const [name] of Object.entries(discovered.global)) {
    if (name === 'mcpu') continue; // Skip mcpu to avoid circular reference
    sources[name] = sources[name] || [];
    sources[name].push('global');
  }

  for (const [projectId, projectServers] of Object.entries(discovered.projects)) {
    for (const [name] of Object.entries(projectServers)) {
      if (name === 'mcpu') continue; // Skip mcpu to avoid circular reference
      sources[name] = sources[name] || [];
      sources[name].push(`project:${projectId}`);
    }
  }

  // Apply global servers first (they win, skip mcpu)
  for (const [name, config] of Object.entries(discovered.global)) {
    if (name === 'mcpu') continue; // Skip mcpu to avoid circular reference
    servers[name] = config;
  }

  // Apply project servers only if not already defined globally (skip mcpu)
  const sortedProjects = Object.keys(discovered.projects).sort();
  for (const projectId of sortedProjects) {
    const projectServers = discovered.projects[projectId];
    for (const [name, config] of Object.entries(projectServers)) {
      if (name === 'mcpu') continue; // Skip mcpu to avoid circular reference
      if (!servers[name]) {
        servers[name] = config;
      }
    }
  }

  // Record duplicates
  for (const [name, srcs] of Object.entries(sources)) {
    if (srcs.length > 1) {
      const kept = srcs.includes('global') ? 'global' : srcs.sort()[0];
      duplicates.push({ name, sources: srcs, kept });
    }
  }

  return { servers, duplicates };
}

/**
 * Get MCPU config path
 */
export function getMcpuConfigPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(configHome, 'mcpu', 'config.json');
}

/**
 * Create migration plan
 */
export function createMigrationPlan(): MigrationPlan | null {
  const result = discoverServers();
  if (!result) {
    return null;
  }

  const { discovered, sources } = result;
  const { servers, duplicates } = deduplicateServers(discovered);

  return {
    servers,
    duplicates,
    sources,
    mcpuConfigPath: getMcpuConfigPath(),
  };
}

/**
 * Save servers to MCPU config (merge with existing)
 */
export function saveMcpuConfig(servers: Record<string, MCPServerConfig>, configPath: string): void {
  const configDir = dirname(configPath);

  // Create directory if needed
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Load existing config
  let existing: Record<string, MCPServerConfig> = {};
  if (existsSync(configPath)) {
    // Create backup
    const backupPath = `${configPath}.mcpu.bak`;
    copyFileSync(configPath, backupPath);

    try {
      const content = readFileSync(configPath, 'utf-8');
      existing = JSON.parse(content);
    } catch {
      // Start fresh if existing config is invalid
    }
  }

  // Merge: new servers take precedence
  const merged = { ...existing, ...servers };

  writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n');
}

/**
 * Update Claude Desktop config to use only MCPU
 */
export function updateClaudeDesktopConfig(configPath: string): void {
  if (!existsSync(configPath)) {
    return;
  }

  // Create backup
  const backupPath = `${configPath}.mcpu.bak`;
  copyFileSync(configPath, backupPath);

  // Read existing config
  const content = readFileSync(configPath, 'utf-8');
  const data = JSON.parse(content);

  // Replace mcpServers with just MCPU
  data.mcpServers = {
    mcpu: {
      command: 'mcpu',
      args: ['mcp'],
    },
  };

  writeFileSync(configPath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Update Claude CLI config to use only MCPU
 * Replaces top-level mcpServers with MCPU and clears all project mcpServers
 * Automatically detects if mcpu-mcp is globally installed or if running via npx
 */
export function updateClaudeCliConfig(configPath: string): void {
  // Get appropriate MCPU server config (detects global install vs npx)
  const mcpuConfig = getMcpuServerConfig();

  // Read existing config or create new one
  let data: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    // Create backup
    const backupPath = `${configPath}.mcpu.bak`;
    copyFileSync(configPath, backupPath);

    try {
      const content = readFileSync(configPath, 'utf-8');
      data = JSON.parse(content);
    } catch {
      // Start fresh if existing config is invalid
    }
  } else {
    // Create directory if needed
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
  }

  // Replace mcpServers with just MCPU
  data.mcpServers = {
    mcpu: mcpuConfig,
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

  writeFileSync(configPath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Update Gemini CLI config to use only MCPU
 * Replaces mcpServers with MCPU
 * Automatically detects if mcpu-mcp is globally installed or if running via npx
 */
export function updateGeminiCliConfig(configPath: string): void {
  if (!existsSync(configPath)) {
    return;
  }

  // Create backup
  const backupPath = `${configPath}.mcpu.bak`;
  copyFileSync(configPath, backupPath);

  // Read existing config
  const content = readFileSync(configPath, 'utf-8');
  const data = JSON.parse(content);

  // Get appropriate MCPU server config (detects global install vs npx)
  const mcpuConfig = getMcpuServerConfig();

  // Replace mcpServers with just MCPU
  data.mcpServers = {
    mcpu: mcpuConfig,
  };

  writeFileSync(configPath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Update Antigravity config to use only MCPU
 */
export function updateAntigravityConfig(configPath: string): void {
  if (!existsSync(configPath)) {
    return;
  }

  // Create backup
  const backupPath = `${configPath}.mcpu.bak`;
  copyFileSync(configPath, backupPath);

  // Read existing config
  const content = readFileSync(configPath, 'utf-8');
  const data = JSON.parse(content);

  // Get appropriate MCPU server config (detects global install vs npx)
  const mcpuConfig = getMcpuServerConfig();

  // Replace mcpServers with just MCPU
  data.mcpServers = {
    mcpu: mcpuConfig,
  };

  writeFileSync(configPath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Update Cursor config to use only MCPU
 * Replaces mcpServers with MCPU
 * Automatically detects if mcpu-mcp is globally installed or if running via npx
 */
export function updateCursorConfig(configPath: string): void {
  // Get appropriate MCPU server config (detects global install vs npx)
  const mcpuConfig = getMcpuServerConfig();

  // Read existing config or create new one
  let data: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    // Create backup
    const backupPath = `${configPath}.mcpu.bak`;
    copyFileSync(configPath, backupPath);

    try {
      const content = readFileSync(configPath, 'utf-8');
      data = JSON.parse(content);
    } catch {
      // Start fresh if existing config is invalid
    }
  } else {
    // Create directory if needed
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
  }

  // Replace mcpServers with just MCPU
  data.mcpServers = {
    mcpu: mcpuConfig,
  };

  writeFileSync(configPath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Update Codex CLI config to use only MCPU
 * Replaces mcp_servers section with just MCPU (TOML format)
 * Automatically detects if mcpu-mcp is globally installed or if running via npx
 */
export function updateCodexConfig(configPath: string): void {
  // Get appropriate MCPU server config (detects global install vs npx)
  // getMcpuServerConfig always returns stdio config with command/args
  const mcpuConfig = getMcpuServerConfig() as { command: string; args?: string[] };

  // Read existing config or create new one
  let data: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    // Create backup
    const backupPath = `${configPath}.mcpu.bak`;
    copyFileSync(configPath, backupPath);

    try {
      const content = readFileSync(configPath, 'utf-8');
      data = parseToml(content) as Record<string, unknown>;
    } catch {
      // Start fresh if existing config is invalid
    }
  } else {
    // Create directory if needed
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
  }

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

  writeFileSync(configPath, stringifyToml(data) + '\n');
}

/**
 * Legacy alias for backwards compatibility
 */
export function updateClaudeConfig(configPath: string): void {
  updateClaudeDesktopConfig(configPath);
}

/**
 * Execute the setup/migration
 */
export async function executeSetup(options: {
  dryRun?: boolean;
  yes?: boolean;
  verbose?: boolean;
}): Promise<SetupResult> {
  const plan = createMigrationPlan();

  if (!plan) {
    return {
      success: false,
      message: 'Could not find any CLI config. Is Claude Desktop, Claude CLI, Gemini CLI, Antigravity, Cursor, or Codex installed?',
    };
  }

  const serverCount = Object.keys(plan.servers).length;

  if (serverCount === 0) {
    return {
      success: false,
      message: 'No MCP servers found in any config.',
      plan, // Include plan so CLI can show which configs were checked
    };
  }

  if (options.dryRun) {
    return {
      success: true,
      message: `Dry run: Would migrate ${serverCount} server(s) to MCPU config.`,
      plan,
    };
  }

  // Execute migration
  saveMcpuConfig(plan.servers, plan.mcpuConfigPath);

  // Update Desktop, CLI, Gemini, Cursor, and Codex configs
  // For sources that were discovered, update them
  // For tools without existing config, also add mcpu to their config
  if (plan.sources.desktop) {
    updateClaudeDesktopConfig(plan.sources.desktop);
  }
  if (plan.sources.cli) {
    updateClaudeCliConfig(plan.sources.cli);
  } else {
    // Add mcpu to Claude CLI even if it wasn't a source
    const cliPath = getClaudeCliConfigPath();
    updateClaudeCliConfig(cliPath);
  }
  if (plan.sources.gemini) {
    updateGeminiCliConfig(plan.sources.gemini);
  }
  if (plan.sources.antigravity) {
    updateAntigravityConfig(plan.sources.antigravity);
  }
  if (plan.sources.cursor) {
    updateCursorConfig(plan.sources.cursor);
  }
  if (plan.sources.codex) {
    updateCodexConfig(plan.sources.codex);
  } else {
    // Add mcpu to Codex CLI even if it wasn't a source
    const codexPath = getCodexConfigPath();
    updateCodexConfig(codexPath);
  }

  return {
    success: true,
    message: `Successfully migrated ${serverCount} server(s) to MCPU.`,
    plan,
  };
}
