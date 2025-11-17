import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecurityManager } from '../security';
import { MCPServer } from '../../types';

// Mock dependencies
vi.mock('../logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

vi.mock('../../config', () => ({
  configManager: {
    getSecurityConfig: vi.fn(() => ({
      defaultDeny: true,
      auditLogging: true,
      sandboxing: true,
      allowedRegistries: []
    })),
    getDataDir: vi.fn(() => '/tmp/mcp-test')
  }
}));

vi.mock('fs-extra', () => ({
  appendFile: vi.fn()
}));

describe('SecurityManager', () => {
  let securityManager: SecurityManager;

  beforeEach(() => {
    securityManager = new SecurityManager();
  });

  describe('validateServerConfig', () => {
    it('should validate server with proper configuration', async () => {
      const server: MCPServer = {
        id: 'test-server',
        name: 'test',
        namespace: 'test',
        version: '1.0.0',
        source: { type: 'npm', url: 'test' },
        config: {
          capabilities: {},
          environment: {},
          args: [],
          transport: 'stdio',
          security: {
            networkAccess: false,
            filesystemAccess: false,
            environmentIsolation: true
          }
        },
        status: 'installed',
        metadata: { installedAt: new Date(), healthChecks: [], auditLog: [] }
      };

      const result = await securityManager.validateServerConfig(server);
      expect(result).toBe(true);
    });

    it('should reject server with network access when default deny is enabled', async () => {
      const server: MCPServer = {
        id: 'test-server',
        name: 'test',
        namespace: 'test',
        version: '1.0.0',
        source: { type: 'npm', url: 'test' },
        config: {
          capabilities: {},
          environment: {},
          args: [],
          transport: 'stdio',
          security: {
            networkAccess: true, // This should be rejected
            filesystemAccess: false,
            environmentIsolation: true
          }
        },
        status: 'installed',
        metadata: { installedAt: new Date(), healthChecks: [], auditLog: [] }
      };

      const result = await securityManager.validateServerConfig(server);
      expect(result).toBe(false);
    });
  });

  describe('createSandboxEnvironment', () => {
    it('should create sandboxed environment', async () => {
      const server: MCPServer = {
        id: 'test-server',
        name: 'test',
        namespace: 'test',
        version: '1.0.0',
        source: { type: 'npm', url: 'test' },
        config: {
          capabilities: {},
          environment: { CUSTOM_VAR: 'value' },
          args: [],
          transport: 'stdio',
          security: {
            networkAccess: false,
            filesystemAccess: false,
            environmentIsolation: true
          }
        },
        status: 'installed',
        metadata: { installedAt: new Date(), healthChecks: [], auditLog: [] }
      };

      const env = await securityManager.createSandboxEnvironment(server);

      expect(env.CUSTOM_VAR).toBe('value');
      // Sensitive variables should be removed
      expect(env).not.toHaveProperty('AWS_ACCESS_KEY_ID');
    });
  });

  describe('auditLog', () => {
    it('should write audit log when enabled', async () => {
      const appendFileMock = vi.mocked(require('fs-extra').appendFile);

      await securityManager.auditLog('test.action', { key: 'value' });

      expect(appendFileMock).toHaveBeenCalledWith(
        '/tmp/mcp-test/audit.log',
        expect.stringContaining('"action":"test.action"')
      );
    });
  });

  describe('performSecurityScan', () => {
    it('should pass security scan for valid server', async () => {
      const server: MCPServer = {
        id: 'test-server',
        name: 'test',
        namespace: 'test',
        version: '1.0.0',
        source: { type: 'npm', url: 'test-package' },
        config: {
          capabilities: {},
          environment: {},
          args: [],
          transport: 'stdio',
          security: {
            networkAccess: false,
            filesystemAccess: false,
            environmentIsolation: true
          }
        },
        status: 'installed',
        metadata: { installedAt: new Date(), healthChecks: [], auditLog: [] }
      };

      const result = await securityManager.performSecurityScan(server);

      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect HTTP URL security issue', async () => {
      const server: MCPServer = {
        id: 'test-server',
        name: 'test',
        namespace: 'test',
        version: '1.0.0',
        source: { type: 'npm', url: 'http://insecure.com/package' },
        config: {
          capabilities: {},
          environment: {},
          args: [],
          transport: 'stdio',
          security: {
            networkAccess: false,
            filesystemAccess: false,
            environmentIsolation: true
          }
        },
        status: 'installed',
        metadata: { installedAt: new Date(), healthChecks: [], auditLog: [] }
      };

      const result = await securityManager.performSecurityScan(server);

      expect(result.passed).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].severity).toBe('high');
      expect(result.issues[0].message).toContain('HTTP URL detected');
    });

    it('should detect privilege escalation risk', async () => {
      const server: MCPServer = {
        id: 'test-server',
        name: 'test',
        namespace: 'test',
        version: '1.0.0',
        source: { type: 'npm', url: 'test-package' },
        config: {
          capabilities: {},
          environment: {},
          args: [],
          transport: 'stdio',
          security: {
            networkAccess: true,
            filesystemAccess: true, // Both enabled
            environmentIsolation: true
          }
        },
        status: 'installed',
        metadata: { installedAt: new Date(), healthChecks: [], auditLog: [] }
      };

      const result = await securityManager.performSecurityScan(server);

      expect(result.passed).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].severity).toBe('medium');
      expect(result.issues[0].message).toContain('both network and filesystem access');
    });
  });
});