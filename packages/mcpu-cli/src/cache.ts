import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { CacheEntry } from './types.ts';

const CACHE_DIR = process.env.XDG_CACHE_HOME
  ? join(process.env.XDG_CACHE_HOME, 'mcpu')
  : join(homedir(), '.cache', 'mcpu');
const DEFAULT_CACHE_TTL_MINUTES = 60;
const CACHE_VERSION = '1.0.0';

export interface CacheResult {
  tools: Tool[];
  expired: boolean;
}

/**
 * Convert TTL in minutes to milliseconds
 */
function ttlToMs(ttlMinutes?: number): number {
  return (ttlMinutes ?? DEFAULT_CACHE_TTL_MINUTES) * 60 * 1000;
}

/**
 * Manages local caching of MCP tool schemas
 */
export class SchemaCache {
  private cacheDir: string;

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir || CACHE_DIR;
  }

  /**
   * Ensure cache directory exists
   */
  private async ensureCacheDir(): Promise<void> {
    if (!existsSync(this.cacheDir)) {
      await mkdir(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Get cache file path for a server
   */
  private getCachePath(serverName: string): string {
    // Sanitize server name for filesystem
    const safeName = serverName.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.cacheDir, `${safeName}.json`);
  }

  /**
   * Get cached tools for a server
   * @param serverName - Server name
   * @param ttlMinutes - Optional TTL in minutes (default: 60)
   */
  async get(serverName: string, ttlMinutes?: number): Promise<Tool[] | null> {
    const result = await this.getWithExpiry(serverName, ttlMinutes);
    if (!result || result.expired) {
      return null;
    }
    return result.tools;
  }

  /**
   * Get cached tools with expiry status
   * Returns tools even if expired (for stale-while-revalidate pattern)
   * @param serverName - Server name
   * @param ttlMinutes - Optional TTL in minutes (default: 60)
   */
  async getWithExpiry(serverName: string, ttlMinutes?: number): Promise<CacheResult | null> {
    try {
      const cachePath = this.getCachePath(serverName);

      if (!existsSync(cachePath)) {
        return null;
      }

      const stats = await stat(cachePath);
      const age = Date.now() - stats.mtimeMs;

      const content = await readFile(cachePath, 'utf-8');
      const entry: CacheEntry = JSON.parse(content);

      // Check version compatibility - if incompatible, return null
      if (entry.version !== CACHE_VERSION) {
        return null;
      }

      return {
        tools: entry.tools,
        expired: age > ttlToMs(ttlMinutes),
      };
    } catch (error) {
      // Cache read failed, return null to trigger fresh fetch
      return null;
    }
  }

  /**
   * Save tools to cache
   */
  async set(serverName: string, tools: Tool[]): Promise<void> {
    try {
      await this.ensureCacheDir();

      const entry: CacheEntry = {
        server: serverName,
        tools,
        timestamp: Date.now(),
        version: CACHE_VERSION,
      };

      const cachePath = this.getCachePath(serverName);
      await writeFile(cachePath, JSON.stringify(entry, null, 2));
    } catch (error) {
      // Cache write failed, continue without caching
      console.error(`Failed to cache tools for ${serverName}:`, error);
    }
  }

  /**
   * Clear cache for a specific server
   */
  async clear(serverName?: string): Promise<void> {
    if (serverName) {
      const cachePath = this.getCachePath(serverName);
      if (existsSync(cachePath)) {
        const { unlink } = await import('fs/promises');
        await unlink(cachePath);
      }
    } else {
      // Clear all cache
      if (existsSync(this.cacheDir)) {
        const { rm } = await import('fs/promises');
        await rm(this.cacheDir, { recursive: true });
      }
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    servers: string[];
    totalSize: number;
    oldestEntry: Date | null;
  }> {
    await this.ensureCacheDir();

    const { readdir } = await import('fs/promises');
    const files = await readdir(this.cacheDir);

    let totalSize = 0;
    let oldestTime = Date.now();
    const servers: string[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = join(this.cacheDir, file);
      const stats = await stat(filePath);

      totalSize += stats.size;
      oldestTime = Math.min(oldestTime, stats.mtimeMs);

      // Extract server name from filename
      servers.push(file.replace('.json', '').replace(/_/g, '-'));
    }

    return {
      servers,
      totalSize,
      oldestEntry: servers.length > 0 ? new Date(oldestTime) : null,
    };
  }
}