#!/usr/bin/env node

import { DaemonServer } from '../daemon/server.ts';

export interface DaemonOptions {
  port?: number;
  verbose?: boolean;
  config?: string;
  ppid?: number;
}

/**
 * Start the MCPU daemon server
 */
export async function daemonCommand(options: DaemonOptions): Promise<void> {
  const daemon = new DaemonServer(options);

  // Handle graceful shutdown signals
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down...');
    await daemon.shutdown();
  });

  process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, shutting down...');
    await daemon.shutdown();
  });

  process.on('SIGHUP', async () => {
    console.log('\nReceived SIGHUP, shutting down...');
    await daemon.shutdown();
  });

  // Handle uncaught errors (best effort cleanup)
  process.on('uncaughtException', async (error) => {
    console.error('\nUncaught exception:', error);
    try {
      await daemon.shutdown();
    } catch (shutdownError) {
      // Ignore shutdown errors
    }
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    console.error('\nUnhandled promise rejection:', reason);
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
    console.error('Failed to start daemon:', error.message || error);
    process.exit(1);
  }
}
