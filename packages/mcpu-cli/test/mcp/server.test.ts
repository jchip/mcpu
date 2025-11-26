import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpuMcpServer } from '../../src/mcp/server.js';

// Mock the MCP SDK
const mockTool = vi.fn();
const mockConnect = vi.fn();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(() => ({
    tool: mockTool,
    connect: mockConnect,
  })),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn().mockImplementation(() => ({})),
}));

// Mock coreExecute
const mockCoreExecute = vi.fn();
vi.mock('../../src/core/core.js', () => ({
  coreExecute: (...args: any[]) => mockCoreExecute(...args),
}));

// Mock ConnectionPool
vi.mock('../../src/daemon/connection-pool.js', () => ({
  ConnectionPool: vi.fn().mockImplementation(() => ({
    getConnection: vi.fn(),
    disconnect: vi.fn(),
    shutdown: vi.fn(),
    listConnections: vi.fn().mockReturnValue([]),
  })),
}));

// Mock ConfigDiscovery
vi.mock('../../src/config.js', () => ({
  ConfigDiscovery: vi.fn().mockImplementation(() => ({
    loadConfigs: vi.fn().mockResolvedValue(
      new Map([
        ['testServer', { command: 'test-command', args: ['--arg1'] }],
      ])
    ),
  })),
}));

// Mock VERSION
vi.mock('../../src/version.js', () => ({
  VERSION: '0.0.0-test',
}));

describe('McpuMcpServer', () => {
  let server: McpuMcpServer;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpuMcpServer();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create server with default options', () => {
      expect(server).toBeDefined();
    });

    it('should create server with custom options', () => {
      const serverWithOptions = new McpuMcpServer({
        config: '/custom/config.json',
        verbose: true,
        autoDisconnect: true,
        idleTimeoutMs: 60000,
      });
      expect(serverWithOptions).toBeDefined();
    });

    it('should register cli tool', () => {
      expect(mockTool).toHaveBeenCalledWith(
        'cli',
        expect.any(String),
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe('cli tool', () => {
    let toolHandler: Function;

    beforeEach(() => {
      // Extract the tool handler from the mock call
      toolHandler = mockTool.mock.calls[0][3];
    });

    it('should execute servers command', async () => {
      mockCoreExecute.mockResolvedValue({
        success: true,
        output: 'Server list output',
        exitCode: 0,
      });

      const result = await toolHandler({
        argv: ['servers'],
      });

      expect(mockCoreExecute).toHaveBeenCalledWith({
        argv: ['servers'],
        params: undefined,
        mcpServerConfig: undefined,
        cwd: undefined,
        connectionPool: expect.any(Object),
        configs: expect.any(Map),
      });

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Server list output' }],
        isError: false,
      });
    });

    it('should execute call command with params', async () => {
      mockCoreExecute.mockResolvedValue({
        success: true,
        output: 'Tool executed',
        exitCode: 0,
      });

      const result = await toolHandler({
        argv: ['call', 'playwright', 'browser_navigate'],
        params: { url: 'https://example.com' },
      });

      expect(mockCoreExecute).toHaveBeenCalledWith({
        argv: ['call', 'playwright', 'browser_navigate'],
        params: { url: 'https://example.com' },
        mcpServerConfig: undefined,
        cwd: undefined,
        connectionPool: expect.any(Object),
        configs: expect.any(Map),
      });

      expect(result.isError).toBe(false);
    });

    it('should execute call command with mcpServerConfig', async () => {
      mockCoreExecute.mockResolvedValue({
        success: true,
        output: 'Tool executed with config',
        exitCode: 0,
      });

      const result = await toolHandler({
        argv: ['call', 'playwright', 'browser_navigate'],
        params: { url: 'https://example.com' },
        mcpServerConfig: { extraArgs: ['--isolated'] },
      });

      expect(mockCoreExecute).toHaveBeenCalledWith({
        argv: ['call', 'playwright', 'browser_navigate'],
        params: { url: 'https://example.com' },
        mcpServerConfig: { extraArgs: ['--isolated'] },
        cwd: undefined,
        connectionPool: expect.any(Object),
        configs: expect.any(Map),
      });

      expect(result.isError).toBe(false);
    });

    it('should execute command with cwd', async () => {
      mockCoreExecute.mockResolvedValue({
        success: true,
        output: 'Command executed',
        exitCode: 0,
      });

      const result = await toolHandler({
        argv: ['servers'],
        cwd: '/custom/path',
      });

      expect(mockCoreExecute).toHaveBeenCalledWith({
        argv: ['servers'],
        params: undefined,
        mcpServerConfig: undefined,
        cwd: '/custom/path',
        connectionPool: expect.any(Object),
        configs: expect.any(Map),
      });

      expect(result.isError).toBe(false);
    });

    it('should handle command failure', async () => {
      mockCoreExecute.mockResolvedValue({
        success: false,
        error: 'Command failed',
        exitCode: 1,
      });

      const result = await toolHandler({
        argv: ['call', 'invalid', 'tool'],
      });

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Command failed' }],
        isError: true,
      });
    });

    it('should handle execution error', async () => {
      mockCoreExecute.mockRejectedValue(new Error('Unexpected error'));

      const result = await toolHandler({
        argv: ['servers'],
      });

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Unexpected error' }],
        isError: true,
      });
    });

    it('should return empty string when no output or error', async () => {
      mockCoreExecute.mockResolvedValue({
        success: true,
        exitCode: 0,
      });

      const result = await toolHandler({
        argv: ['servers'],
      });

      expect(result).toEqual({
        content: [{ type: 'text', text: '' }],
        isError: false,
      });
    });

    it('should handle concurrent calls', async () => {
      let callCount = 0;
      mockCoreExecute.mockImplementation(async ({ argv }) => {
        callCount++;
        const currentCall = callCount;
        // Simulate varying execution times
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
        return {
          success: true,
          output: `Result ${currentCall}: ${argv.join(' ')}`,
          exitCode: 0,
        };
      });

      // Launch 5 concurrent calls
      const results = await Promise.all([
        toolHandler({ argv: ['servers'] }),
        toolHandler({ argv: ['tools', 'playwright'] }),
        toolHandler({ argv: ['call', 'server1', 'tool1'], params: { a: 1 } }),
        toolHandler({ argv: ['call', 'server2', 'tool2'], params: { b: 2 } }),
        toolHandler({ argv: ['connections'] }),
      ]);

      // All should succeed
      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.isError).toBe(false);
        expect(result.content[0].text).toMatch(/^Result \d:/);
      });

      // All calls should have been made
      expect(mockCoreExecute).toHaveBeenCalledTimes(5);
    });
  });

  describe('start', () => {
    it('should load configs and connect transport', async () => {
      mockConnect.mockResolvedValue(undefined);

      await server.start();

      expect(mockConnect).toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('should shutdown connection pool', async () => {
      const pool = (server as any).pool;

      await server.shutdown();

      expect(pool.shutdown).toHaveBeenCalled();
    });
  });
});
