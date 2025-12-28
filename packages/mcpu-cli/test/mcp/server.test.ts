import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpuMcpServer } from '../../src/mcp/server.js';

// Mock the MCP SDK
const mockTool = vi.fn();
const mockConnect = vi.fn();
const mockListRoots = vi.fn();
const mockGetClientCapabilities = vi.fn();
const mockSetNotificationHandler = vi.fn();
let mockOninitialized: (() => Promise<void>) | undefined;

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(() => ({
    tool: mockTool,
    connect: mockConnect,
    server: {
      listRoots: mockListRoots,
      getClientCapabilities: mockGetClientCapabilities,
      setNotificationHandler: mockSetNotificationHandler,
      get oninitialized() {
        return mockOninitialized;
      },
      set oninitialized(handler: (() => Promise<void>) | undefined) {
        mockOninitialized = handler;
      },
    },
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
  getConnectionKey: (serverName: string, connId?: string) => connId ? `${serverName}[${connId}]` : serverName,
  parseConnectionKey: (key: string) => {
    const match = key.match(/^(.+?)\[(.+)\]$/);
    if (match) return { server: match[1], connId: match[2] };
    return { server: key };
  },
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
        'mux',
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
        batch: undefined,
        cwd: process.cwd(),
        projectDir: undefined,
        connectionPool: expect.any(Object),
        configs: expect.any(Map),
        configDiscovery: undefined,
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
        batch: undefined,
        cwd: process.cwd(),
        projectDir: undefined,
        connectionPool: expect.any(Object),
        configs: expect.any(Map),
        configDiscovery: undefined,
      });

      expect(result.isError).toBe(false);
    });

    it('should execute setConfig command with params.extraArgs', async () => {
      mockCoreExecute.mockResolvedValue({
        success: true,
        output: 'Config updated',
        exitCode: 0,
      });

      const result = await toolHandler({
        argv: ['setConfig', 'playwright'],
        params: { extraArgs: ['--isolated'] },
      });

      expect(mockCoreExecute).toHaveBeenCalledWith({
        argv: ['setConfig', 'playwright'],
        params: { extraArgs: ['--isolated'] },
        batch: undefined,
        cwd: process.cwd(),
        projectDir: undefined,
        connectionPool: expect.any(Object),
        configs: expect.any(Map),
        configDiscovery: undefined,
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
        batch: undefined,
        cwd: '/custom/path',
        projectDir: undefined,
        connectionPool: expect.any(Object),
        configs: expect.any(Map),
        configDiscovery: undefined,
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

  describe('roots support', () => {
    let toolHandler: Function;

    beforeEach(() => {
      // Extract the tool handler from the mock call
      toolHandler = mockTool.mock.calls[0][3];
    });

    it('should register notification handler for roots/list_changed', () => {
      expect(mockSetNotificationHandler).toHaveBeenCalled();
    });

    it('should capture roots from client on initialization', async () => {
      mockGetClientCapabilities.mockReturnValue({ roots: true });
      mockListRoots.mockResolvedValue({
        roots: [
          { uri: 'file:///Users/test/project' },
          { uri: 'file:///Users/test/workspace' },
        ],
      });

      // Trigger oninitialized
      if (mockOninitialized) {
        await mockOninitialized();
      }

      expect(mockGetClientCapabilities).toHaveBeenCalled();
      expect(mockListRoots).toHaveBeenCalled();
    });

    it('should use first root as default projectDir', async () => {
      mockGetClientCapabilities.mockReturnValue({ roots: true });
      mockListRoots.mockResolvedValue({
        roots: [{ uri: 'file:///Users/test/project' }],
      });
      mockCoreExecute.mockResolvedValue({
        success: true,
        output: 'Success',
        exitCode: 0,
      });

      // Trigger oninitialized to set projectDir
      if (mockOninitialized) {
        await mockOninitialized();
      }

      // Execute a command without explicit projectDir
      await toolHandler({
        argv: ['servers'],
      });

      // Should use the root as projectDir
      expect(mockCoreExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          projectDir: '/Users/test/project',
        })
      );
    });

    it('should decode URI-encoded roots', async () => {
      mockGetClientCapabilities.mockReturnValue({ roots: true });
      mockListRoots.mockResolvedValue({
        roots: [{ uri: 'file:///Users/test/my%20project' }],
      });
      mockCoreExecute.mockResolvedValue({
        success: true,
        output: 'Success',
        exitCode: 0,
      });

      // Trigger oninitialized
      if (mockOninitialized) {
        await mockOninitialized();
      }

      // Execute a command
      await toolHandler({
        argv: ['servers'],
      });

      // Should decode the URI
      expect(mockCoreExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          projectDir: '/Users/test/my project',
        })
      );
    });

    it('should allow explicit projectDir to override roots', async () => {
      mockGetClientCapabilities.mockReturnValue({ roots: true });
      mockListRoots.mockResolvedValue({
        roots: [{ uri: 'file:///Users/test/root-project' }],
      });
      mockCoreExecute.mockResolvedValue({
        success: true,
        output: 'Success',
        exitCode: 0,
      });

      // Trigger oninitialized
      if (mockOninitialized) {
        await mockOninitialized();
      }

      // Execute a command with explicit projectDir
      await toolHandler({
        argv: ['servers'],
        projectDir: '/custom/project',
      });

      // Should use explicit projectDir, not the root
      expect(mockCoreExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          projectDir: '/custom/project',
        })
      );
    });

    it('should handle client without roots capability', async () => {
      mockGetClientCapabilities.mockReturnValue({});
      mockCoreExecute.mockResolvedValue({
        success: true,
        output: 'Success',
        exitCode: 0,
      });

      // Trigger oninitialized
      if (mockOninitialized) {
        await mockOninitialized();
      }

      // Execute a command
      await toolHandler({
        argv: ['servers'],
      });

      // listRoots should not be called
      expect(mockListRoots).not.toHaveBeenCalled();

      // Should use process cwd as projectDir
      expect(mockCoreExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          projectDir: undefined,
        })
      );
    });

    it('should handle roots/list_changed notification', async () => {
      // Get the notification handler that was registered
      const notificationHandlerCall = mockSetNotificationHandler.mock.calls[0];
      const notificationHandler = notificationHandlerCall[1];

      // Setup new roots
      mockListRoots.mockResolvedValue({
        roots: [{ uri: 'file:///Users/test/new-project' }],
      });
      mockCoreExecute.mockResolvedValue({
        success: true,
        output: 'Success',
        exitCode: 0,
      });

      // Trigger the notification handler
      await notificationHandler();

      // Execute a command
      await toolHandler({
        argv: ['servers'],
      });

      // Should use the updated root
      expect(mockCoreExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          projectDir: '/Users/test/new-project',
        })
      );
    });

    it('should use process cwd as fallback for cwd parameter', async () => {
      mockCoreExecute.mockResolvedValue({
        success: true,
        output: 'Success',
        exitCode: 0,
      });

      // Execute a command without explicit cwd
      await toolHandler({
        argv: ['servers'],
      });

      // Should use process cwd
      expect(mockCoreExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: process.cwd(),
        })
      );
    });

    it('should allow explicit cwd to override default', async () => {
      mockCoreExecute.mockResolvedValue({
        success: true,
        output: 'Success',
        exitCode: 0,
      });

      // Execute a command with explicit cwd
      await toolHandler({
        argv: ['servers'],
        cwd: '/custom/cwd',
      });

      // Should use explicit cwd
      expect(mockCoreExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/custom/cwd',
        })
      );
    });
  });
});
