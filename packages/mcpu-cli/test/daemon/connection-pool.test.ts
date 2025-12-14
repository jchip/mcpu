import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionPool, getConnectionKey, parseConnectionKey } from '../../src/daemon/connection-pool.js';
import { MCPClient } from '../../src/client.js';
import type { MCPConnection, MCPServerConfig } from '../../src/types.js';

// Mock the MCPClient
vi.mock('../../src/client.js', () => ({
  MCPClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    getStderr: vi.fn().mockReturnValue(''),
    clearStderr: vi.fn(),
  })),
}));

describe('ConnectionPool', () => {
  let pool: ConnectionPool;
  let mockClient: any;
  let mockConnection: MCPConnection;

  beforeEach(() => {
    pool = new ConnectionPool();
    mockClient = (pool as any).client;

    // Create a mock connection
    mockConnection = {
      client: {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        callTool: vi.fn().mockResolvedValue({ content: [] }),
      },
      transport: {
        close: vi.fn(),
      },
    } as any;

    mockClient.connect = vi.fn().mockResolvedValue(mockConnection);
    mockClient.disconnect = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    pool.stopCleanup();
    vi.clearAllMocks();
  });

  describe('Connection ID Generation', () => {
    it('should generate sequential integer IDs starting from 1', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      const info1 = await pool.getConnection('server1', config);
      expect(info1.id).toBe(1);

      const info2 = await pool.getConnection('server2', config);
      expect(info2.id).toBe(2);

      const info3 = await pool.getConnection('server3', config);
      expect(info3.id).toBe(3);
    });

    it('should not reuse IDs even after disconnection', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      const info1 = await pool.getConnection('server1', config);
      expect(info1.id).toBe(1);

      await pool.disconnect('server1');

      const info2 = await pool.getConnection('server1', config);
      expect(info2.id).toBe(2); // New ID, not reusing 1
    });
  });

  describe('getConnection', () => {
    it('should return ConnectionInfo with correct structure', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      const info = await pool.getConnection('testServer', config);

      expect(info).toMatchObject({
        id: expect.any(Number),
        server: 'testServer',
        connection: mockConnection,
        status: 'connected',
        connectedAt: expect.any(Number),
        lastUsed: expect.any(Number),
        closedAt: null,
      });
    });

    it('should return existing connection if already connected', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      const info1 = await pool.getConnection('testServer', config);
      const info2 = await pool.getConnection('testServer', config);

      expect(info1.id).toBe(info2.id);
      expect(mockClient.connect).toHaveBeenCalledTimes(1);
    });

    it('should update lastUsed timestamp when returning existing connection', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      const info1 = await pool.getConnection('testServer', config);
      const firstLastUsed = info1.lastUsed;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const info2 = await pool.getConnection('testServer', config);

      expect(info2.lastUsed).toBeGreaterThan(firstLastUsed);
    });
  });

  describe('disconnect', () => {
    it('should disconnect and update ConnectionInfo status', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      await pool.getConnection('testServer', config);
      const disconnectInfo = await pool.disconnect('testServer');

      expect(disconnectInfo).toMatchObject({
        id: 1,
        server: 'testServer',
        status: 'disconnected',
        closedAt: expect.any(Number),
      });

      expect(mockClient.disconnect).toHaveBeenCalledWith(mockConnection);
    });

    it('should return null for non-existent server', async () => {
      const result = await pool.disconnect('nonExistent');
      expect(result).toBeNull();
    });

    it('should clean up internal mappings after disconnection', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      const info = await pool.getConnection('testServer', config);
      await pool.disconnect('testServer');

      // Should not return the old connection
      const connections = pool.listConnections();
      expect(connections).toHaveLength(0);

      // ConnectionInfo is cleaned up to prevent memory leak
      const storedInfo = pool.getConnectionById(info.id);
      expect(storedInfo).toBeNull();
    });
  });

  describe('disconnectById', () => {
    it('should disconnect connection by ID', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      const info = await pool.getConnection('testServer', config);
      const disconnectInfo = await pool.disconnectById(info.id);

      expect(disconnectInfo).toMatchObject({
        id: info.id,
        server: 'testServer',
        status: 'disconnected',
      });
    });

    it('should return null for invalid ID', async () => {
      const result = await pool.disconnectById(999);
      expect(result).toBeNull();
    });
  });

  describe('listConnections', () => {
    it('should list all active connections', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      await pool.getConnection('server1', config);
      await pool.getConnection('server2', config);

      const connections = pool.listConnections();

      expect(connections).toHaveLength(2);
      expect(connections[0].server).toBe('server1');
      expect(connections[1].server).toBe('server2');
    });

    it('should not include disconnected connections', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      await pool.getConnection('server1', config);
      await pool.getConnection('server2', config);
      await pool.disconnect('server1');

      const connections = pool.listConnections();

      expect(connections).toHaveLength(1);
      expect(connections[0].server).toBe('server2');
    });
  });

  describe('listServerConnections', () => {
    it('should return connections for specific server', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      await pool.getConnection('server1', config);

      const connections = pool.listServerConnections('server1');

      expect(connections).toHaveLength(1);
      expect(connections[0].server).toBe('server1');
    });

    it('should return empty array for non-existent server', () => {
      const connections = pool.listServerConnections('nonExistent');
      expect(connections).toEqual([]);
    });
  });

  describe('getConnectionById', () => {
    it('should retrieve connection info by ID', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      const info = await pool.getConnection('testServer', config);
      const retrieved = pool.getConnectionById(info.id);

      expect(retrieved).toEqual(info);
    });

    it('should return null for invalid ID', () => {
      const result = pool.getConnectionById(999);
      expect(result).toBeNull();
    });

    it('should return null for disconnected connections (cleaned up to prevent memory leak)', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      const info = await pool.getConnection('testServer', config);
      await pool.disconnect('testServer');

      const retrieved = pool.getConnectionById(info.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('getConnectionByServer', () => {
    it('should retrieve connection info by server name', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      const info = await pool.getConnection('testServer', config);
      const retrieved = pool.getConnectionByServer('testServer');

      expect(retrieved).toEqual(info);
    });

    it('should return null for non-existent server', () => {
      const result = pool.getConnectionByServer('nonExistent');
      expect(result).toBeNull();
    });
  });

  describe('getRawConnection', () => {
    it('should return MCPConnection for connected server', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      await pool.getConnection('testServer', config);
      const rawConn = pool.getRawConnection('testServer');

      expect(rawConn).toBe(mockConnection);
    });

    it('should return null for disconnected server', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      await pool.getConnection('testServer', config);
      await pool.disconnect('testServer');

      const rawConn = pool.getRawConnection('testServer');
      expect(rawConn).toBeNull();
    });

    it('should update lastUsed timestamp when getting raw connection', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      const info = await pool.getConnection('testServer', config);
      const firstLastUsed = info.lastUsed;

      await new Promise(resolve => setTimeout(resolve, 10));

      pool.getRawConnection('testServer');
      const updated = pool.getConnectionByServer('testServer');

      expect(updated?.lastUsed).toBeGreaterThan(firstLastUsed);
    });
  });

  describe('reconnect', () => {
    it('should disconnect and create new connection', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      const info1 = await pool.getConnection('testServer', config);
      await pool.reconnect('testServer');
      const info2 = pool.getConnectionByServer('testServer');

      expect(info2?.id).not.toBe(info1.id);
      expect(info2?.id).toBe(2); // New ID
      expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
      expect(mockClient.connect).toHaveBeenCalledTimes(2);
    });

    it('should throw error if no config exists', async () => {
      await expect(pool.reconnect('nonExistent')).rejects.toThrow(
        'No configuration found for connection: nonExistent'
      );
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect all connections', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      await pool.getConnection('server1', config);
      await pool.getConnection('server2', config);
      await pool.getConnection('server3', config);

      await pool.disconnectAll();

      const connections = pool.listConnections();
      expect(connections).toHaveLength(0);
      expect(mockClient.disconnect).toHaveBeenCalledTimes(3);
    });
  });

  describe('shutdown', () => {
    it('should stop cleanup and disconnect all', async () => {
      const config: MCPServerConfig = {
        command: 'test',
        args: []
      };

      await pool.getConnection('server1', config);
      await pool.getConnection('server2', config);

      const stopCleanupSpy = vi.spyOn(pool, 'stopCleanup');
      const disconnectAllSpy = vi.spyOn(pool, 'disconnectAll');

      await pool.shutdown();

      expect(stopCleanupSpy).toHaveBeenCalled();
      expect(disconnectAllSpy).toHaveBeenCalled();
    });
  });

  describe('Multi-instance connections', () => {
    describe('getConnectionKey helper', () => {
      it('should return server name when no connId', () => {
        expect(getConnectionKey('myserver')).toBe('myserver');
        expect(getConnectionKey('myserver', undefined)).toBe('myserver');
      });

      it('should return server[id] format with connId', () => {
        expect(getConnectionKey('myserver', '1')).toBe('myserver[1]');
        expect(getConnectionKey('myserver', 'dev')).toBe('myserver[dev]');
        expect(getConnectionKey('myserver', 'prod')).toBe('myserver[prod]');
      });
    });

    describe('parseConnectionKey helper', () => {
      it('should parse plain server name', () => {
        expect(parseConnectionKey('myserver')).toEqual({ server: 'myserver' });
      });

      it('should parse server[id] format', () => {
        expect(parseConnectionKey('myserver[1]')).toEqual({ server: 'myserver', connId: '1' });
        expect(parseConnectionKey('myserver[dev]')).toEqual({ server: 'myserver', connId: 'dev' });
        expect(parseConnectionKey('my-server[test-123]')).toEqual({ server: 'my-server', connId: 'test-123' });
      });
    });

    describe('getConnection with connId', () => {
      it('should create separate connections for different connIds', async () => {
        const config: MCPServerConfig = {
          command: 'test',
          args: []
        };

        const info1 = await pool.getConnection('server1', config);
        const info2 = await pool.getConnection('server1', config, 'dev');
        const info3 = await pool.getConnection('server1', config, 'prod');

        expect(info1.id).toBe(1);
        expect(info2.id).toBe(2);
        expect(info3.id).toBe(3);

        expect(info1.connId).toBeUndefined();
        expect(info2.connId).toBe('dev');
        expect(info3.connId).toBe('prod');

        expect(mockClient.connect).toHaveBeenCalledTimes(3);
      });

      it('should return existing connection for same server+connId', async () => {
        const config: MCPServerConfig = {
          command: 'test',
          args: []
        };

        const info1 = await pool.getConnection('server1', config, 'dev');
        const info2 = await pool.getConnection('server1', config, 'dev');

        expect(info1.id).toBe(info2.id);
        expect(mockClient.connect).toHaveBeenCalledTimes(1);
      });
    });

    describe('getConnectionWithNewId', () => {
      it('should auto-assign sequential numeric IDs', async () => {
        const config: MCPServerConfig = {
          command: 'test',
          args: []
        };

        const info1 = await pool.getConnectionWithNewId('server1', config);
        const info2 = await pool.getConnectionWithNewId('server1', config);
        const info3 = await pool.getConnectionWithNewId('server1', config);

        expect(info1.connId).toBe('1');
        expect(info2.connId).toBe('2');
        expect(info3.connId).toBe('3');

        expect(mockClient.connect).toHaveBeenCalledTimes(3);
      });

      it('should track auto IDs separately per server', async () => {
        const config: MCPServerConfig = {
          command: 'test',
          args: []
        };

        const info1a = await pool.getConnectionWithNewId('server1', config);
        const info2a = await pool.getConnectionWithNewId('server2', config);
        const info1b = await pool.getConnectionWithNewId('server1', config);

        expect(info1a.connId).toBe('1');
        expect(info2a.connId).toBe('1');
        expect(info1b.connId).toBe('2');
      });
    });

    describe('disconnect with connId', () => {
      it('should disconnect specific connection instance', async () => {
        const config: MCPServerConfig = {
          command: 'test',
          args: []
        };

        await pool.getConnection('server1', config);
        await pool.getConnection('server1', config, 'dev');

        await pool.disconnect('server1', 'dev');

        const connections = pool.listConnections();
        expect(connections).toHaveLength(1);
        expect(connections[0].server).toBe('server1');
        expect(connections[0].connId).toBeUndefined();
      });

      it('should disconnect default connection without affecting named instances', async () => {
        const config: MCPServerConfig = {
          command: 'test',
          args: []
        };

        await pool.getConnection('server1', config);
        await pool.getConnection('server1', config, 'dev');

        await pool.disconnect('server1');

        const connections = pool.listConnections();
        expect(connections).toHaveLength(1);
        expect(connections[0].connId).toBe('dev');
      });
    });

    describe('listConnections with connId', () => {
      it('should list all connection instances', async () => {
        const config: MCPServerConfig = {
          command: 'test',
          args: []
        };

        await pool.getConnection('server1', config);
        await pool.getConnection('server1', config, 'dev');
        await pool.getConnection('server2', config);

        const connections = pool.listConnections();
        expect(connections).toHaveLength(3);
      });
    });

    describe('listServerConnections with connId', () => {
      it('should list all instances for a specific server', async () => {
        const config: MCPServerConfig = {
          command: 'test',
          args: []
        };

        await pool.getConnection('server1', config);
        await pool.getConnection('server1', config, 'dev');
        await pool.getConnection('server1', config, 'prod');
        await pool.getConnection('server2', config);

        const connections = pool.listServerConnections('server1');
        expect(connections).toHaveLength(3);
        expect(connections.map(c => c.connId)).toContain(undefined);
        expect(connections.map(c => c.connId)).toContain('dev');
        expect(connections.map(c => c.connId)).toContain('prod');
      });
    });

    describe('getConnectionByServer with connId', () => {
      it('should retrieve specific connection instance', async () => {
        const config: MCPServerConfig = {
          command: 'test',
          args: []
        };

        await pool.getConnection('server1', config);
        const devInfo = await pool.getConnection('server1', config, 'dev');

        const retrieved = pool.getConnectionByServer('server1', 'dev');
        expect(retrieved).toEqual(devInfo);
      });

      it('should return null for non-existent connId', async () => {
        const config: MCPServerConfig = {
          command: 'test',
          args: []
        };

        await pool.getConnection('server1', config);

        const result = pool.getConnectionByServer('server1', 'nonexistent');
        expect(result).toBeNull();
      });
    });

    describe('getRawConnection with connId', () => {
      it('should return MCPConnection for specific instance', async () => {
        const config: MCPServerConfig = {
          command: 'test',
          args: []
        };

        await pool.getConnection('server1', config);
        await pool.getConnection('server1', config, 'dev');

        const rawConn = pool.getRawConnection('server1', 'dev');
        expect(rawConn).toBe(mockConnection);
      });
    });

    describe('reconnect with connId', () => {
      it('should reconnect specific connection instance', async () => {
        const config: MCPServerConfig = {
          command: 'test',
          args: []
        };

        const info1 = await pool.getConnection('server1', config, 'dev');
        const newInfo = await pool.reconnect('server1', 'dev');

        expect(newInfo.id).not.toBe(info1.id);
        expect(newInfo.connId).toBe('dev');
        expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
      });
    });
  });
});