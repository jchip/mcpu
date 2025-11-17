import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigDiscovery } from '../src/config.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';

describe('ConfigDiscovery', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test configs
    testDir = join(tmpdir(), `mcpu-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe('loadConfigs', () => {
    it('should load config from explicit config file', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      const configs = await discovery.loadConfigs();

      expect(configs.size).toBe(1);
      expect(configs.get('filesystem')).toEqual({
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      });
    });

    it('should load config from .config/mcpu/config.local.json', async () => {
      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const configDir = join(testDir, '.config', 'mcpu');
        await mkdir(configDir, { recursive: true });
        const configPath = join(configDir, 'config.local.json');
        const config = {
          playwright: {
            command: 'node',
            args: ['server.js'],
            env: {
              PORT: '3000',
            },
          },
        };

        await writeFile(configPath, JSON.stringify(config));

        const discovery = new ConfigDiscovery();
        const configs = await discovery.loadConfigs();

        expect(configs.size).toBe(1);
        expect(configs.get('playwright')).toMatchObject({
          command: 'node',
          args: ['server.js'],
          env: {
            PORT: '3000',
          },
        });
      } finally {
        process.chdir(originalCwd);
      }
    });


    it('should return empty map when no config found', async () => {
      const originalCwd = process.cwd();
      const nonExistentDir = join(tmpdir(), `nonexistent-${Date.now()}`);

      try {
        // Change to a directory with no config files
        await mkdir(nonExistentDir, { recursive: true });
        process.chdir(nonExistentDir);

        const discovery = new ConfigDiscovery({ configFile: '/nonexistent/path.json' });
        const configs = await discovery.loadConfigs();

        expect(configs.size).toBe(0);
      } finally {
        process.chdir(originalCwd);
        await rm(nonExistentDir, { recursive: true, force: true });
      }
    });

    it('should handle invalid JSON gracefully', async () => {
      const originalCwd = process.cwd();
      const tempDir = join(tmpdir(), `invalid-test-${Date.now()}`);

      try {
        await mkdir(tempDir, { recursive: true });
        process.chdir(tempDir);

        const configPath = join(tempDir, 'invalid.json');
        await writeFile(configPath, 'invalid json content');

        const discovery = new ConfigDiscovery({ configFile: configPath, verbose: false });
        const configs = await discovery.loadConfigs();

        expect(configs.size).toBe(0);
      } finally {
        process.chdir(originalCwd);
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should normalize common CLI commands', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        server1: { command: 'npx', args: [] },
        server2: { command: 'node', args: [] },
        server3: { command: 'python', args: [] },
        server4: { command: 'uvx', args: [] },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      const configs = await discovery.loadConfigs();

      expect(configs.get('server1')?.command).toBe('npx');
      expect(configs.get('server2')?.command).toBe('node');
      expect(configs.get('server3')?.command).toBe('python');
      expect(configs.get('server4')?.command).toBe('uvx');
    });

    it('should handle environment variables in config', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        github: {
          command: 'uvx',
          args: ['mcp-server-github'],
          env: {
            GITHUB_TOKEN: 'test-token',
            GITHUB_API_URL: 'https://api.github.com',
          },
        },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      const configs = await discovery.loadConfigs();

      expect(configs.get('github')?.env).toEqual({
        GITHUB_TOKEN: 'test-token',
        GITHUB_API_URL: 'https://api.github.com',
      });
    });
  });

  describe('getServer', () => {
    it('should return specific server config', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
        playwright: {
          command: 'node',
          args: ['server.js'],
        },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      await discovery.loadConfigs();

      const serverConfig = discovery.getServer('filesystem');
      expect(serverConfig).toEqual({
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      });
    });

    it('should return undefined for non-existent server', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        filesystem: {
          command: 'npx',
          args: [],
        },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      await discovery.loadConfigs();

      const serverConfig = discovery.getServer('nonexistent');
      expect(serverConfig).toBeUndefined();
    });
  });

  describe('getServerNames', () => {
    it('should return all server names', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        filesystem: { command: 'npx', args: [] },
        playwright: { command: 'node', args: [] },
        github: { command: 'uvx', args: [] },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      await discovery.loadConfigs();

      const names = discovery.getServerNames();
      expect(names).toEqual(['filesystem', 'playwright', 'github']);
    });

    it('should return empty array when no servers configured', async () => {
      const originalCwd = process.cwd();
      const emptyDir = join(tmpdir(), `empty-test-${Date.now()}`);

      try {
        await mkdir(emptyDir, { recursive: true });
        process.chdir(emptyDir);

        const discovery = new ConfigDiscovery({ configFile: '/nonexistent.json' });
        await discovery.loadConfigs();

        const names = discovery.getServerNames();
        expect(names).toEqual([]);
      } finally {
        process.chdir(originalCwd);
        await rm(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe('getAllServers', () => {
    it('should return all server configs', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        filesystem: { command: 'npx', args: ['-y', 'fs'] },
        playwright: { command: 'node', args: ['server.js'] },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      await discovery.loadConfigs();

      const allServers = discovery.getAllServers();
      expect(allServers.size).toBe(2);
      expect(allServers.get('filesystem')).toEqual({
        command: 'npx',
        args: ['-y', 'fs'],
      });
      expect(allServers.get('playwright')).toMatchObject({
        command: 'node',
        args: ['server.js'],
      });
    });
  });
});
