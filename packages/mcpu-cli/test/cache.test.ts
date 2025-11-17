import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SchemaCache } from '../src/cache.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { rm, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

describe('SchemaCache', () => {
  let testCacheDir: string;
  let cache: SchemaCache;

  beforeEach(async () => {
    // Create a temporary cache directory for testing
    testCacheDir = join(tmpdir(), `mcpu-cache-test-${Date.now()}`);
    cache = new SchemaCache(testCacheDir);
  });

  afterEach(async () => {
    // Clean up test cache directory
    if (existsSync(testCacheDir)) {
      await rm(testCacheDir, { recursive: true, force: true });
    }
  });

  describe('set and get', () => {
    it('should cache and retrieve tools for a server', async () => {
      const serverName = 'filesystem';
      const tools: Tool[] = [
        {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
            required: ['path'],
          },
        },
        {
          name: 'write_file',
          description: 'Write a file',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
      ];

      await cache.set(serverName, tools);
      const cachedTools = await cache.get(serverName);

      expect(cachedTools).toEqual(tools);
    });

    it('should return null for non-existent cache', async () => {
      const cachedTools = await cache.get('nonexistent');
      expect(cachedTools).toBeNull();
    });

    it('should handle multiple servers independently', async () => {
      const filesystemTools: Tool[] = [
        { name: 'read_file', inputSchema: { type: 'object', properties: {} } },
      ];

      const playwrightTools: Tool[] = [
        { name: 'navigate', inputSchema: { type: 'object', properties: {} } },
        { name: 'screenshot', inputSchema: { type: 'object', properties: {} } },
      ];

      await cache.set('filesystem', filesystemTools);
      await cache.set('playwright', playwrightTools);

      const cachedFs = await cache.get('filesystem');
      const cachedPw = await cache.get('playwright');

      expect(cachedFs).toEqual(filesystemTools);
      expect(cachedPw).toEqual(playwrightTools);
    });

    it('should sanitize server names for filesystem', async () => {
      const serverName = 'server:with/special@chars';
      const tools: Tool[] = [
        { name: 'test_tool', inputSchema: { type: 'object', properties: {} } },
      ];

      await cache.set(serverName, tools);
      const cachedTools = await cache.get(serverName);

      expect(cachedTools).toEqual(tools);
    });
  });

  describe('cache expiration', () => {
    it('should return null for expired cache', async () => {
      const serverName = 'test-server';
      const tools: Tool[] = [
        { name: 'test_tool', inputSchema: { type: 'object', properties: {} } },
      ];

      await cache.set(serverName, tools);

      // Manually modify the cache file timestamp to simulate expiration
      const cachePath = join(testCacheDir, 'test-server.json');
      const oldTime = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
      const content = await import('fs/promises').then(m => m.readFile(cachePath, 'utf-8'));
      await writeFile(cachePath, content);

      // Set the file modification time to 25 hours ago
      const { utimes } = await import('fs/promises');
      const oldDate = new Date(oldTime);
      await utimes(cachePath, oldDate, oldDate);

      const cachedTools = await cache.get(serverName);
      expect(cachedTools).toBeNull();
    });

    it('should return cached data within TTL', async () => {
      const serverName = 'test-server';
      const tools: Tool[] = [
        { name: 'test_tool', inputSchema: { type: 'object', properties: {} } },
      ];

      await cache.set(serverName, tools);

      // Immediately retrieve (well within 24 hour TTL)
      const cachedTools = await cache.get(serverName);
      expect(cachedTools).toEqual(tools);
    });
  });

  describe('version compatibility', () => {
    it('should return null for incompatible cache version', async () => {
      const serverName = 'test-server';
      const cachePath = join(testCacheDir, 'test-server.json');

      // Create cache directory
      await mkdir(testCacheDir, { recursive: true });

      // Write cache with old version
      const oldCacheEntry = {
        server: serverName,
        tools: [
          { name: 'test_tool', inputSchema: { type: 'object', properties: {} } },
        ],
        timestamp: Date.now(),
        version: '0.0.1', // Old version
      };

      await writeFile(cachePath, JSON.stringify(oldCacheEntry));

      const cachedTools = await cache.get(serverName);
      expect(cachedTools).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear cache for specific server', async () => {
      const server1Tools: Tool[] = [
        { name: 'tool1', inputSchema: { type: 'object', properties: {} } },
      ];
      const server2Tools: Tool[] = [
        { name: 'tool2', inputSchema: { type: 'object', properties: {} } },
      ];

      await cache.set('server1', server1Tools);
      await cache.set('server2', server2Tools);

      await cache.clear('server1');

      const cached1 = await cache.get('server1');
      const cached2 = await cache.get('server2');

      expect(cached1).toBeNull();
      expect(cached2).toEqual(server2Tools);
    });

    it('should clear all cache when no server specified', async () => {
      const server1Tools: Tool[] = [
        { name: 'tool1', inputSchema: { type: 'object', properties: {} } },
      ];
      const server2Tools: Tool[] = [
        { name: 'tool2', inputSchema: { type: 'object', properties: {} } },
      ];

      await cache.set('server1', server1Tools);
      await cache.set('server2', server2Tools);

      await cache.clear();

      const cached1 = await cache.get('server1');
      const cached2 = await cache.get('server2');

      expect(cached1).toBeNull();
      expect(cached2).toBeNull();
    });

    it('should not throw when clearing non-existent cache', async () => {
      await expect(cache.clear('nonexistent')).resolves.not.toThrow();
      await expect(cache.clear()).resolves.not.toThrow();
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', async () => {
      const server1Tools: Tool[] = [
        { name: 'tool1', inputSchema: { type: 'object', properties: {} } },
      ];
      const server2Tools: Tool[] = [
        { name: 'tool2', inputSchema: { type: 'object', properties: {} } },
        { name: 'tool3', inputSchema: { type: 'object', properties: {} } },
      ];

      await cache.set('server1', server1Tools);
      await cache.set('server2', server2Tools);

      const stats = await cache.getStats();

      expect(stats.servers).toContain('server1');
      expect(stats.servers).toContain('server2');
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.oldestEntry).toBeInstanceOf(Date);
    });

    it('should return empty stats for empty cache', async () => {
      const stats = await cache.getStats();

      expect(stats.servers).toEqual([]);
      expect(stats.totalSize).toBe(0);
      expect(stats.oldestEntry).toBeNull();
    });

    it('should calculate total size correctly', async () => {
      const tools: Tool[] = [
        {
          name: 'large_tool',
          description: 'A tool with a large schema',
          inputSchema: {
            type: 'object',
            properties: {
              prop1: { type: 'string', description: 'Property 1' },
              prop2: { type: 'string', description: 'Property 2' },
              prop3: { type: 'string', description: 'Property 3' },
            },
          },
        },
      ];

      await cache.set('large-server', tools);

      const stats = await cache.getStats();
      expect(stats.totalSize).toBeGreaterThan(100); // Should be larger than minimal JSON
    });
  });

  describe('error handling', () => {
    it('should handle cache read errors gracefully', async () => {
      const serverName = 'test-server';
      const cachePath = join(testCacheDir, 'test-server.json');

      // Create cache directory
      await mkdir(testCacheDir, { recursive: true });

      // Write invalid JSON
      await writeFile(cachePath, 'invalid json content');

      const cachedTools = await cache.get(serverName);
      expect(cachedTools).toBeNull();
    });

    it('should handle cache write errors gracefully', async () => {
      // Create a cache with an invalid directory path
      const invalidCache = new SchemaCache('/invalid/readonly/path/that/does/not/exist');

      const tools: Tool[] = [
        { name: 'test_tool', inputSchema: { type: 'object', properties: {} } },
      ];

      // Should not throw, just log error
      await expect(invalidCache.set('test-server', tools)).resolves.not.toThrow();
    });
  });
});
