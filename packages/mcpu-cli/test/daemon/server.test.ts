import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { DaemonServer } from '../../src/daemon/server.js';
import { ConnectionPool } from '../../src/daemon/connection-pool.js';
import { loadConfig } from '../../src/config.js';
import type { MCPConnection, MCPServerConfig } from '../../src/types.js';

// Mock the modules
vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn(),
  ConfigDiscovery: vi.fn().mockImplementation(() => ({
    loadConfigs: vi.fn().mockResolvedValue(
      new Map([
        ['testServer', { command: 'test-command', args: ['--arg1'] }],
        ['anotherServer', { command: 'another-command', args: [] }],
      ])
    ),
    getGlobalConfig: vi.fn().mockReturnValue({}),
    getAutoSaveConfig: vi.fn().mockReturnValue({
      enabled: false,
      thresholdSize: 10240,
      dir: '.temp/mcpu-responses',
      previewSize: 500,
    }),
  })),
  AUTO_SAVE_DEFAULTS: {
    enabled: true,
    thresholdSize: 10240,
    dir: '.temp/mcpu-responses',
    previewSize: 500,
  },
}));

vi.mock('../../src/daemon/connection-pool.js', () => ({
  ConnectionPool: vi.fn().mockImplementation(() => ({
    getConnection: vi.fn().mockResolvedValue({
      id: 1,
      server: 'testServer',
      connection: {
        client: { callTool: vi.fn().mockResolvedValue({ content: [] }) },
        transport: { close: vi.fn() },
        serverName: 'testServer',
      },
      status: 'connected',
      connectedAt: Date.now(),
      lastUsed: Date.now(),
      closedAt: null,
    }),
    disconnect: vi.fn(),
    disconnectById: vi.fn(),
    listConnections: vi.fn().mockReturnValue([]),
    listServerConnections: vi.fn().mockReturnValue([]),
    getConnectionById: vi.fn(),
    getConnectionByServer: vi.fn(),
    getRawConnection: vi.fn(),
    shutdown: vi.fn(),
  })),
  getConnectionKey: (serverName: string, connId?: string) => connId ? `${serverName}[${connId}]` : serverName,
  parseConnectionKey: (key: string) => {
    const match = key.match(/^(.+?)\[(.+)\]$/);
    if (match) return { server: match[1], connId: match[2] };
    return { server: key };
  },
}));

vi.mock('../../src/daemon/pid-manager.js', () => ({
  PidManager: vi.fn().mockImplementation(() => ({
    saveDaemonInfo: vi.fn(),
    cleanupOldPidFiles: vi.fn(),
    removeDaemonInfo: vi.fn(),
  })),
}));

// Mock MCPClient for /cli endpoint tests
vi.mock('../../src/client.js', () => ({
  MCPClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue({
      client: { callTool: vi.fn() },
      transport: { close: vi.fn() },
      serverName: 'testServer',
    }),
    withConnection: vi.fn(async (name, config, callback) => {
      return await callback({
        client: { callTool: vi.fn() },
        transport: { close: vi.fn() },
        serverName: name,
      });
    }),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Success' }],
    }),
    disconnect: vi.fn(),
    listTools: vi.fn().mockResolvedValue([]),
  })),
}));

// Mock SchemaCache for /cli endpoint tests
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
    getWithExpiry: vi.fn().mockResolvedValue({
      tools: [{
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: {
            field1: { type: 'string' },
            field2: { type: 'number' },
          },
        },
      }],
      expired: false,
    }),
    set: vi.fn(),
  })),
}));

