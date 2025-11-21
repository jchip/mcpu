import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeCallCommand } from '../../src/core/executor.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Mock MCPClient to avoid actual connections
vi.mock('../../src/client.js', () => ({
  MCPClient: vi.fn().mockImplementation(() => {
    const mockConnection = {
      client: { callTool: vi.fn() },
      transport: { close: vi.fn() },
      serverName: 'testServer',
    };

    return {
      connect: vi.fn().mockResolvedValue(mockConnection),
      withConnection: vi.fn(async (name, config, callback) => callback(mockConnection)),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }],
      }),
      disconnect: vi.fn(),
      listTools: vi.fn().mockResolvedValue([]),
    };
  }),
}));

// Mock SchemaCache
vi.mock('../../src/cache.js', () => ({
  SchemaCache: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue([{
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: {
        type: 'object',
        properties: {
          field1: { type: 'string' },
          field2: { type: 'number' },
        },
      },
    }]),
    set: vi.fn(),
  })),
}));

describe('Core Executor - executeCallCommand', () => {
  let testDir: string;
  let configPath: string;
  let originalXdgConfigHome: string | undefined;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Create temp directory for test configs
    testDir = join(tmpdir(), `mcpu-exec-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Mock environment to use test directory
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    originalHome = process.env.HOME;
    process.env.XDG_CONFIG_HOME = join(testDir, '.config');
    process.env.HOME = testDir;

    // Create test config
    configPath = join(testDir, 'test-config.json');
    const config = {
      testServer: {
        command: 'test-cmd',
        args: [],
      },
    };
    await writeFile(configPath, JSON.stringify(config));

    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Restore environment
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

    // Cleanup
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe('--stdin flag validation', () => {
    it('should reject --stdin flag in daemon mode without stdinData', async () => {
      const mockPool = {
        getConnection: vi.fn(),
      };

      const result = await executeCallCommand(
        {
          server: 'testServer',
          tool: 'test_tool',
          args: [],
        },
        {
          stdin: true,
          connectionPool: mockPool as any,
          config: configPath,
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not supported when running through daemon');
    });

    it('should accept stdinData in daemon mode', async () => {
      const params = { field1: 'value1', field2: 42 };

      const mockPool = {
        getConnection: vi.fn().mockResolvedValue({
          id: 1,
          server: 'testServer',
          connection: {
            client: { callTool: vi.fn() },
            transport: { close: vi.fn() },
            serverName: 'testServer',
          },
        }),
      };

      const result = await executeCallCommand(
        {
          server: 'testServer',
          tool: 'test_tool',
          args: [],
          stdinData: JSON.stringify(params),
        },
        {
          stdin: true,
          connectionPool: mockPool as any,
          config: configPath,
        }
      );

      expect(result.success).toBe(true);
    });

    it('should allow --stdin flag in standalone mode with stdinData', async () => {
      const params = { field1: 'value1' };

      const result = await executeCallCommand(
        {
          server: 'testServer',
          tool: 'test_tool',
          args: [],
          stdinData: JSON.stringify(params),
        },
        {
          stdin: true,
          config: configPath,
        }
      );

      expect(result.success).toBe(true);
    });
  });

  describe('stdinData parsing', () => {
    it('should parse JSON stdinData correctly', async () => {
      const params = {
        field1: 'test value',
        field2: 123,
      };

      const result = await executeCallCommand(
        {
          server: 'testServer',
          tool: 'test_tool',
          args: [],
          stdinData: JSON.stringify(params),
        },
        {
          config: configPath,
        }
      );

      expect(result.success).toBe(true);
    });

    it('should return error for invalid JSON in stdinData', async () => {
      const result = await executeCallCommand(
        {
          server: 'testServer',
          tool: 'test_tool',
          args: [],
          stdinData: 'invalid json {',
        },
        {
          stdin: true,
          config: configPath,
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse JSON');
    });

    it('should handle complex nested objects in stdinData', async () => {
      const params = {
        field1: 'value',
        nested: {
          array: [1, 2, 3],
          object: { key: 'value' },
        },
      };

      const result = await executeCallCommand(
        {
          server: 'testServer',
          tool: 'test_tool',
          args: [],
          stdinData: JSON.stringify(params),
        },
        {
          config: configPath,
        }
      );

      expect(result.success).toBe(true);
    });
  });

  describe('CLI argument parsing (without stdin)', () => {
    it('should parse simple --key=value arguments', async () => {
      const result = await executeCallCommand(
        {
          server: 'testServer',
          tool: 'test_tool',
          args: ['--field1=value1', '--field2=42'],
        },
        {
          config: configPath,
        }
      );

      expect(result.success).toBe(true);
    });

    it('should parse typed arguments with explicit types', async () => {
      const result = await executeCallCommand(
        {
          server: 'testServer',
          tool: 'test_tool',
          args: ['--field1=value1', '--field2:number=42'],
        },
        {
          config: configPath,
        }
      );

      expect(result.success).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should return error for non-existent server', async () => {
      const result = await executeCallCommand(
        {
          server: 'nonExistent',
          tool: 'test_tool',
          args: [],
        },
        {
          config: configPath,
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error for non-existent tool', async () => {
      const result = await executeCallCommand(
        {
          server: 'testServer',
          tool: 'nonExistent',
          args: [],
        },
        {
          config: configPath,
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
