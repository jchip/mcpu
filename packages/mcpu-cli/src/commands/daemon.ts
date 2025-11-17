#!/usr/bin/env node

import { DaemonServer } from '../daemon/server.ts';

export interface DaemonOptions {
  port?: number;
  verbose?: boolean;
  config?: string;
}

/**
 * Start the MCPU daemon server
 */
export async function daemonCommand(options: DaemonOptions): Promise<void> {
  const daemon = new DaemonServer(options);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down...');
    await daemon.shutdown();
  });

  process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, shutting down...');
    await daemon.shutdown();
  });

  // Start the daemon
  try {
    await daemon.start();
  } catch (error: any) {
    console.error('Failed to start daemon:', error.message || error);
    process.exit(1);
  }
}