describe('Daemon Server', () => {
  let daemonServer: DaemonServer;
  let app: express.Express;
  let pool: any;
  let mockConnection: MCPConnection;
  let mockConfig: Record<string, MCPServerConfig>;

  beforeEach(() => {
    // Setup mock connection
    mockConnection = {
      client: {
        listTools: vi.fn().mockResolvedValue({
          tools: [
            {
              name: 'test_tool',
              description: 'A test tool',
              inputSchema: {
                type: 'object',
                properties: {
                  arg1: { type: 'string' },
                },
              },
            },
          ],
        }),
        callTool: vi.fn().mockResolvedValue({
          content: [
            { type: 'text', text: 'Tool executed successfully' },
          ],
        }),
      },
      transport: {
        close: vi.fn(),
      },
    } as any;

    // Setup mock config
    mockConfig = {
      testServer: {
        command: 'test-command',
        args: ['--arg1'],
      },
      anotherServer: {
        command: 'another-command',
        args: [],
      },
    };

    (loadConfig as any).mockReturnValue({
      mcpServers: mockConfig,
    });

    // Create server
    daemonServer = new DaemonServer();
    app = daemonServer.getApp();
    pool = daemonServer.getPool();

    // Set configs and port directly for testing
    (daemonServer as any).configs = new Map(Object.entries(mockConfig));
    (daemonServer as any).port = 7839;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Envelope Response Helpers', () => {
    it('should create success response with correct structure', async () => {
      const response = await request(app)
        .get('/api/daemon')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: expect.any(Object),
        error: null,
        meta: {
          timestamp: expect.any(Number),
        },
      });
    });

    it('should create error response with correct structure', async () => {
      const response = await request(app)
        .get('/api/servers/nonExistent')
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        data: null,
        error: {
          code: 'SERVER_NOT_FOUND',
          message: expect.stringContaining('not found'),
          details: expect.any(Object),
        },
        meta: {
          timestamp: expect.any(Number),
        },
      });
    });
  });

  describe('GET /api/daemon', () => {
    it('should return daemon status', async () => {
      const response = await request(app)
        .get('/api/daemon')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          pid: expect.any(Number),
          port: expect.any(Number),
          uptime: expect.any(Number),
        },
        error: null,
      });
    });
  });

  describe('POST /api/daemon/_shutdown', () => {
    it('should shutdown the daemon', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      // Mock the shutdown method to avoid calling process.exit
      const shutdownSpy = vi.spyOn(daemonServer as any, 'shutdown').mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/daemon/_shutdown')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          pid: expect.any(Number),
          port: expect.any(Number),
          status: 'shutting_down',
          shutdownAt: expect.any(Number),
        },
        error: null,
      });

      // Wait for async shutdown to be called
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(shutdownSpy).toHaveBeenCalled();

      shutdownSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  describe('GET /api/servers', () => {
    it('should list all configured servers', async () => {
      const response = await request(app)
        .get('/api/servers')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: [
          {
            name: 'testServer',
            command: 'test-command',
            args: ['--arg1'],
          },
          {
            name: 'anotherServer',
            command: 'another-command',
            args: [],
          },
        ],
        error: null,
        meta: {
          count: 2,
          timestamp: expect.any(Number),
        },
      });
    });
  });

  describe('GET /api/servers/:server', () => {
    it('should return server configuration', async () => {
      const response = await request(app)
        .get('/api/servers/testServer')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          name: 'testServer',
          command: 'test-command',
          args: ['--arg1'],
        },
        error: null,
      });
    });

    it('should return 404 for non-existent server', async () => {
      const response = await request(app)
        .get('/api/servers/nonExistent')
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        data: null,
        error: {
          code: 'SERVER_NOT_FOUND',
          message: expect.stringContaining('not found'),
          details: {
            server: 'nonExistent',
          },
        },
      });
    });
  });

  describe('POST /api/servers/:server/connections', () => {
    it('should create new connection and return 201', async () => {
      pool.getConnection.mockResolvedValue({
        id: 1,
        server: 'testServer',
        connection: mockConnection,
        status: 'connected',
        connectedAt: Date.now(),
        lastUsed: Date.now(),
        closedAt: null,
      });

      const response = await request(app)
        .post('/api/servers/testServer/connections')
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: 1,
          server: 'testServer',
          status: 'connected',
          connectedAt: expect.any(Number),
          lastUsed: expect.any(Number),
          closedAt: null,
        },
        error: null,
      });

      expect(pool.getConnection).toHaveBeenCalledWith('testServer', mockConfig.testServer);
    });

    it('should return existing connection with 200 (idempotent)', async () => {
      const existingConnection = {
        id: 1,
        server: 'testServer',
        connection: mockConnection,
        status: 'connected',
        connectedAt: Date.now() - 10000,
        lastUsed: Date.now(),
        closedAt: null,
      };

      pool.getConnectionByServer.mockReturnValue(existingConnection);
      pool.getConnection.mockResolvedValue(existingConnection);

      const response = await request(app)
        .post('/api/servers/testServer/connections')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: 1,
          server: 'testServer',
          status: 'connected',
        },
        error: null,
      });
    });

    it('should return 404 for non-existent server', async () => {
      const response = await request(app)
        .post('/api/servers/nonExistent/connections')
        .expect(404);

      expect(response.body.error.code).toBe('SERVER_NOT_FOUND');
    });
  });

  describe('GET /api/servers/:server/connections', () => {
    it('should list connections for server', async () => {
      pool.listServerConnections.mockReturnValue([
        {
          id: 1,
          server: 'testServer',
          status: 'connected',
          connectedAt: Date.now(),
          lastUsed: Date.now(),
          closedAt: null,
        },
      ]);

      const response = await request(app)
        .get('/api/servers/testServer/connections')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: [
          {
            id: 1,
            server: 'testServer',
            status: 'connected',
          },
        ],
        error: null,
        meta: {
          count: 1,
          timestamp: expect.any(Number),
        },
      });
    });
  });

  describe('GET /api/servers/:server/connections/:id', () => {
    it('should return specific connection', async () => {
      pool.getConnectionById.mockReturnValue({
        id: 1,
        server: 'testServer',
        status: 'connected',
        connectedAt: Date.now(),
        lastUsed: Date.now(),
        closedAt: null,
      });

      const response = await request(app)
        .get('/api/servers/testServer/connections/1')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: 1,
          server: 'testServer',
          status: 'connected',
        },
        error: null,
      });
    });

    it('should return 404 for non-existent connection', async () => {
      pool.getConnectionById.mockReturnValue(null);

      const response = await request(app)
        .get('/api/servers/testServer/connections/999')
        .expect(404);

      expect(response.body.error.code).toBe('CONNECTION_NOT_FOUND');
    });

    it('should return 404 for server mismatch', async () => {
      pool.getConnectionById.mockReturnValue({
        id: 1,
        server: 'differentServer',
        status: 'connected',
        connectedAt: Date.now(),
        lastUsed: Date.now(),
        closedAt: null,
      });

      const response = await request(app)
        .get('/api/servers/testServer/connections/1')
        .expect(404);

      expect(response.body.error.code).toBe('CONNECTION_NOT_FOUND');
    });
  });

  describe('DELETE /api/servers/:server/connections/:id', () => {
    it('should disconnect connection and return deleted resource', async () => {
      pool.getConnectionById.mockReturnValue({
        id: 1,
        server: 'testServer',
        status: 'connected',
        connectedAt: Date.now(),
        lastUsed: Date.now(),
        closedAt: null,
      });

      // The endpoint uses disconnect(serverName), not disconnectById
      pool.disconnect.mockResolvedValue({
        id: 1,
        server: 'testServer',
        status: 'disconnected',
        connectedAt: Date.now() - 10000,
        lastUsed: Date.now(),
        closedAt: Date.now(),
      });

      const response = await request(app)
        .delete('/api/servers/testServer/connections/1');

      // Debug the response if it fails
      if (response.status !== 200) {
        console.log('Delete response:', response.body);
      }

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: 1,
          server: 'testServer',
          status: 'disconnected',
          closedAt: expect.any(Number),
        },
        error: null,
      });
    });
  });

  describe('GET /api/connections', () => {
    it('should list all connections', async () => {
      pool.listConnections.mockReturnValue([
        {
          id: 1,
          server: 'testServer',
          status: 'connected',
          connectedAt: Date.now(),
          lastUsed: Date.now(),
          closedAt: null,
        },
        {
          id: 2,
          server: 'anotherServer',
          status: 'connected',
          connectedAt: Date.now(),
          lastUsed: Date.now(),
          closedAt: null,
        },
      ]);

      const response = await request(app)
        .get('/api/connections')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({ id: 1, server: 'testServer' }),
          expect.objectContaining({ id: 2, server: 'anotherServer' }),
        ]),
        error: null,
        meta: {
          count: 2,
          timestamp: expect.any(Number),
        },
      });
    });
  });

  describe('GET /api/connections/:id', () => {
    it('should return connection by ID', async () => {
      pool.getConnectionById.mockReturnValue({
        id: 1,
        server: 'testServer',
        status: 'connected',
        connectedAt: Date.now(),
        lastUsed: Date.now(),
        closedAt: null,
      });

      const response = await request(app)
        .get('/api/connections/1')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: 1,
          server: 'testServer',
          status: 'connected',
        },
        error: null,
      });
    });
  });

  describe('DELETE /api/connections/:id', () => {
    it('should disconnect connection by ID', async () => {
      pool.disconnectById.mockResolvedValue({
        id: 1,
        server: 'testServer',
        status: 'disconnected',
        connectedAt: Date.now() - 10000,
        lastUsed: Date.now(),
        closedAt: Date.now(),
      });

      const response = await request(app)
        .delete('/api/connections/1')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: 1,
          status: 'disconnected',
          closedAt: expect.any(Number),
        },
        error: null,
      });
    });
  });

  describe('Tool Endpoints', () => {
    beforeEach(() => {
      pool.getRawConnection.mockReturnValue(mockConnection);
    });

    describe('GET /api/servers/:server/tools', () => {
      it('should list tools from server', async () => {
        const response = await request(app)
          .get('/api/servers/testServer/tools')
          .expect(200);

        expect(response.body).toMatchObject({
          success: true,
          data: [
            {
              name: 'test_tool',
              description: 'A test tool',
              inputSchema: expect.any(Object),
            },
          ],
          error: null,
          meta: {
            count: 1,
            timestamp: expect.any(Number),
          },
        });
      });

      it('should return error when not connected', async () => {
        pool.getRawConnection.mockReturnValue(null);

        const response = await request(app)
          .get('/api/servers/testServer/tools')
          .expect(503);

        expect(response.body.error.code).toBe('NOT_CONNECTED');
      });
    });

    describe('GET /api/servers/:server/tools/:tool', () => {
      it('should return tool details', async () => {
        const response = await request(app)
          .get('/api/servers/testServer/tools/test_tool')
          .expect(200);

        expect(response.body).toMatchObject({
          success: true,
          data: {
            name: 'test_tool',
            description: 'A test tool',
            inputSchema: expect.any(Object),
          },
          error: null,
        });
      });

      it('should return 404 for non-existent tool', async () => {
        const response = await request(app)
          .get('/api/servers/testServer/tools/nonExistent')
          .expect(404);

        expect(response.body.error.code).toBe('TOOL_NOT_FOUND');
      });
    });

    describe('POST /api/servers/:server/tools/:tool/_execute', () => {
      it('should execute tool and return result', async () => {
        const response = await request(app)
          .post('/api/servers/testServer/tools/test_tool/_execute')
          .send({ params: { arg1: 'value1' } })
          .expect(200);

        expect(response.body).toMatchObject({
          success: true,
          data: {
            tool: 'test_tool',
            server: 'testServer',
            executedAt: expect.any(Number),
            result: {
              content: [
                { type: 'text', text: 'Tool executed successfully' },
              ],
            },
          },
          error: null,
        });

        expect(mockConnection.client.callTool).toHaveBeenCalledWith(
          { name: 'test_tool', arguments: { arg1: 'value1' } },
          undefined,
          { timeout: 180000 }
        );
      });

      it('should handle tool execution error', async () => {
        mockConnection.client.callTool.mockRejectedValue(
          new Error('Tool execution failed')
        );

        const response = await request(app)
          .post('/api/servers/testServer/tools/test_tool/_execute')
          .send({ params: { arg1: 'value1' } })
          .expect(500);

        expect(response.body.error.code).toBe('TOOL_EXECUTION_FAILED');
      });
    });
  });

  describe('POST /cli endpoint', () => {
    it('should execute command with argv only', async () => {
      const response = await request(app)
        .post('/cli')
        .send({
          argv: ['servers'],
          cwd: '/test/path',
        })
        .expect(200);

      if (!response.body.success) {
        console.log('servers command failed:', response.body.error);
      }

      expect(response.body).toMatchObject({
        success: true,
        exitCode: 0,
      });
    });

    it('should execute command with params for stdin data', async () => {
      const params = {
        field1: 'value1',
        field2: 42,
      };

      const response = await request(app)
        .post('/cli')
        .send({
          argv: ['call', 'testServer', 'test_tool', '--stdin'],
          params,
          cwd: '/test/path',
        })
        .expect(200);

      if (!response.body.success) {
        console.log('Test failed:', JSON.stringify(response.body, null, 2));
      }

      expect(response.body).toMatchObject({
        success: true,
        exitCode: 0,
      });
    });

    it('should handle params with nested objects', async () => {
      const params = {
        fields: [
          { name: 'First Name', type: 'textbox', value: 'John' },
          { name: 'Last Name', type: 'textbox', value: 'Doe' },
        ],
        options: {
          nested: { key: 'value' },
        },
      };

      const response = await request(app)
        .post('/cli')
        .send({
          argv: ['call', 'testServer', 'test_tool'],
          params,
          cwd: '/test/path',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return error for missing argv', async () => {
      const response = await request(app)
        .post('/cli')
        .send({
          cwd: '/test/path',
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('argv'),
      });
    });

    it('should return error for invalid argv type', async () => {
      const response = await request(app)
        .post('/cli')
        .send({
          argv: 'not an array',
          cwd: '/test/path',
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('argv'),
      });
    });

    it('should pass cwd to core executor', async () => {
      const response = await request(app)
        .post('/cli')
        .send({
          argv: ['servers'],
          cwd: '/custom/working/dir',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should parse params passed as JSON string (MCU-69)', async () => {
      // When params is passed as a JSON string instead of object
      const params = JSON.stringify({
        field1: 'value1',
        field2: 42,
      });

      const response = await request(app)
        .post('/cli')
        .send({
          argv: ['call', 'testServer', 'test_tool', '--stdin'],
          params, // String instead of object
          cwd: '/test/path',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        exitCode: 0,
      });
    });

    it('should handle invalid JSON string in params gracefully', async () => {
      const response = await request(app)
        .post('/cli')
        .send({
          argv: ['call', 'testServer', 'test_tool', '--stdin'],
          params: 'not valid json {',
          cwd: '/test/path',
        })
        .expect(200);

      // Should still succeed - invalid JSON is kept as-is
      // (the tool call may fail later, but params parsing should not crash)
      expect(response.body.exitCode).toBeDefined();
    });
  });

  describe('Legacy Endpoints', () => {
    it('GET /health should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        pid: expect.any(Number),
      });
    });

    it('POST /exit should shutdown daemon', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      // Mock the shutdown method to avoid errors
      const shutdownSpy = vi.spyOn(daemonServer as any, 'shutdown').mockResolvedValue(undefined);

      const response = await request(app)
        .post('/exit')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Daemon shutting down...',
      });

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(shutdownSpy).toHaveBeenCalled();

      shutdownSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });
});