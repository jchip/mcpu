import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { MCPServer, ServerSource, ServerStatus } from '../types';
import { createChildLogger } from '../utils/logger';
import { configManager } from '../config';

const logger = createChildLogger('ServerManager');

export class ServerManager {
  private servers: Map<string, MCPServer> = new Map();
  private runningProcesses: Map<string, any> = new Map();
  private serverConfigsPath: string;

  constructor() {
    this.serverConfigsPath = path.join(configManager.getDataDir(), 'servers.json');
  }

  async loadServers(): Promise<void> {
    try {
      const configExists = await this.fileExists(this.serverConfigsPath);
      if (configExists) {
        const serversData = await fs.readFile(this.serverConfigsPath, 'utf-8');
        const parsed = JSON.parse(serversData);
        for (const [id, serverData] of Object.entries(parsed)) {
          this.servers.set(id, serverData as MCPServer);
        }
        logger.info(`Loaded ${this.servers.size} servers`);
      }
    } catch (error) {
      logger.error('Failed to load servers:', error);
    }
  }

  async saveServers(): Promise<void> {
    const serversData = Object.fromEntries(this.servers);
    await fs.mkdir(path.dirname(this.serverConfigsPath), { recursive: true });
    await fs.writeFile(this.serverConfigsPath, JSON.stringify(serversData, null, 2));
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async installServer(serverName: string, source: ServerSource): Promise<MCPServer> {
    logger.info(`Installing server ${serverName} from ${source.url}`);

    const serverId = `${source.type}-${serverName}`;
    const installPath = path.join(configManager.getDataDir(), 'servers', serverId);

    // Create server config
    const server: MCPServer = {
      id: serverId,
      name: serverName,
      namespace: serverName,
      version: source.version || 'latest',
      source,
      installPath,
      config: {
        capabilities: {},
        environment: {},
        args: [],
        transport: 'stdio',
        security: {
          networkAccess: false,
          filesystemAccess: false,
          environmentIsolation: true
        }
      },
      status: 'installed',
      metadata: {
        installedAt: new Date(),
        healthChecks: [],
        auditLog: [{
          timestamp: new Date(),
          action: 'install',
          details: { source }
        }]
      }
    };

    // Perform installation based on source type
    await this.performInstallation(server);

    this.servers.set(serverId, server);
    await this.saveServers();

    logger.info(`Successfully installed server ${serverName}`);
    return server;
  }

  private async performInstallation(server: MCPServer): Promise<void> {
    const { source, installPath } = server;

    if (!installPath) {
      throw new Error('Install path is required');
    }

    await fs.mkdir(installPath, { recursive: true });

    if (!source.url) {
      throw new Error('Source URL is required for installation');
    }

    switch (source.type) {
      case 'npm':
        await this.installNpmPackage(source.url, installPath);
        break;
      case 'pip':
        await this.installPipPackage(source.url, installPath);
        break;
      case 'docker':
        // Docker installation would require docker client
        throw new Error('Docker installation not yet implemented');
      case 'git':
        await this.cloneGitRepo(source.url, installPath);
        break;
      case 'binary':
        await this.downloadBinary(source.url, installPath);
        break;
      default:
        throw new Error(`Unsupported source type: ${source.type}`);
    }
  }

  private async installNpmPackage(packageName: string, installPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const npm = spawn('npm', ['install', packageName], {
        cwd: installPath,
        stdio: 'inherit'
      });

      npm.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`npm install failed with code ${code}`));
        }
      });

      npm.on('error', reject);
    });
  }

  private async installPipPackage(packageName: string, installPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const pip = spawn('pip', ['install', packageName, '--target', installPath], {
        stdio: 'inherit'
      });

      pip.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`pip install failed with code ${code}`));
        }
      });

      pip.on('error', reject);
    });
  }

  private async cloneGitRepo(repoUrl: string, installPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const git = spawn('git', ['clone', repoUrl, '.'], {
        cwd: installPath,
        stdio: 'inherit'
      });

      git.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`git clone failed with code ${code}`));
        }
      });

      git.on('error', reject);
    });
  }

  private async downloadBinary(url: string, installPath: string): Promise<void> {
    // Implementation for downloading and verifying binaries
    throw new Error('Binary download not yet implemented');
  }

  async startServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    if (server.status === 'running') {
      logger.warn(`Server ${serverId} is already running`);
      return;
    }

    if (!server.installPath) {
      throw new Error(`Server ${serverId} has no install path`);
    }

    logger.info(`Starting server ${serverId}`);

    // Start the server process
    const childProcess = spawn('node', [server.installPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...server.config.environment }
    });

    this.runningProcesses.set(serverId, childProcess);
    server.status = 'running';

    childProcess.on('exit', (code: any) => {
      logger.info(`Server ${serverId} exited with code ${code}`);
      server.status = 'stopped';
      this.runningProcesses.delete(serverId);
    });

    childProcess.on('error', (error: any) => {
      logger.error(`Server ${serverId} error:`, error);
      server.status = 'error';
    });

    await this.saveServers();
  }

  async stopServer(serverId: string): Promise<void> {
    const process = this.runningProcesses.get(serverId);
    if (process) {
      process.kill();
      this.runningProcesses.delete(serverId);
    }

    const server = this.servers.get(serverId);
    if (server) {
      server.status = 'stopped';
      await this.saveServers();
    }
  }

  getServer(serverId: string): MCPServer | undefined {
    return this.servers.get(serverId);
  }

  getAllServers(): MCPServer[] {
    return Array.from(this.servers.values());
  }

  getRunningServers(): MCPServer[] {
    return this.getAllServers().filter(server => server.status === 'running');
  }
}