#!/usr/bin/env node

import { RegistryManager } from '../core/RegistryManager';
import { ServerManager } from '../core/ServerManager';
import { configManager } from '../config';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('CLI');

class MCPCLI {
  private registryManager: RegistryManager;
  private serverManager: ServerManager;

  constructor() {
    this.registryManager = new RegistryManager();
    this.serverManager = new ServerManager();
  }

  async init(): Promise<void> {
    await configManager.load();
    await this.registryManager.loadRegistries();
    await this.serverManager.loadServers();
  }

  async run(): Promise<void> {
    console.log('MCPU Proxy CLI');
    console.log('Available commands:');
    console.log('  mcpctl registry list');
    console.log('  mcpctl server list');
    console.log('  mcpctl status');
    console.log('  mcpctl serve');
  }
}

// Run CLI
async function main() {
  const cli = new MCPCLI();
  try {
    await cli.init();
    await cli.run();
  } catch (error: any) {
    logger.error('CLI error:', error);
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
