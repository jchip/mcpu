import { describe, it, expect, vi, beforeEach } from 'vitest';
import { coreExecute } from '../../src/core/core.js';

// Mock the executor module
vi.mock('../../src/core/executor.js', () => ({
  executeCommand: vi.fn().mockResolvedValue({
    success: true,
    output: 'Command executed',
    exitCode: 0,
  }),
}));

import { executeCommand } from '../../src/core/executor.js';

describe('Core - coreExecute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('params to stdinData conversion', () => {
    it('should convert params object to JSON string as stdinData for call command', async () => {
      const params = {
        field1: 'value1',
        field2: 42,
        nested: { key: 'value' },
      };

      await coreExecute({
        argv: ['call', 'server', 'tool'],
        params,
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'call',
        expect.objectContaining({
          server: 'server',
          tool: 'tool',
          stdinData: JSON.stringify(params),
        }),
        expect.any(Object)
      );
    });

    it('should not set stdinData when params is undefined', async () => {
      await coreExecute({
        argv: ['call', 'server', 'tool'],
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'call',
        expect.objectContaining({
          stdinData: undefined,
        }),
        expect.any(Object)
      );
    });

    it('should handle empty params object', async () => {
      await coreExecute({
        argv: ['call', 'server', 'tool'],
        params: {},
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'call',
        expect.objectContaining({
          stdinData: '{}',
        }),
        expect.any(Object)
      );
    });

    it('should handle arrays in params', async () => {
      const params = {
        items: ['item1', 'item2', 'item3'],
      };

      await coreExecute({
        argv: ['call', 'server', 'tool'],
        params,
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'call',
        expect.objectContaining({
          stdinData: JSON.stringify(params),
        }),
        expect.any(Object)
      );
    });
  });

  describe('command parsing', () => {
    it('should parse call command with server and tool', async () => {
      await coreExecute({
        argv: ['call', 'myServer', 'myTool'],
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'call',
        expect.objectContaining({
          server: 'myServer',
          tool: 'myTool',
        }),
        expect.any(Object)
      );
    });

    it('should parse call command with arguments', async () => {
      await coreExecute({
        argv: ['call', 'server', 'tool', '--arg1=value1', '--arg2=value2'],
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'call',
        expect.objectContaining({
          server: 'server',
          tool: 'tool',
          args: ['--arg1=value1', '--arg2=value2'],
        }),
        expect.any(Object)
      );
    });

    it('should parse call command with --stdin flag', async () => {
      await coreExecute({
        argv: ['call', 'server', 'tool', '--stdin'],
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'call',
        expect.any(Object),
        expect.objectContaining({
          stdin: true,
        })
      );
    });

    it('should parse call command with both --stdin and params', async () => {
      const params = { field: 'value' };

      await coreExecute({
        argv: ['call', 'server', 'tool', '--stdin'],
        params,
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'call',
        expect.objectContaining({
          stdinData: JSON.stringify(params),
        }),
        expect.objectContaining({
          stdin: true,
        })
      );
    });
  });

  describe('global options', () => {
    it('should parse --json flag', async () => {
      await coreExecute({
        argv: ['--json', 'servers'],
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'servers',
        expect.any(Object),
        expect.objectContaining({
          json: true,
        })
      );
    });

    it('should parse --yaml flag', async () => {
      await coreExecute({
        argv: ['--yaml', 'tools'],
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'tools',
        expect.any(Object),
        expect.objectContaining({
          yaml: true,
        })
      );
    });

    it('should parse --raw flag', async () => {
      await coreExecute({
        argv: ['--raw', 'info', 'server', 'tool'],
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'info',
        expect.any(Object),
        expect.objectContaining({
          raw: true,
        })
      );
    });

    it('should parse --verbose flag', async () => {
      await coreExecute({
        argv: ['--verbose', 'call', 'server', 'tool'],
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'call',
        expect.any(Object),
        expect.objectContaining({
          verbose: true,
        })
      );
    });

    it('should pass through cwd option', async () => {
      await coreExecute({
        argv: ['servers'],
        cwd: '/custom/path',
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'servers',
        expect.any(Object),
        expect.objectContaining({
          cwd: '/custom/path',
        })
      );
    });

    it('should pass through connectionPool', async () => {
      const mockPool = { getConnection: vi.fn() };

      await coreExecute({
        argv: ['call', 'server', 'tool'],
        connectionPool: mockPool as any,
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'call',
        expect.any(Object),
        expect.objectContaining({
          connectionPool: mockPool,
        })
      );
    });
  });

  describe('other commands', () => {
    it('should parse servers command', async () => {
      await coreExecute({
        argv: ['servers'],
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'servers',
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should parse tools command with server names', async () => {
      await coreExecute({
        argv: ['tools', 'server1', 'server2'],
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'tools',
        expect.objectContaining({
          servers: ['server1', 'server2'],
        }),
        expect.any(Object)
      );
    });

    it('should parse info command', async () => {
      await coreExecute({
        argv: ['info', 'server', 'tool1', 'tool2'],
      });

      expect(executeCommand).toHaveBeenCalledWith(
        'info',
        expect.objectContaining({
          server: 'server',
          tools: ['tool1', 'tool2'],
        }),
        expect.any(Object)
      );
    });
  });

  describe('error handling', () => {
    it('should return error for missing command', async () => {
      const result = await coreExecute({
        argv: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No command specified');
    });

    it('should return error for unknown command', async () => {
      const result = await coreExecute({
        argv: ['unknownCommand'],
      });

      expect(result.success).toBe(false);
      expect(result.output).toBeDefined();
      expect(result.output).toContain('unknown CLI argument');
    });

    it('should handle executor errors', async () => {
      (executeCommand as any).mockRejectedValue(new Error('Executor error'));

      const result = await coreExecute({
        argv: ['servers'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Executor error');
    });
  });
});
