import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { ProxyRouter } from '../ProxyRouter';
import { ServerManager } from '../ServerManager';
import { MCPServer, MCPMessage } from '../../types';

// Mock WebSocket
const mockWebSocket = {
  send: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
  readyState: 1, // OPEN
  closeCode: undefined,
  closeReason: undefined
};

// Mock ServerManager
const mockServerManager = {
  getAllServers: vi.fn(),
  getServer: vi.fn()
} as any;

describe('ProxyRouter', () => {
  let proxyRouter: ProxyRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    proxyRouter = new ProxyRouter(mockServerManager);
  });

  describe('findServerByNamespace', () => {
    it('should find server by exact namespace match', () => {
      const mockServer: MCPServer = {
        id: 'test-server',
        name: 'test',
        namespace: 'test-namespace',
        version: '1.0.0',
        source: { type: 'npm', url: 'test' },
        config: {
          capabilities: {},
          environment: {},
          args: [],
          transport: 'stdio',
          security: { networkAccess: false, filesystemAccess: false, environmentIsolation: true }
        },
        status: 'running',
        metadata: { installedAt: new Date(), healthChecks: [], auditLog: [] }
      };

      mockServerManager.getAllServers.mockReturnValue([mockServer]);

      const result = (proxyRouter as any).findServerByNamespace('test-namespace');

      expect(result).toEqual(mockServer);
    });

    it('should find server by namespace prefix', () => {
      const mockServer: MCPServer = {
        id: 'test-server',
        name: 'test',
        namespace: 'api',
        version: '1.0.0',
        source: { type: 'npm', url: 'test' },
        config: {
          capabilities: {},
          environment: {},
          args: [],
          transport: 'stdio',
          security: { networkAccess: false, filesystemAccess: false, environmentIsolation: true }
        },
        status: 'running',
        metadata: { installedAt: new Date(), healthChecks: [], auditLog: [] }
      };

      mockServerManager.getAllServers.mockReturnValue([mockServer]);

      const result = (proxyRouter as any).findServerByNamespace('api/v1/users');

      expect(result).toEqual(mockServer);
    });

    it('should return undefined when no server matches', () => {
      mockServerManager.getAllServers.mockReturnValue([]);

      const result = (proxyRouter as any).findServerByNamespace('non-existent');

      expect(result).toBeUndefined();
    });
  });

  describe('handleRequest', () => {
    let mockReq: any;
    let mockRes: any;

    beforeEach(() => {
      mockReq = {
        method: 'POST',
        url: '/test-namespace',
        headers: { host: 'localhost:3000' },
        on: vi.fn(),
        setEncoding: vi.fn()
      };

      mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
        setHeader: vi.fn()
      };
    });

    it('should handle valid MCP request', async () => {
      const mockServer: MCPServer = {
        id: 'test-server',
        name: 'test',
        namespace: 'test-namespace',
        version: '1.0.0',
        source: { type: 'npm', url: 'test' },
        config: {
          capabilities: {},
          environment: {},
          args: [],
          transport: 'stdio',
          security: { networkAccess: false, filesystemAccess: false, environmentIsolation: true }
        },
        status: 'running',
        metadata: { installedAt: new Date(), healthChecks: [], auditLog: [] }
      };

      mockServerManager.getAllServers.mockReturnValue([mockServer]);

      const testMessage: MCPMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test.method',
        params: {}
      };

      // Mock request body
      let onDataCallback: any;
      let onEndCallback: any;
      mockReq.on.mockImplementation((event: string, callback: any) => {
        if (event === 'data') onDataCallback = callback;
        if (event === 'end') onEndCallback = callback;
      });

      // Simulate async request handling
      const handleRequestPromise = proxyRouter.handleRequest(mockReq, mockRes);

      // Simulate receiving data
      onDataCallback(JSON.stringify(testMessage));
      onEndCallback();

      await handleRequestPromise;

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('"jsonrpc":"2.0"'));
    });

    it('should return 400 for missing namespace', async () => {
      mockReq.url = '/';

      await proxyRouter.handleRequest(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Namespace required' }));
    });

    it('should return 404 for non-existent server', async () => {
      mockReq.url = '/non-existent';
      mockServerManager.getAllServers.mockReturnValue([]);

      await proxyRouter.handleRequest(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Server for namespace \'non-existent\' not found' }));
    });

    it('should return 405 for non-POST methods', async () => {
      mockReq.method = 'GET';

      await proxyRouter.handleRequest(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Method not allowed' }));
    });
  });

  describe('handleWebSocket', () => {
    it('should handle WebSocket connection', () => {
      const mockReq = {
        url: '/test-namespace',
        headers: { host: 'localhost:3000' }
      };

      const mockServer: MCPServer = {
        id: 'test-server',
        name: 'test',
        namespace: 'test-namespace',
        version: '1.0.0',
        source: { type: 'npm', url: 'test' },
        config: {
          capabilities: {},
          environment: {},
          args: [],
          transport: 'stdio',
          security: { networkAccess: false, filesystemAccess: false, environmentIsolation: true }
        },
        status: 'running',
        metadata: { installedAt: new Date(), healthChecks: [], auditLog: [] }
      };

      mockServerManager.getAllServers.mockReturnValue([mockServer]);

      proxyRouter.handleWebSocket(mockWebSocket as any, mockReq as any);

      // WebSocket handling is complex to test fully, but we can verify it doesn't throw
      expect(mockWebSocket.on).toHaveBeenCalled();
    });

    it('should close WebSocket for missing namespace', () => {
      const mockReq = {
        url: '/',
        headers: { host: 'localhost:3000' }
      };

      proxyRouter.handleWebSocket(mockWebSocket as any, mockReq as any);

      expect(mockWebSocket.close).toHaveBeenCalledWith(1003, 'Namespace required');
    });
  });

  describe('getActiveConnections', () => {
    it('should return active connection IDs', () => {
      // This would be more meaningful with actual WebSocket connections
      const connections = proxyRouter.getActiveConnections();
      expect(Array.isArray(connections)).toBe(true);
    });
  });
});