import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { executeExec, type ExecParams } from '../../src/commands/exec.ts';
import type { CoreExecutionOptions } from '../../src/core/core.ts';

// Mock coreExecute for testing mcpuMux calls from worker
vi.mock('../../src/core/core.ts', () => ({
  coreExecute: vi.fn(async (options) => {
    const argv = options.argv || [];
    const cmd = argv[0];

    // Handle servers command
    if (cmd === 'servers') {
      return {
        success: true,
        output: JSON.stringify({ servers: ['server1', 'server2'], total: 2 }),
        exitCode: 0,
      };
    }

    // Handle call command
    if (cmd === 'call') {
      const server = argv[1];
      const tool = argv[2];
      const params = options.params || {};

      // Simulate failure for specific server
      if (server === 'fail-server') {
        return {
          success: false,
          error: 'Connection failed',
          exitCode: 1,
        };
      }

      return {
        success: true,
        output: JSON.stringify({ server, tool, params, result: 'ok' }),
        exitCode: 0,
      };
    }

    return {
      success: true,
      output: JSON.stringify({ argv }),
      exitCode: 0,
    };
  }),
}));

describe('Exec Command', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `mcpu-exec-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  const baseOptions: CoreExecutionOptions = {
    argv: [],
  };

  describe('parameter validation', () => {
    it('should reject when neither file nor code provided', async () => {
      const params: ExecParams = {};
      const result = await executeExec(params, baseOptions);

      expect(result.success).toBe(false);
      expect(result.error).toContain('requires either file or code');
    });

    it('should reject when both file and code provided', async () => {
      const params: ExecParams = {
        file: 'test.js',
        code: 'return 1',
      };
      const result = await executeExec(params, baseOptions);

      expect(result.success).toBe(false);
      expect(result.error).toContain('either file or code, not both');
    });

    it('should reject when file does not exist', async () => {
      const params: ExecParams = {
        file: join(testDir, 'nonexistent.js'),
      };
      const result = await executeExec(params, baseOptions);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to read file');
    });
  });

  describe('inline code execution', () => {
    it('should execute simple inline code and return result', async () => {
      const params: ExecParams = {
        code: 'return 42',
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(true);
      expect(result.output).toBe('42');
    });

    it('should execute code that returns string', async () => {
      const params: ExecParams = {
        code: 'return "hello world"',
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(true);
      expect(result.output).toBe('hello world');
    });

    it('should execute code that returns object', async () => {
      const params: ExecParams = {
        code: 'return { foo: "bar", count: 123 }',
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output!);
      expect(output).toEqual({ foo: 'bar', count: 123 });
    });

    it('should handle undefined return', async () => {
      const params: ExecParams = {
        code: 'const x = 1',
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(true);
      expect(result.output).toBe('');
    });

    it('should handle async code', async () => {
      const params: ExecParams = {
        code: `
          await new Promise(resolve => setTimeout(resolve, 10));
          return "async done";
        `,
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(true);
      expect(result.output).toBe('async done');
    });
  });

  describe('file-based execution', () => {
    it('should execute code from file', async () => {
      const scriptPath = join(testDir, 'script.js');
      await writeFile(scriptPath, 'return { result: "from file" }');

      const params: ExecParams = {
        file: scriptPath,
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output!);
      expect(output).toEqual({ result: 'from file' });
    });

    it('should resolve relative file paths from cwd', async () => {
      const scriptPath = join(testDir, 'script.js');
      await writeFile(scriptPath, 'return "relative"');

      const params: ExecParams = {
        file: 'script.js',
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(true);
      expect(result.output).toBe('relative');
    });
  });

  describe('mcpuMux integration', () => {
    it('should allow calling mcpuMux from code', async () => {
      const params: ExecParams = {
        code: `
          const result = await mcpuMux({ argv: ['servers'] });
          return result;
        `,
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output!);
      expect(output.servers).toEqual(['server1', 'server2']);
    });

    it('should allow multiple mcpuMux calls', async () => {
      const params: ExecParams = {
        code: `
          const servers = await mcpuMux({ argv: ['servers'] });
          const call1 = await mcpuMux({ argv: ['call', 'server1', 'tool1'], params: { x: 1 } });
          const call2 = await mcpuMux({ argv: ['call', 'server2', 'tool2'], params: { y: 2 } });
          return { servers, call1, call2 };
        `,
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output!);
      expect(output.servers.total).toBe(2);
      expect(output.call1.server).toBe('server1');
      expect(output.call2.server).toBe('server2');
    });

    it('should handle mcpuMux call failures', async () => {
      const params: ExecParams = {
        code: `
          try {
            await mcpuMux({ argv: ['call', 'fail-server', 'tool'] });
            return { caught: false };
          } catch (err) {
            return { caught: true, error: err.message };
          }
        `,
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output!);
      expect(output.caught).toBe(true);
      expect(output.error).toContain('Connection failed');
    });

    it('should allow parallel mcpuMux calls', async () => {
      const params: ExecParams = {
        code: `
          const results = await Promise.all([
            mcpuMux({ argv: ['call', 'server1', 'tool1'] }),
            mcpuMux({ argv: ['call', 'server2', 'tool2'] }),
            mcpuMux({ argv: ['call', 'server3', 'tool3'] }),
          ]);
          return results;
        `,
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output!);
      expect(output).toHaveLength(3);
    });
  });

  describe('require access', () => {
    it('should provide require function for built-in modules', async () => {
      const params: ExecParams = {
        code: `
          const path = require('path');
          return path.join('a', 'b', 'c');
        `,
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(true);
      // Result depends on OS, just check it worked
      expect(result.output).toContain('a');
      expect(result.output).toContain('b');
      expect(result.output).toContain('c');
    });
  });

  describe('error handling', () => {
    it('should handle syntax errors', async () => {
      const params: ExecParams = {
        code: 'return {{{invalid syntax',
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(false);
      // Should contain error message
      expect(result.error).toBeDefined();
    });

    it('should handle runtime errors', async () => {
      const params: ExecParams = {
        code: `
          const obj = null;
          return obj.foo.bar;
        `,
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle thrown errors', async () => {
      const params: ExecParams = {
        code: 'throw new Error("intentional error")',
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(false);
      expect(result.error).toContain('intentional error');
    });
  });

  describe('timeout handling', () => {
    it('should timeout long-running code', async () => {
      const params: ExecParams = {
        code: `
          await new Promise(resolve => setTimeout(resolve, 10000));
          return "never reached";
        `,
        timeout: 100, // 100ms timeout
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
      expect(result.exitCode).toBe(124);
    });

    it('should complete before timeout', async () => {
      const params: ExecParams = {
        code: `
          await new Promise(resolve => setTimeout(resolve, 10));
          return "completed";
        `,
        timeout: 5000, // 5s timeout
      };
      const result = await executeExec(params, { ...baseOptions, cwd: testDir });

      expect(result.success).toBe(true);
      expect(result.output).toBe('completed');
    });
  });
});
