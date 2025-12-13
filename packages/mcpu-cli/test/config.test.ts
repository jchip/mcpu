import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigDiscovery, AUTO_SAVE_DEFAULTS, resolveAutoSave } from '../src/config.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';

describe('ConfigDiscovery', () => {
  let testDir: string;
  let originalXdgConfigHome: string | undefined;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Create a temporary directory for test configs
    testDir = join(tmpdir(), `mcpu-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Mock XDG_CONFIG_HOME and HOME to prevent loading real user configs
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    originalHome = process.env.HOME;
    process.env.XDG_CONFIG_HOME = join(testDir, '.config');
    process.env.HOME = testDir;
  });

  afterEach(async () => {
    // Restore original environment
    if (originalXdgConfigHome !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

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

    it('should support HTTP config with url only (no type required)', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        'pw-http': {
          url: 'http://localhost:9010/mcp',
        },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      const configs = await discovery.loadConfigs();

      expect(configs.size).toBe(1);
      expect(configs.get('pw-http')).toEqual({
        url: 'http://localhost:9010/mcp',
      });
    });

    it('should support HTTP config with explicit type', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        'pw-http': {
          type: 'http',
          url: 'http://localhost:9010/mcp',
          headers: { 'Authorization': 'Bearer test' },
        },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      const configs = await discovery.loadConfigs();

      expect(configs.size).toBe(1);
      expect(configs.get('pw-http')).toEqual({
        type: 'http',
        url: 'http://localhost:9010/mcp',
        headers: { 'Authorization': 'Bearer test' },
      });
    });

    it('should support WebSocket config with type', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        'ws-server': {
          type: 'websocket',
          url: 'ws://localhost:9010/mcp',
        },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      const configs = await discovery.loadConfigs();

      expect(configs.size).toBe(1);
      expect(configs.get('ws-server')).toEqual({
        type: 'websocket',
        url: 'ws://localhost:9010/mcp',
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

  describe('getAutoSaveConfig', () => {
    it('should return defaults when no config specified', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        filesystem: { command: 'npx', args: [] },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      await discovery.loadConfigs();

      const result = discovery.getAutoSaveConfig('filesystem', 'read_file');
      expect(result).toEqual(AUTO_SAVE_DEFAULTS);
    });

    it('should merge global autoSaveResponse config', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        autoSaveResponse: {
          enabled: false,
          thresholdSize: 5120,
          dir: '.custom/responses',
          previewSize: 200,
        },
        filesystem: { command: 'npx', args: [] },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      await discovery.loadConfigs();

      const result = discovery.getAutoSaveConfig('filesystem', 'read_file');
      expect(result).toEqual({
        enabled: false,
        thresholdSize: 5120,
        dir: '.custom/responses',
        previewSize: 200,
      });
    });

    it('should merge server-level autoSaveResponse', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        autoSaveResponse: {
          enabled: true,
          thresholdSize: 10240,
        },
        playwright: {
          command: 'node',
          args: [],
          autoSaveResponse: {
            enabled: false,
            thresholdSize: 2048,
          },
        },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      await discovery.loadConfigs();

      const result = discovery.getAutoSaveConfig('playwright', 'browser_snapshot');
      expect(result.enabled).toBe(false);
      expect(result.thresholdSize).toBe(2048);
    });

    it('should merge tool-level config via byTools', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        autoSaveResponse: {
          enabled: true,
          thresholdSize: 10240,
        },
        chroma: {
          command: 'node',
          args: [],
          autoSaveResponse: {
            enabled: true,
            thresholdSize: 5120,
            byTools: {
              add_documents: {
                enabled: false,
              },
              query_documents: {
                thresholdSize: 1024,
              },
            },
          },
        },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      await discovery.loadConfigs();

      // Tool with enabled=false override
      const addResult = discovery.getAutoSaveConfig('chroma', 'add_documents');
      expect(addResult.enabled).toBe(false);
      expect(addResult.thresholdSize).toBe(5120); // inherits from server

      // Tool with custom threshold
      const queryResult = discovery.getAutoSaveConfig('chroma', 'query_documents');
      expect(queryResult.enabled).toBe(true);
      expect(queryResult.thresholdSize).toBe(1024);

      // Tool not in byTools, uses server level
      const getResult = discovery.getAutoSaveConfig('chroma', 'get_documents');
      expect(getResult.enabled).toBe(true);
      expect(getResult.thresholdSize).toBe(5120);
    });

    it('should memoize results', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        autoSaveResponse: { enabled: true, thresholdSize: 1000 },
        filesystem: { command: 'npx', args: [] },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      await discovery.loadConfigs();

      const result1 = discovery.getAutoSaveConfig('filesystem', 'read_file');
      const result2 = discovery.getAutoSaveConfig('filesystem', 'read_file');

      // Should return same object (memoized)
      expect(result1).toBe(result2);
    });

    it('should use defaults for unknown servers', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        autoSaveResponse: { thresholdSize: 8192 },
        filesystem: { command: 'npx', args: [] },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      await discovery.loadConfigs();

      const result = discovery.getAutoSaveConfig('unknown_server', 'some_tool');
      expect(result.enabled).toBe(true); // default
      expect(result.thresholdSize).toBe(8192); // from global
    });

    it('should allow partial overrides at each level', async () => {
      const configPath = join(testDir, 'test-config.json');
      const config = {
        autoSaveResponse: {
          thresholdSize: 10000,
          dir: '/global/dir',
        },
        playwright: {
          command: 'node',
          args: [],
          autoSaveResponse: {
            previewSize: 300,
            byTools: {
              browser_snapshot: {
                enabled: false,
              },
            },
          },
        },
      };

      await writeFile(configPath, JSON.stringify(config));

      const discovery = new ConfigDiscovery({ configFile: configPath });
      await discovery.loadConfigs();

      const result = discovery.getAutoSaveConfig('playwright', 'browser_snapshot');
      expect(result).toEqual({
        enabled: false,           // from byTools
        thresholdSize: 10000,     // from global
        dir: '/global/dir',       // from global
        previewSize: 300,         // from server
      });
    });
  });
});

describe('resolveAutoSave', () => {
  it('should return defaults when no overrides provided', () => {
    const result = resolveAutoSave();
    expect(result).toEqual(AUTO_SAVE_DEFAULTS);
  });

  it('should merge global config overrides', () => {
    const result = resolveAutoSave({
      enabled: false,
      thresholdSize: 5000,
    });

    expect(result).toEqual({
      enabled: false,
      thresholdSize: 5000,
      dir: AUTO_SAVE_DEFAULTS.dir,
      previewSize: AUTO_SAVE_DEFAULTS.previewSize,
    });
  });

  it('should merge server config overrides', () => {
    const result = resolveAutoSave(
      { thresholdSize: 5000 },
      { dir: '.custom/responses', previewSize: 200 }
    );

    expect(result).toEqual({
      enabled: AUTO_SAVE_DEFAULTS.enabled,
      thresholdSize: 5000,
      dir: '.custom/responses',
      previewSize: 200,
    });
  });

  it('should merge tool-level config via byTools', () => {
    const result = resolveAutoSave(
      { thresholdSize: 5000 },
      {
        dir: '.server/responses',
        byTools: {
          special_tool: {
            enabled: false,
            thresholdSize: 1000,
          },
        },
      },
      'special_tool'
    );

    expect(result).toEqual({
      enabled: false,
      thresholdSize: 1000,
      dir: '.server/responses',
      previewSize: AUTO_SAVE_DEFAULTS.previewSize,
    });
  });

  it('should ignore byTools when tool not specified', () => {
    const result = resolveAutoSave(
      undefined,
      {
        enabled: true,
        byTools: {
          special_tool: {
            enabled: false,
          },
        },
      }
    );

    expect(result.enabled).toBe(true);
  });

  it('should ignore byTools for non-matching tools', () => {
    const result = resolveAutoSave(
      undefined,
      {
        enabled: true,
        byTools: {
          special_tool: {
            enabled: false,
          },
        },
      },
      'other_tool'
    );

    expect(result.enabled).toBe(true);
  });

  it('should apply cascade: defaults <- global <- server <- tool', () => {
    const result = resolveAutoSave(
      { enabled: false, thresholdSize: 1000 },   // global
      {
        thresholdSize: 2000,                      // server overrides global
        dir: '.server',
        byTools: {
          my_tool: {
            thresholdSize: 3000,                  // tool overrides server
          },
        },
      },
      'my_tool'
    );

    expect(result).toEqual({
      enabled: false,           // from global
      thresholdSize: 3000,      // from tool (overrides server's 2000, global's 1000)
      dir: '.server',           // from server
      previewSize: 500,         // from defaults
    });
  });
});
