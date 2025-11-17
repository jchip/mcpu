import { MCPRegistry, RegistryServer } from '../types';
import { createChildLogger } from '../utils/logger';
import { configManager } from '../config';
import * as yaml from 'yaml';

const logger = createChildLogger('RegistryManager');

export class RegistryManager {
  private registries: Map<string, MCPRegistry> = new Map();
  private registryCache: Map<string, RegistryServer[]> = new Map();

  async loadRegistries(): Promise<void> {
    const config = configManager.getConfig();
    const registryPromises = config.registries.map(url => this.loadRegistry(url));
    await Promise.all(registryPromises);
  }

  private async loadRegistry(url: string): Promise<void> {
    try {
      logger.info(`Loading registry from ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch registry: ${response.status}`);
      }

      const data = await response.text();
      const registry = this.parseRegistryData(data, url);
      this.registries.set(url, registry);

      // Cache server list
      this.registryCache.set(url, registry.servers);

      logger.info(`Loaded ${registry.servers.length} servers from ${url}`);
    } catch (error) {
      logger.error(`Failed to load registry ${url}:`, error);
    }
  }

  private parseRegistryData(data: string, url: string): MCPRegistry {
    // Assume YAML format for now
    const parsed = yaml.parse(data);

    return {
      id: parsed.id || url,
      name: parsed.name || 'Unknown Registry',
      url,
      type: parsed.type || 'community',
      format: 'yaml',
      lastSync: new Date(),
      servers: parsed.servers || []
    };
  }

  async searchServers(query: string): Promise<RegistryServer[]> {
    const allServers: RegistryServer[] = [];
    for (const servers of this.registryCache.values()) {
      allServers.push(...servers);
    }

    return allServers.filter(server =>
      server.name.toLowerCase().includes(query.toLowerCase()) ||
      server.description?.toLowerCase().includes(query.toLowerCase()) ||
      server.tags?.some(tag => tag.toLowerCase().includes(query.toLowerCase()))
    );
  }

  getAllServers(): RegistryServer[] {
    const allServers: RegistryServer[] = [];
    for (const servers of this.registryCache.values()) {
      allServers.push(...servers);
    }
    return allServers;
  }

  getRegistry(url: string): MCPRegistry | undefined {
    return this.registries.get(url);
  }

  getAllRegistries(): MCPRegistry[] {
    return Array.from(this.registries.values());
  }
}