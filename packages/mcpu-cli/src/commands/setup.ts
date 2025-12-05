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
  sources: {
    desktop?: string;
    cli?: string;
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
 * Discover all MCP servers from both Claude Desktop and Claude CLI
 */
export function discoverServers(): { discovered: DiscoveredServers; sources: { desktop?: string; cli?: string } } | null {
  const global: Record<string, MCPServerConfig> = {};
  const projects: Record<string, Record<string, MCPServerConfig>> = {};
  const sources: { desktop?: string; cli?: string } = {};

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

  if (Object.keys(global).length === 0 && Object.keys(projects).length === 0) {
    return null;
  }

  return { discovered: { global, projects }, sources };
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
 * Update Claude Desktop config to use only MCPU
 */
export function updateClaudeDesktopConfig(configPath: string): void {
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
 * Update Claude CLI config to use only MCPU
 * Replaces top-level mcpServers with MCPU and clears all project mcpServers
 */
export function updateClaudeCliConfig(configPath: string): void {
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
      command: 'mcpu-mcp',
      args: [],
    },
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
      message: 'Could not find Claude config. Is Claude Desktop or Claude CLI installed?',
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

  // Update both Desktop and CLI configs if they exist
  if (plan.sources.desktop) {
    updateClaudeDesktopConfig(plan.sources.desktop);
  }
  if (plan.sources.cli) {
    updateClaudeCliConfig(plan.sources.cli);
  }

  return {
    success: true,
    message: `Successfully migrated ${serverCount} server(s) to MCPU.`,
    plan,
  };
}
