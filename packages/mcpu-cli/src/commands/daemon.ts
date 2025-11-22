#!/usr/bin/env node

import { DaemonServer } from '../daemon/server.ts';
import { createLogger, getLogPath } from '../daemon/logger.ts';

export interface DaemonOptions {
  port?: number;
  verbose?: boolean;
  config?: string;
  ppid?: number;
  /** Enable automatic disconnection of idle connections (default: false) */
  autoDisconnect?: boolean;
  /** Time in milliseconds before idle connections are closed (default: 5 minutes) */
  idleTimeoutMs?: number;
}

/**
 * Start the MCPU daemon server
 */
export async function daemonCommand(options: DaemonOptions): Promise<void> {
  const ppid = options.ppid || 0;
  const pid = process.pid;

  // Create logger
  const logger = await createLogger({
    ppid,
    pid,
    verbose: options.verbose,
  });

  logger.info({ logFile: getLogPath(ppid, pid) }, 'Logger initialized');

  const daemon = new DaemonServer({ ...options, logger });

  // Handle graceful shutdown signals
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down');
    await daemon.shutdown();
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down');
    await daemon.shutdown();
  });

  process.on('SIGHUP', async () => {
    logger.info('Received SIGHUP, shutting down');
    await daemon.shutdown();
  });

  // Handle uncaught errors (best effort cleanup)
  process.on('uncaughtException', async (error) => {
    logger.error({ error: String(error) }, 'Uncaught exception');
    try {
      await daemon.shutdown();
    } catch (shutdownError) {
      // Ignore shutdown errors
    }
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    logger.error({ reason: String(reason) }, 'Unhandled promise rejection');
    try {
      await daemon.shutdown();
    } catch (shutdownError) {
      // Ignore shutdown errors
    }
    process.exit(1);
  });

  // Start the daemon
  try {
    await daemon.start();
  } catch (error: any) {
    logger.error({ error: error.message || String(error) }, 'Failed to start daemon');
    process.exit(1);
  }
}
