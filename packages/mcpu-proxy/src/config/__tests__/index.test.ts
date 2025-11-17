import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from '../index';

// Mock fs-extra
vi.mock('fs-extra', () => ({
  pathExists: vi.fn(),
  readJson: vi.fn(),
  writeJson: vi.fn(),
  ensureDir: vi.fn()
}));

vi.mock('path', () => ({
  dirname: vi.fn((p) => p.split('/').slice(0, -1).join('/')),
  join: vi.fn((...args) => args.join('/'))
}));

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  const mockFs = vi.mocked(require('fs-extra'));

  beforeEach(() => {
    vi.clearAllMocks();
    configManager = new ConfigManager('/tmp/test-config.json');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('load', () => {
    it('should load existing config file', async () => {
      const mockConfig = {
        port: 4000,
        host: '127.0.0.1',
        dataDir: '/custom/data'
      };

      mockFs.pathExists.mockResolvedValue(true);
      mockFs.readJson.mockResolvedValue(mockConfig);

      await configManager.load();

      const loadedConfig = configManager.getConfig();
      expect(loadedConfig.port).toBe(4000);
      expect(loadedConfig.host).toBe('127.0.0.1');
      expect(loadedConfig.dataDir).toBe('/custom/data');
    });

    it('should create default config when file does not exist', async () => {
      mockFs.pathExists.mockResolvedValue(false);

      await configManager.load();

      expect(mockFs.writeJson).toHaveBeenCalled();
      const savedConfig = mockFs.writeJson.mock.calls[0][1];
      expect(savedConfig.port).toBe(3000); // default port
    });

    it('should handle config load errors gracefully', async () => {
      mockFs.pathExists.mockResolvedValue(true);
      mockFs.readJson.mockRejectedValue(new Error('Read failed'));

      // Should not throw, should use defaults
      await expect(configManager.load()).resolves.not.toThrow();
    });
  });

  describe('save', () => {
    it('should save config to file', async () => {
      await configManager.save();

      expect(mockFs.ensureDir).toHaveBeenCalled();
      expect(mockFs.writeJson).toHaveBeenCalledWith(
        '/tmp/test-config.json',
        expect.any(Object),
        { spaces: 2 }
      );
    });
  });

  describe('updateConfig', () => {
    it('should update config values', () => {
      configManager.updateConfig({ port: 5000, host: '0.0.0.0' });

      const config = configManager.getConfig();
      expect(config.port).toBe(5000);
      expect(config.host).toBe('0.0.0.0');
    });

    it('should preserve existing values when partially updating', () => {
      const originalConfig = configManager.getConfig();
      const originalPort = originalConfig.port;

      configManager.updateConfig({ host: 'new-host' });

      const updatedConfig = configManager.getConfig();
      expect(updatedConfig.port).toBe(originalPort); // unchanged
      expect(updatedConfig.host).toBe('new-host'); // updated
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      const config1 = configManager.getConfig();
      const config2 = configManager.getConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // different objects
    });
  });

  describe('getDataDir', () => {
    it('should return the data directory', () => {
      const dataDir = configManager.getDataDir();
      expect(typeof dataDir).toBe('string');
      expect(dataDir.length).toBeGreaterThan(0);
    });
  });

  describe('getSecurityConfig', () => {
    it('should return security configuration', () => {
      const securityConfig = configManager.getSecurityConfig();

      expect(securityConfig).toHaveProperty('defaultDeny');
      expect(securityConfig).toHaveProperty('auditLogging');
      expect(securityConfig).toHaveProperty('sandboxing');
      expect(securityConfig).toHaveProperty('allowedRegistries');
    });
  });
});