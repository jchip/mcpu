/**
 * Logging for MCP server operations using pino
 */

import pino from 'pino';
import { join } from 'path';
import { homedir } from 'os';

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
 * Create a pino logger for a specific service
 */
export function createLogger(service: string, ppid: number, pid: number) {
  const logPath = getServerLogPath(service, ppid, pid);

  return pino(
    {
      level: 'info',
      // Redact sensitive fields
      redact: {
        paths: ['env.*.PASSWORD', 'env.*.SECRET', 'env.*.TOKEN', 'env.*.KEY', 'env.*.*KEY'],
        censor: '***REDACTED***'
      },
      formatters: {
        level: (label) => {
          return { level: label };
        },
      },
    },
    pino.destination({
      dest: logPath,
      sync: false, // async for better performance
      mkdir: true, // auto-create directory
    })
  );
}

/**
 * Log server spawn event
 */
export function logServerSpawn(
  logger: pino.Logger,
  server: string,
  command: string,
  args: string[],
  env?: Record<string, string>,
  connectionId?: string
): void {
  logger.info({
    event: 'server_spawn',
    server,
    command,
    args,
    env: sanitizeEnv(env),
    connectionId,
  });
}

/**
 * Log server disconnect event
 */
export function logServerDisconnect(
  logger: pino.Logger,
  server: string,
  connectionId?: string
): void {
  logger.info({
    event: 'server_disconnect',
    server,
    connectionId,
  });
}

/**
 * Log server error event
 */
export function logServerError(
  logger: pino.Logger,
  server: string,
  error: string,
  connectionId?: string
): void {
  logger.error({
    event: 'server_error',
    server,
    error,
    connectionId,
  });
}

/**
 * Log mcpu-mcp startup event
 */
export function logMcpuStart(
  logger: pino.Logger,
  transport: string,
  port?: number,
  endpoint?: string,
  configCount?: number
): void {
  logger.info({
    event: 'mcpu_start',
    server: 'mcpu-mcp',
    transport,
    port,
    endpoint,
    configCount,
  });
}

/**
 * Log mcpu-mcp shutdown event
 */
export function logMcpuShutdown(
  logger: pino.Logger,
  error?: string
): void {
  if (error) {
    logger.error({
      event: 'mcpu_shutdown',
      server: 'mcpu-mcp',
      error,
    });
  } else {
    logger.info({
      event: 'mcpu_shutdown',
      server: 'mcpu-mcp',
    });
  }
}
