import pino from 'pino';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

export interface LoggerOptions {
  ppid: number;
  pid: number;
  verbose?: boolean;
}

/**
 * Get the log file path for a daemon
 */
export function getLogPath(ppid: number, pid: number): string {
  const xdgDataHome = process.env.XDG_DATA_HOME;
  const dataHome = xdgDataHome || join(homedir(), '.local', 'share');
  return join(dataHome, 'mcpu', `daemon.${ppid}-${pid}.log`);
}

/**
 * Get the data directory path
 */
export function getDataDir(): string {
  const xdgDataHome = process.env.XDG_DATA_HOME;
  const dataHome = xdgDataHome || join(homedir(), '.local', 'share');
  return join(dataHome, 'mcpu');
}

/**
 * Create a pino logger for the daemon
 */
export async function createLogger(options: LoggerOptions): Promise<pino.Logger> {
  const dataDir = getDataDir();
  const logPath = getLogPath(options.ppid, options.pid);

  // Ensure data directory exists
  await mkdir(dataDir, { recursive: true });

  // Create pino logger with file transport
  const logger = pino({
    level: options.verbose ? 'debug' : 'info',
    transport: {
      targets: [
        // Pretty console output
        {
          target: 'pino-pretty',
          level: options.verbose ? 'debug' : 'info',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
        // File output (JSON format for machine parsing)
        {
          target: 'pino/file',
          level: 'debug', // Always log everything to file
          options: {
            destination: logPath,
            mkdir: true,
          },
        },
      ],
    },
  });

  return logger;
}

// Re-export pino types for convenience
export type Logger = pino.Logger;
