/**
 * Logging for MCP server operations
 */

import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

export interface ServerLogEntry {
  timestamp: string;
  event: 'server_spawn' | 'server_disconnect' | 'server_error' | 'mcpu_start' | 'mcpu_shutdown';
  server: string;
  connectionId?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>; // Sanitized
  error?: string;
  success?: boolean;
  transport?: string;
  port?: number;
  endpoint?: string;
  configCount?: number;
}

/**
 * Sanitize environment variables - hide sensitive values
 */
function sanitizeEnv(env?: Record<string, string>): Record<string, string> | undefined {
  if (!env) return undefined;

  const sensitiveKeys = [
    'PASSWORD',
    'SECRET',
    'TOKEN',
    'KEY',
    'API_KEY',
    'APIKEY',
    'AUTH',
    'CREDENTIALS',
  ];

  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const keyUpper = key.toUpperCase();
    const isSensitive = sensitiveKeys.some(pattern => keyUpper.includes(pattern));
    sanitized[key] = isSensitive ? '***REDACTED***' : value;
  }
  return sanitized;
}

/**
 * Get server log file path
 */
function getServerLogPath(service: string, ppid: number, pid: number): string {
  const xdgDataHome = process.env.XDG_DATA_HOME;
  const dataDir = xdgDataHome || join(homedir(), '.local', 'share');
  return join(dataDir, 'mcpu', 'logs', `${service}-${ppid}-${pid}.log`);
}

/**
 * Write server log entry
 */
export async function writeServerLog(
  service: string,
  ppid: number,
  pid: number,
  entry: ServerLogEntry
): Promise<void> {
  try {
    const logPath = getServerLogPath(service, ppid, pid);
    const logDir = join(logPath, '..');

    // Ensure directory exists
    await mkdir(logDir, { recursive: true });

    // Format as JSON lines
    const line = JSON.stringify({
      ...entry,
      env: sanitizeEnv(entry.env),
    }) + '\n';

    await appendFile(logPath, line, 'utf-8');
  } catch (error) {
    // Don't fail if logging fails
    console.error('Failed to write server log:', error);
  }
}

/**
 * Log server spawn event
 */
export async function logServerSpawn(
  service: string,
  ppid: number,
  pid: number,
  server: string,
  command: string,
  args: string[],
  env?: Record<string, string>,
  connectionId?: string
): Promise<void> {
  await writeServerLog(service, ppid, pid, {
    timestamp: new Date().toISOString(),
    event: 'server_spawn',
    server,
    command,
    args,
    env,
    connectionId,
    success: true,
  });
}

/**
 * Log server disconnect event
 */
export async function logServerDisconnect(
  service: string,
  ppid: number,
  pid: number,
  server: string,
  connectionId?: string
): Promise<void> {
  await writeServerLog(service, ppid, pid, {
    timestamp: new Date().toISOString(),
    event: 'server_disconnect',
    server,
    connectionId,
  });
}

/**
 * Log server error event
 */
export async function logServerError(
  service: string,
  ppid: number,
  pid: number,
  server: string,
  error: string,
  connectionId?: string
): Promise<void> {
  await writeServerLog(service, ppid, pid, {
    timestamp: new Date().toISOString(),
    event: 'server_error',
    server,
    error,
    connectionId,
    success: false,
  });
}

/**
 * Log mcpu-mcp startup event
 */
export async function logMcpuStart(
  ppid: number,
  pid: number,
  transport: string,
  port?: number,
  endpoint?: string,
  configCount?: number
): Promise<void> {
  await writeServerLog('mcpu-mcp', ppid, pid, {
    timestamp: new Date().toISOString(),
    event: 'mcpu_start',
    server: 'mcpu-mcp',
    transport,
    port,
    endpoint,
    configCount,
    success: true,
  });
}

/**
 * Log mcpu-mcp shutdown event
 */
export async function logMcpuShutdown(
  ppid: number,
  pid: number,
  error?: string
): Promise<void> {
  await writeServerLog('mcpu-mcp', ppid, pid, {
    timestamp: new Date().toISOString(),
    event: 'mcpu_shutdown',
    server: 'mcpu-mcp',
    error,
    success: !error,
  });
}
