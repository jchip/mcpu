import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { ClaudeSettingsSchema, type MCPServerConfig } from '../types.ts';

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
  claudeConfigPath: string;
  mcpuConfigPath: string;
}

export interface SetupResult {
  success: boolean;
  message: string;
  plan?: MigrationPlan;
}

/**
 * Get Claude Desktop's config directory path based on platform and environment
 * Note: CLAUDE_DESKTOP_CONFIG_DIR can override the location (different from CLAUDE_CONFIG_DIR which is for Claude Code CLI)
 */
export function getClaudeConfigPaths(): ClaudeConfigPaths | null {
  // Honor CLAUDE_DESKTOP_CONFIG_DIR environment variable (for overriding Claude Desktop config location)
  if (process.env.CLAUDE_DESKTOP_CONFIG_DIR) {
    const configDir = process.env.CLAUDE_DESKTOP_CONFIG_DIR;
    return {
      configDir,
      configFile: join(configDir, 'claude_desktop_config.json'),
      projectsDir: join(configDir, 'projects'),
    };
  }

  const home = homedir();
  const os = platform();

  // Claude Desktop uses standard app config locations, NOT CLAUDE_CONFIG_DIR (which is for Claude Code CLI)
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

  return {
    configDir,
    configFile: join(configDir, 'claude_desktop_config.json'),
    projectsDir: join(configDir, 'projects'),
  };
}

/**
 * Read and parse Claude's main config file
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
 * Read project-level MCP server configs from Claude's projects directory
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
          projects[entry.name] = parsed.mcpServers;
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
 * Discover all MCP servers from Claude's config
 */
export function discoverServers(): DiscoveredServers | null {
  const paths = getClaudeConfigPaths();
  if (!paths) {
    return null;
  }

  const global = readClaudeConfig(paths.configFile) || {};
  const projects = readProjectConfigs(paths.projectsDir);

  return { global, projects };
}

/**
 * Deduplicate servers - global wins over project-level
 */
export function deduplicateServers(discovered: DiscoveredServers): {
  servers: Record<string, MCPServerConfig>;
  duplicates: MigrationPlan['duplicates'];
} {
  const servers: Record<string, MCPServerConfig> = {};
  const duplicates: MigrationPlan['duplicates'] = [];
  const sources: Record<string, string[]> = {};

  // Track all sources for each server name
  for (const [name] of Object.entries(discovered.global)) {
    sources[name] = sources[name] || [];
    sources[name].push('global');
  }

  for (const [projectId, projectServers] of Object.entries(discovered.projects)) {
    for (const [name] of Object.entries(projectServers)) {
      sources[name] = sources[name] || [];
      sources[name].push(`project:${projectId}`);
    }
  }

  // Apply global servers first (they win)
  for (const [name, config] of Object.entries(discovered.global)) {
    servers[name] = config;
  }

  // Apply project servers only if not already defined globally
  const sortedProjects = Object.keys(discovered.projects).sort();
  for (const projectId of sortedProjects) {
    const projectServers = discovered.projects[projectId];
    for (const [name, config] of Object.entries(projectServers)) {
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
  const paths = getClaudeConfigPaths();
  if (!paths) {
    return null;
  }

  const discovered = discoverServers();
  if (!discovered) {
    return null;
  }

  const { servers, duplicates } = deduplicateServers(discovered);

  return {
    servers,
    duplicates,
    claudeConfigPath: paths.configFile,
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
    const backupPath = `${configPath}.backup.${Date.now()}`;
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
 * Update Claude config to use only MCPU
 */
export function updateClaudeConfig(configPath: string): void {
  if (!existsSync(configPath)) {
    return;
  }

  // Create backup
  const backupPath = `${configPath}.backup.${Date.now()}`;
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
      message: 'Could not find Claude config. Is Claude Desktop installed?',
    };
  }

  const serverCount = Object.keys(plan.servers).length;

  if (serverCount === 0) {
    return {
      success: false,
      message: 'No MCP servers found in Claude config.',
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
  updateClaudeConfig(plan.claudeConfigPath);

  return {
    success: true,
    message: `Successfully migrated ${serverCount} server(s) to MCPU.`,
    plan,
  };
}
