import { existsSync, writeFileSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import colors from 'ansi-colors';
import type { MCPServerConfig } from '../types.ts';
import { getAllProfiles, type AIAssistantProfile } from './ai-assistant-profiles.ts';

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
 * Get the appropriate MCP server config for MCPU
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
  sources: AIAssistantProfile[];
  checkedPaths?: Record<string, string>;
  mcpuConfigPath: string;
}

export interface SetupResult {
  success: boolean;
  message: string;
  plan?: MigrationPlan;
  noServersFound?: boolean;
}

/**
 * Quote path if it contains spaces
 */
export function quotePath(path: string): string {
  return path.includes(' ') ? `"${path}"` : path;
}

/**
 * Get all config paths that would be checked
 */
export function getCheckedConfigPaths(): Record<string, string> {
  const profiles = getAllProfiles();
  const paths: Record<string, string> = {};

  for (const profile of profiles) {
    paths[profile.name] = profile.configPath;
  }

  return paths;
}

/**
 * Discover all MCP servers from all profiles
 */
export function discoverServers(): { discovered: DiscoveredServers; sources: AIAssistantProfile[]; checkedPaths: Record<string, string> } | null {
  const global: Record<string, MCPServerConfig> = {};
  const projects: Record<string, Record<string, MCPServerConfig>> = {};
  const sources: AIAssistantProfile[] = [];
  const checkedPaths = getCheckedConfigPaths();
  const profiles = getAllProfiles();

  // Loop through all profiles in priority order
  for (const profile of profiles) {
    if (!profile.exists()) continue;

    sources.push(profile);
    const servers = profile.getMcpServers();
    if (!servers) continue;

    // Merge servers (earlier profiles win on conflict)
    for (const [name, config] of Object.entries(servers)) {
      if (!global[name]) {
        global[name] = config;
      }
    }
  }

  if (Object.keys(global).length === 0 && Object.keys(projects).length === 0) {
    return null;
  }

  return { discovered: { global, projects }, sources, checkedPaths };
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
    // Return a plan with just checkedPaths to help with error messages
    return {
      servers: {},
      duplicates: [],
      sources: [],
      checkedPaths: getCheckedConfigPaths(),
      mcpuConfigPath: getMcpuConfigPath(),
    };
  }

  const { discovered, sources, checkedPaths } = result;
  const { servers, duplicates } = deduplicateServers(discovered);

  return {
    servers,
    duplicates,
    sources,
    checkedPaths,
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
  const hasAnyConfigs = plan.sources.length > 0;

  // Debug output
  if (options.verbose) {
    console.log('Debug: serverCount =', serverCount);
    console.log('Debug: hasAnyConfigs =', hasAnyConfigs);
    console.log('Debug: plan.sources =', JSON.stringify(plan.sources, null, 2));
    console.log('Debug: plan.servers =', JSON.stringify(plan.servers, null, 2));
  }

  // If no servers found but configs exist, still add mcpu to those configs
  if (serverCount === 0 && !hasAnyConfigs) {
    // Build a detailed error message showing which paths were checked
    let message = colors.red('No configs found.') + '\n\n';
    message += colors.bold('Checked the following locations:') + '\n';
    if (plan.checkedPaths) {
      for (const [name, path] of Object.entries(plan.checkedPaths)) {
        const exists = existsSync(path);
        const statusSymbol = exists ? colors.green('✓') : colors.red('✗');
        const statusText = exists ? colors.green('found') : colors.dim('not found');
        const pathColor = exists ? colors.cyan : colors.dim;
        message += `  ${colors.bold(name)}: ${pathColor(quotePath(path))} (${statusSymbol} ${statusText})\n`;
      }
    }
    message += '\n' + colors.yellow('Note:') + ' If CLAUDE_CONFIG_DIR is set, Claude CLI config will be at $CLAUDE_CONFIG_DIR/.claude.json';

    return {
      success: false,
      message,
      plan, // Include plan so CLI can show which configs were checked
    };
  }

  if (options.dryRun) {
    let message = colors.bold('Migration Plan (dry-run)') + '\n\n';

    // Show sources
    message += colors.bold('Sources:') + '\n';
    const foundConfigs = plan.sources.length > 0;
    for (const profile of plan.sources) {
      const label = profile.shortName.padEnd(12);
      message += `  ${label}: ${colors.cyan(quotePath(profile.configPath))}\n`;
    }
    message += `  Output:  ${colors.cyan(quotePath(plan.mcpuConfigPath))}\n\n`;

    // Show servers or lack thereof
    if (serverCount > 0) {
      message += colors.bold(`Servers to migrate (${serverCount}):`) + '\n';
      for (const [name, config] of Object.entries(plan.servers)) {
        const type = 'command' in config ? 'stdio' : (config as any).type || 'unknown';
        message += `  ${colors.green('+')} ${name} (${type})\n`;
      }
    } else {
      message += colors.yellow('No MCP servers found to migrate.') + '\n';
      if (foundConfigs) {
        message += 'Will add MCPU configuration to existing configs.\n';
      }
    }

    // Show duplicates
    if (plan.duplicates.length > 0) {
      message += '\n' + colors.bold('Duplicates resolved:') + '\n';
      for (const dup of plan.duplicates) {
        const kept = colors.green(dup.kept);
        const skipped = dup.sources.filter(s => s !== dup.kept).join(', ');
        message += `  ${dup.name}: kept from ${kept}, skipped from ${skipped}\n`;
      }
    }

    message += '\n' + colors.dim('Run without --dry-run to apply changes.');

    return {
      success: true,
      message,
      plan,
    };
  }

  // Execute migration
  if (serverCount > 0) {
    saveMcpuConfig(plan.servers, plan.mcpuConfigPath);
  }

  // Update all profile configs
  const profiles = getAllProfiles();
  const sourceProfiles = new Set(plan.sources);

  for (const profile of profiles) {
    const wasSource = sourceProfiles.has(profile);
    const isClaudeCli = profile.name === 'Claude CLI';
    const isCodexCli = profile.name === 'Codex CLI';

    // Update profile if it was a source, OR if it's Claude CLI or Codex CLI
    // (those should always be configured for MCPU)
    if (wasSource || isClaudeCli || isCodexCli) {
      profile.setMcpuOnly();
    }
  }

  // Build success message
  let message: string;
  if (serverCount > 0) {
    message = colors.green(`Successfully migrated ${serverCount} server(s) to MCPU.`);
  } else {
    message = colors.green('Added MCPU to your configs.');
  }

  return {
    success: true,
    message,
    plan,
    noServersFound: serverCount === 0,
  };
}
