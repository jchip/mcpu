import * as fs from 'fs/promises';
import * as path from 'path';
import { ProxyConfig, GlobalSecurityConfig } from '../types';

const DEFAULT_CONFIG: ProxyConfig = {
  port: 3000,
  host: 'localhost',
  logLevel: 'info',
  dataDir: path.join(process.env.HOME || '~', '.mcpu'),
  registries: [
    'https://raw.githubusercontent.com/modelcontextprotocol/registry/main/registry.yaml'
  ],
  security: {
    defaultDeny: true,
    auditLogging: true,
    sandboxing: true,
    allowedRegistries: []
  }
};

export class ConfigManager {
  private config: ProxyConfig;
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(DEFAULT_CONFIG.dataDir, 'config.json');
    this.config = { ...DEFAULT_CONFIG };
  }

  async load(): Promise<void> {
    try {
      const configExists = await this.fileExists(this.configPath);
      if (configExists) {
        const configData = await fs.readFile(this.configPath, 'utf-8');
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(configData) };
      } else {
        await this.save();
      }
    } catch (error) {
      console.warn('Failed to load config, using defaults:', error);
    }
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  getConfig(): ProxyConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<ProxyConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getDataDir(): string {
    return this.config.dataDir;
  }

  getSecurityConfig(): GlobalSecurityConfig {
    return this.config.security;
  }
}

export const configManager = new ConfigManager();
