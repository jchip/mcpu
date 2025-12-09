import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { type MCPServerConfig, isStdioConfig, isUrlConfig } from '../types.ts';

export type Scope = 'local' | 'project' | 'user';

export interface AddServerOptions {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  scope: Scope;
  // For stdio transport
  command?: string[];  // Command and args after --
  env?: Record<string, string>;
  // For http/sse transport
  url?: string;
  headers?: Record<string, string>;
}

/**
 * Get config file path based on scope
 */
export function getConfigPath(scope: Scope, cwd?: string): string {
  const workingDir = cwd || process.cwd();
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');

  switch (scope) {
    case 'local':
      // Project local config (gitignored)
      return join(workingDir, '.config', 'mcpu', 'config.local.json');
    case 'project':
      // Project shared config (committed to git)
      return join(workingDir, '.config', 'mcpu', 'config.json');
    case 'user':
      return join(configHome, 'mcpu', 'config.json');
  }
}

/**
 * Load existing config file or return empty object
 */
async function loadConfig(configPath: string): Promise<Record<string, MCPServerConfig>> {
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Save config to file, creating directories as needed
 */
async function saveConfig(configPath: string, config: Record<string, MCPServerConfig>): Promise<void> {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Add a new MCP server to the config
 */
export async function addServer(options: AddServerOptions): Promise<{ success: boolean; message: string; configPath: string }> {
  const configPath = getConfigPath(options.scope);

  // Load existing config
  const config = await loadConfig(configPath);

  // Check if server already exists
  if (config[options.name]) {
    return {
      success: false,
      message: `Server "${options.name}" already exists. Use a different name or remove it first.`,
      configPath,
    };
  }

  // Build server config based on transport type
  let serverConfig: MCPServerConfig;

  if (options.transport === 'stdio') {
    if (!options.command || options.command.length === 0) {
      return {
        success: false,
        message: 'Stdio transport requires a command. Use -- to specify the command.',
        configPath,
      };
    }

    const [command, ...args] = options.command;
    serverConfig = {
      command,
      ...(args.length > 0 && { args }),
      env: options.env ?? {},
    };
  } else if (options.transport === 'http' || options.transport === 'sse') {
    if (!options.url) {
      return {
        success: false,
        message: `${options.transport.toUpperCase()} transport requires a URL.`,
        configPath,
      };
    }

    serverConfig = {
      type: 'http',  // Both http and sse use http type in mcpu
      url: options.url,
      ...(options.headers && Object.keys(options.headers).length > 0 && { headers: options.headers }),
    };
  } else {
    return {
      success: false,
      message: `Unknown transport type: ${options.transport}`,
      configPath,
    };
  }

  // Add to config
  config[options.name] = serverConfig;

  // Save config
  await saveConfig(configPath, config);

  return {
    success: true,
    message: `Added "${options.name}" to ${configPath}`,
    configPath,
  };
}

/**
 * Parse --env=KEY=VALUE flags
 */
export function parseEnvFlags(envFlags: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const flag of envFlags) {
    const eqIndex = flag.indexOf('=');
    if (eqIndex === -1) {
      // Just KEY, use empty value
      env[flag] = '';
    } else {
      const key = flag.slice(0, eqIndex);
      const value = flag.slice(eqIndex + 1);
      env[key] = value;
    }
  }
  return env;
}

/**
 * Parse --header=KEY=VALUE flags
 */
export function parseHeaderFlags(headerFlags: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const flag of headerFlags) {
    const eqIndex = flag.indexOf('=');
    if (eqIndex === -1) {
      // Just header name, invalid
      continue;
    }
    const key = flag.slice(0, eqIndex);
    const value = flag.slice(eqIndex + 1);
    headers[key] = value;
  }
  return headers;
}

/**
 * Add a new MCP server from JSON config
 */
export async function addServerJson(
  name: string,
  json: string,
  scope: Scope
): Promise<{ success: boolean; message: string; configPath: string }> {
  const configPath = getConfigPath(scope);

  // Parse JSON
  let serverConfig: MCPServerConfig;
  try {
    serverConfig = JSON.parse(json);
  } catch (e) {
    return {
      success: false,
      message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      configPath,
    };
  }

  // Validate basic structure
  if (typeof serverConfig !== 'object' || serverConfig === null) {
    return {
      success: false,
      message: 'JSON must be an object',
      configPath,
    };
  }

  // Must have either command (stdio) or url (http/sse)
  if (!isStdioConfig(serverConfig) && !isUrlConfig(serverConfig)) {
    return {
      success: false,
      message: 'JSON must contain either "command" (for stdio) or "url" (for http/sse)',
      configPath,
    };
  }

  // Load existing config
  const config = await loadConfig(configPath);

  // Check if server already exists
  if (config[name]) {
    return {
      success: false,
      message: `Server "${name}" already exists. Use a different name or remove it first.`,
      configPath,
    };
  }

  // Add to config
  config[name] = serverConfig;

  // Save config
  await saveConfig(configPath, config);

  return {
    success: true,
    message: `Added "${name}" to ${configPath}`,
    configPath,
  };
}
