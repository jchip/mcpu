import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServerManager } from '../ServerManager';
import { MCPServer, ServerSource } from '../../types';

// Mock dependencies
vi.mock('fs-extra');
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    on: vi.fn(),
    kill: vi.fn()
  }))
}));
vi.mock('../../utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }))
}));
vi.mock('../../config', () => ({
  configManager: {
    getDataDir: vi.fn(() => '/tmp/mcp-test'),
    getConfig: vi.fn(() => ({ dataDir: '/tmp/mcp-test' }))
  }
}));

describe('ServerManager', () => {
  let serverManager: ServerManager;

  beforeEach(() => {
    serverManager = new ServerManager();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('installServer', () => {
    it('should install a server successfully', async () => {
      const source: ServerSource = {
        type: 'npm',
        url: 'mcp-server-example'
      };

      // Mock the performInstallation method to avoid actual installation
      vi.spyOn(serverManager as any, 'performInstallation').mockResolvedValue(undefined);

      const server = await serverManager.installServer('test-server', source);

      expect(server).toBeDefined();
      expect(server.name).toBe('test-server');
      expect(server.source).toEqual(source);
      expect(server.status).toBe('installed');
    }, 10000);

    it('should handle installation failures', async () => {
      const source: ServerSource = {
        type: 'npm' as any, // Force invalid type for testing
        url: 'bad-url'
      };

      // Mock the performInstallation to throw
      vi.spyOn(serverManager as any, 'performInstallation').mockRejectedValue(new Error('Installation failed'));

      await expect(serverManager.installServer('bad-server', source))
        .rejects.toThrow('Installation failed');
    });
  });

  describe('startServer', () => {
    it('should start a server successfully', async () => {
      // First install a server
      const source: ServerSource = {
        type: 'npm',
        url: 'mcp-server-example'
      };
      const server = await serverManager.installServer('test-server', source);

      // Mock spawn to return a process-like object
      const mockProcess = {
        on: vi.fn(),
        kill: vi.fn()
      };
      vi.mocked(require('child_process').spawn).mockReturnValue(mockProcess as any);

      await serverManager.startServer(server.id);

      expect(mockProcess.on).toHaveBeenCalledWith('exit', expect.any(Function));
      expect(mockProcess.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should throw error for non-existent server', async () => {
      await expect(serverManager.startServer('non-existent'))
        .rejects.toThrow('Server non-existent not found');
    });
  });

  describe('stopServer', () => {
    it('should stop a running server', async () => {
      // Install and start a server first
      const source: ServerSource = {
        type: 'npm',
        url: 'mcp-server-example'
      };
      const server = await serverManager.installServer('test-server', source);

      const mockProcess = {
        on: vi.fn(),
        kill: vi.fn()
      };
      vi.mocked(require('child_process').spawn).mockReturnValue(mockProcess as any);

      await serverManager.startServer(server.id);
      await serverManager.stopServer(server.id);

      expect(mockProcess.kill).toHaveBeenCalled();
    });
  });

  describe('getServer', () => {
    it('should return server by id', async () => {
      const source: ServerSource = {
        type: 'npm',
        url: 'mcp-server-example'
      };
      const installedServer = await serverManager.installServer('test-server', source);

      const retrievedServer = serverManager.getServer(installedServer.id);

      expect(retrievedServer).toEqual(installedServer);
    });

    it('should return undefined for non-existent server', () => {
      const server = serverManager.getServer('non-existent');
      expect(server).toBeUndefined();
    });
  });

  describe('getAllServers', () => {
    it('should return all installed servers', async () => {
      const source1: ServerSource = {
        type: 'npm',
        url: 'server1'
      };
      const source2: ServerSource = {
        type: 'pip',
        url: 'server2'
      };

      await serverManager.installServer('server1', source1);
      await serverManager.installServer('server2', source2);

      const allServers = serverManager.getAllServers();

      expect(allServers).toHaveLength(2);
      expect(allServers.map(s => s.name)).toEqual(['server1', 'server2']);
    });
  });

  describe('getRunningServers', () => {
    it('should return only running servers', async () => {
      const source: ServerSource = {
        type: 'npm',
        url: 'mcp-server-example'
      };

      const server1 = await serverManager.installServer('server1', source);
      const server2 = await serverManager.installServer('server2', source);

      // Mock spawn
      const mockProcess = {
        on: vi.fn(),
        kill: vi.fn()
      };
      vi.mocked(require('child_process').spawn).mockReturnValue(mockProcess as any);

      await serverManager.startServer(server1.id);

      const runningServers = serverManager.getRunningServers();

      expect(runningServers).toHaveLength(1);
      expect(runningServers[0].id).toBe(server1.id);
    });
  });
});