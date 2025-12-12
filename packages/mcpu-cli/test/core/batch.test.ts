import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import {
  validateBatchParams,
  groupCallsByServer,
  extractServerFromCall,
  executeBatch,
  formatBatchResponse,
  MAX_BATCH_SIZE,
  MAX_CONCURRENT_SERVERS,
  type BatchParams,
  type BatchCall,
  type BatchCallResult,
} from '../../src/core/batch.ts';

// Mock coreExecute to avoid actual connections
vi.mock('../../src/core/core.ts', () => ({
  coreExecute: vi.fn(async (options) => {
    const argv = options.argv || [];
    const cmd = argv[0];
    const server = argv[1];
    const tool = argv[2];

    // Simulate different responses based on server/tool
    if (server === 'fail-server') {
      return {
        success: false,
        error: 'Connection failed',
        exitCode: 1,
      };
    }

    if (tool === 'slow-tool') {
      // Simulate slow tool for timeout tests
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return {
      success: true,
      output: JSON.stringify({ server, tool, result: 'ok' }),
      exitCode: 0,
    };
  }),
}));

describe('Batch Command', () => {
  describe('validateBatchParams', () => {
    it('should accept valid batch params', () => {
      const params: BatchParams = {
        calls: {
          '1': { argv: ['call', 'server1', 'tool1'] },
          '2': { argv: ['call', 'server2', 'tool2'] },
        },
      };

      const errors = validateBatchParams(params);
      expect(errors).toHaveLength(0);
    });

    it('should reject empty calls object', () => {
      const params: BatchParams = { calls: {} };

      const errors = validateBatchParams(params);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('no calls');
    });

    it('should reject batch exceeding size limit', () => {
      const calls: Record<string, BatchCall> = {};
      for (let i = 0; i < MAX_BATCH_SIZE + 1; i++) {
        calls[String(i)] = { argv: ['call', 'server', 'tool'] };
      }

      const params: BatchParams = { calls };
      const errors = validateBatchParams(params);

      expect(errors.some((e) => e.message.includes('exceeds limit'))).toBe(true);
    });

    it('should reject nested batch command', () => {
      const params: BatchParams = {
        calls: {
          '1': { argv: ['batch'] },
        },
      };

      const errors = validateBatchParams(params);
      expect(errors.some((e) => e.message.includes('not allowed'))).toBe(true);
    });

    it('should reject mutation commands', () => {
      const mutationCommands = ['connect', 'disconnect', 'reconnect', 'reload', 'setConfig'];

      for (const cmd of mutationCommands) {
        const params: BatchParams = {
          calls: {
            '1': { argv: [cmd, 'server'] },
          },
        };

        const errors = validateBatchParams(params);
        expect(errors.some((e) => e.message.includes('not allowed'))).toBe(true);
      }
    });

    it('should accept allowed commands', () => {
      const allowedCommands = [
        ['call', 'server', 'tool'],
        ['servers'],
        ['tools'],
        ['tools', 'server1'],
        ['info', 'server'],
        ['info', 'server', 'tool1', 'tool2'],
      ];

      for (const argv of allowedCommands) {
        const params: BatchParams = {
          calls: {
            '1': { argv },
          },
        };

        const errors = validateBatchParams(params);
        expect(errors).toHaveLength(0);
      }
    });

    it('should reject call command without server and tool', () => {
      const params: BatchParams = {
        calls: {
          '1': { argv: ['call'] },
        },
      };

      const errors = validateBatchParams(params);
      expect(errors.some((e) => e.message.includes('requires server and tool'))).toBe(true);
    });

    it('should reject info command without server', () => {
      const params: BatchParams = {
        calls: {
          '1': { argv: ['info'] },
        },
      };

      const errors = validateBatchParams(params);
      expect(errors.some((e) => e.message.includes('requires server'))).toBe(true);
    });

    it('should reject invalid response_mode', () => {
      const params: BatchParams = {
        calls: {
          '1': { argv: ['call', 'server', 'tool'] },
        },
        response_mode: 'invalid' as any,
      };

      const errors = validateBatchParams(params);
      expect(errors.some((e) => e.message.includes('Invalid response_mode'))).toBe(true);
    });

    it('should accept valid response_mode values', () => {
      const modes = ['auto', 'full', 'summary', 'refs'] as const;

      for (const mode of modes) {
        const params: BatchParams = {
          calls: {
            '1': { argv: ['call', 'server', 'tool'] },
          },
          response_mode: mode,
        };

        const errors = validateBatchParams(params);
        expect(errors).toHaveLength(0);
      }
    });

    it('should reject invalid timeout', () => {
      const params: BatchParams = {
        calls: {
          '1': { argv: ['call', 'server', 'tool'] },
        },
        timeout: -1,
      };

      const errors = validateBatchParams(params);
      expect(errors.some((e) => e.message.includes('timeout'))).toBe(true);
    });
  });

  describe('extractServerFromCall', () => {
    it('should extract server from call command', () => {
      const call: BatchCall = { argv: ['call', 'myserver', 'mytool'] };
      expect(extractServerFromCall(call)).toBe('myserver');
    });

    it('should extract server from info command', () => {
      const call: BatchCall = { argv: ['info', 'myserver', 'tool1'] };
      expect(extractServerFromCall(call)).toBe('myserver');
    });

    it('should extract server from tools command with server', () => {
      const call: BatchCall = { argv: ['tools', 'myserver'] };
      expect(extractServerFromCall(call)).toBe('myserver');
    });

    it('should return __global__ for tools command without server', () => {
      const call: BatchCall = { argv: ['tools'] };
      expect(extractServerFromCall(call)).toBe('__global__');
    });

    it('should return __global__ for servers command', () => {
      const call: BatchCall = { argv: ['servers'] };
      expect(extractServerFromCall(call)).toBe('__global__');
    });
  });

  describe('groupCallsByServer', () => {
    it('should group calls by server', () => {
      const calls: Record<string, BatchCall> = {
        '1': { argv: ['call', 'server1', 'tool1'] },
        '2': { argv: ['call', 'server2', 'tool2'] },
        '3': { argv: ['call', 'server1', 'tool3'] },
      };

      const groups = groupCallsByServer(calls);

      expect(groups).toHaveLength(2);

      const server1Group = groups.find((g) => g.server === 'server1');
      const server2Group = groups.find((g) => g.server === 'server2');

      expect(server1Group?.calls).toHaveLength(2);
      expect(server2Group?.calls).toHaveLength(1);
    });

    it('should sort calls within group by lexicographic key order', () => {
      const calls: Record<string, BatchCall> = {
        '10': { argv: ['call', 'server1', 'tool10'] },
        '2': { argv: ['call', 'server1', 'tool2'] },
        '1': { argv: ['call', 'server1', 'tool1'] },
      };

      const groups = groupCallsByServer(calls);
      const server1Group = groups.find((g) => g.server === 'server1');

      // Lexicographic order: "1" < "10" < "2"
      expect(server1Group?.calls.map((c) => c.id)).toEqual(['1', '10', '2']);
    });

    it('should handle zero-padded keys correctly', () => {
      const calls: Record<string, BatchCall> = {
        '02': { argv: ['call', 'server1', 'tool2'] },
        '10': { argv: ['call', 'server1', 'tool10'] },
        '01': { argv: ['call', 'server1', 'tool1'] },
      };

      const groups = groupCallsByServer(calls);
      const server1Group = groups.find((g) => g.server === 'server1');

      // Zero-padded: "01" < "02" < "10"
      expect(server1Group?.calls.map((c) => c.id)).toEqual(['01', '02', '10']);
    });

    it('should group global commands together', () => {
      const calls: Record<string, BatchCall> = {
        '1': { argv: ['servers'] },
        '2': { argv: ['tools'] },
        '3': { argv: ['call', 'server1', 'tool1'] },
      };

      const groups = groupCallsByServer(calls);

      const globalGroup = groups.find((g) => g.server === '__global__');
      expect(globalGroup?.calls).toHaveLength(2);
    });
  });

  describe('formatBatchResponse', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `mcpu-batch-test-${Date.now()}`);
      await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
      if (existsSync(testDir)) {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('should format results with summary', async () => {
      const results = new Map<string, BatchCallResult>([
        ['1', { success: true, output: { data: 'result1' } }],
        ['2', { success: true, output: { data: 'result2' } }],
        ['3', { success: false, error: 'Failed' }],
      ]);

      const batchResult = await formatBatchResponse(
        results,
        ['1', '2', '3'],
        false,
        'full',
        testDir
      );

      expect(batchResult.summary.total).toBe(3);
      expect(batchResult.summary.succeeded).toBe(2);
      expect(batchResult.summary.failed).toBe(1);
      expect(batchResult.order).toEqual(['1', '2', '3']);
    });

    it('should set timedOut flag when batch times out', async () => {
      const results = new Map<string, BatchCallResult>([
        ['1', { success: true, output: 'ok' }],
        ['2', { success: false, error: 'Batch timeout exceeded' }],
      ]);

      const batchResult = await formatBatchResponse(
        results,
        ['1'],
        true,
        'full',
        testDir
      );

      expect(batchResult.timedOut).toBe(true);
    });

    it('should save large results to files in refs mode', async () => {
      const largeData = { data: 'x'.repeat(1000) };
      const results = new Map<string, BatchCallResult>([
        ['1', { success: true, output: largeData }],
      ]);

      const batchResult = await formatBatchResponse(
        results,
        ['1'],
        false,
        'refs',
        testDir
      );

      expect(batchResult.saved_files).toBeDefined();
      expect(batchResult.saved_files!.length).toBeGreaterThan(0);
      expect(batchResult.results['1'].truncated).toBe(true);
      expect(batchResult.results['1'].file).toBeDefined();
    });
  });

  describe('executeBatch', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `mcpu-batch-exec-test-${Date.now()}`);
      await mkdir(testDir, { recursive: true });
      vi.clearAllMocks();
    });

    afterEach(async () => {
      if (existsSync(testDir)) {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('should execute batch calls successfully', async () => {
      const params: BatchParams = {
        calls: {
          '1': { argv: ['call', 'server1', 'tool1'] },
          '2': { argv: ['call', 'server2', 'tool2'] },
        },
      };

      const result = await executeBatch(params, { argv: [], cwd: testDir });

      expect(result.success).toBe(true);

      const batchResult = JSON.parse(result.output!);
      expect(batchResult.summary.total).toBe(2);
      expect(batchResult.summary.succeeded).toBe(2);
      expect(batchResult.summary.failed).toBe(0);
    });

    it('should handle individual call failures without aborting', async () => {
      const params: BatchParams = {
        calls: {
          '1': { argv: ['call', 'good-server', 'tool1'] },
          '2': { argv: ['call', 'fail-server', 'tool2'] },
          '3': { argv: ['call', 'good-server', 'tool3'] },
        },
      };

      const result = await executeBatch(params, { argv: [], cwd: testDir });

      const batchResult = JSON.parse(result.output!);
      expect(batchResult.summary.total).toBe(3);
      expect(batchResult.summary.succeeded).toBe(2);
      expect(batchResult.summary.failed).toBe(1);
      expect(batchResult.results['2'].success).toBe(false);
    });

    it('should return validation error for invalid params', async () => {
      const params: BatchParams = {
        calls: {
          '1': { argv: ['batch'] }, // Nested batch not allowed
        },
      };

      const result = await executeBatch(params, { argv: [], cwd: testDir });

      expect(result.success).toBe(false);
      expect(result.error).toContain('validation failed');
    });

    it('should reject batch exceeding concurrent server limit', async () => {
      const calls: Record<string, BatchCall> = {};
      for (let i = 0; i < MAX_CONCURRENT_SERVERS + 1; i++) {
        calls[String(i)] = { argv: ['call', `server${i}`, 'tool'] };
      }

      const params: BatchParams = { calls };
      const result = await executeBatch(params, { argv: [], cwd: testDir });

      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds limit');
    });

    it('should execute calls to same server serially', async () => {
      const executionOrder: string[] = [];
      const { coreExecute } = await import('../../src/core/core.ts');

      vi.mocked(coreExecute).mockImplementation(async (options) => {
        const tool = options.argv?.[2];
        executionOrder.push(tool);
        // Add small delay to ensure order is tracked
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { success: true, output: JSON.stringify({ tool }), exitCode: 0 };
      });

      const params: BatchParams = {
        calls: {
          '1': { argv: ['call', 'server1', 'tool1'] },
          '2': { argv: ['call', 'server1', 'tool2'] },
          '3': { argv: ['call', 'server1', 'tool3'] },
        },
      };

      await executeBatch(params, { argv: [], cwd: testDir });

      // Within same server, should execute in key order
      expect(executionOrder).toEqual(['tool1', 'tool2', 'tool3']);
    });
  });
});
