import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getClaudeConfigPaths,
  getClaudeDesktopConfigPath,
  getClaudeCliConfigPath,
  readClaudeConfig,
  readClaudeCliConfig,
  readProjectConfigs,
  discoverServers,
  deduplicateServers,
  getMcpuConfigPath,
  createMigrationPlan,
  saveMcpuConfig,
  updateClaudeConfig,
  updateClaudeCliConfig,
} from '../src/commands/setup.ts';

describe('setup command', () => {
  const testDir = join(tmpdir(), `mcpu-test-${Date.now()}`);
  const claudeDir = join(testDir, 'claude');
  const mcpuDir = join(testDir, 'mcpu');

  beforeEach(() => {
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(mcpuDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  describe('getClaudeConfigPaths', () => {
    it('should use CLAUDE_DESKTOP_CONFIG_DIR when set', () => {
      vi.stubEnv('CLAUDE_DESKTOP_CONFIG_DIR', claudeDir);
      const paths = getClaudeConfigPaths();
      expect(paths).not.toBeNull();
      expect(paths!.configDir).toBe(claudeDir);
      expect(paths!.configFile).toBe(join(claudeDir, 'claude_desktop_config.json'));
      expect(paths!.projectsDir).toBe(join(claudeDir, 'projects'));
    });

    it('should return default paths when env not set', () => {
      vi.stubEnv('CLAUDE_DESKTOP_CONFIG_DIR', '');
      const paths = getClaudeConfigPaths();
      expect(paths).not.toBeNull();
      expect(paths!.configFile).toContain('claude_desktop_config.json');
    });
  });

  describe('readClaudeConfig', () => {
    it('should return null for missing file', () => {
      const result = readClaudeConfig(join(claudeDir, 'nonexistent.json'));
      expect(result).toBeNull();
    });

    it('should parse valid config with mcpServers', () => {
      const configPath = join(claudeDir, 'claude_desktop_config.json');
      writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          'test-server': {
            command: 'test-cmd',
            args: ['--arg1'],
          },
        },
      }));

      const result = readClaudeConfig(configPath);
      expect(result).not.toBeNull();
      expect(result!['test-server']).toEqual({
        command: 'test-cmd',
        args: ['--arg1'],
      });
    });

    it('should return empty object for config without mcpServers', () => {
      const configPath = join(claudeDir, 'claude_desktop_config.json');
      writeFileSync(configPath, JSON.stringify({ someOtherSetting: true }));

      const result = readClaudeConfig(configPath);
      expect(result).toEqual({});
    });

    it('should return null for invalid JSON', () => {
      const configPath = join(claudeDir, 'claude_desktop_config.json');
      writeFileSync(configPath, 'not valid json');

      const result = readClaudeConfig(configPath);
      expect(result).toBeNull();
    });
  });

  describe('readProjectConfigs', () => {
    it('should return empty object for missing projects directory', () => {
      const result = readProjectConfigs(join(claudeDir, 'projects'));
      expect(result).toEqual({});
    });

    it('should read project configs with mcpServers (prefixed with desktop:)', () => {
      const projectsDir = join(claudeDir, 'projects');
      const projectDir = join(projectsDir, 'my-project');
      mkdirSync(projectDir, { recursive: true });

      writeFileSync(join(projectDir, 'settings.json'), JSON.stringify({
        mcpServers: {
          'project-server': {
            command: 'project-cmd',
          },
        },
      }));

      const result = readProjectConfigs(projectsDir);
      expect(result['desktop:my-project']).toEqual({
        'project-server': { command: 'project-cmd' },
      });
    });

    it('should skip projects without mcpServers', () => {
      const projectsDir = join(claudeDir, 'projects');
      const projectDir = join(projectsDir, 'empty-project');
      mkdirSync(projectDir, { recursive: true });

      writeFileSync(join(projectDir, 'settings.json'), JSON.stringify({
        someOtherSetting: true,
      }));

      const result = readProjectConfigs(projectsDir);
      expect(result['desktop:empty-project']).toBeUndefined();
    });
  });

  describe('readClaudeCliConfig', () => {
    it('should return null for missing file', () => {
      const result = readClaudeCliConfig(join(claudeDir, 'nonexistent.json'));
      expect(result).toBeNull();
    });

    it('should read top-level mcpServers', () => {
      const configPath = join(claudeDir, 'claude.json');
      writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          'cli-server': { command: 'cli-cmd' },
        },
      }));

      const result = readClaudeCliConfig(configPath);
      expect(result).not.toBeNull();
      expect(result!.global['cli-server']).toEqual({ command: 'cli-cmd' });
    });

    it('should read project-level mcpServers', () => {
      const configPath = join(claudeDir, 'claude.json');
      writeFileSync(configPath, JSON.stringify({
        projects: {
          '/path/to/my-project': {
            mcpServers: {
              'project-server': { command: 'project-cmd' },
            },
          },
        },
      }));

      const result = readClaudeCliConfig(configPath);
      expect(result).not.toBeNull();
      expect(result!.projects['cli:my-project']).toEqual({
        'project-server': { command: 'project-cmd' },
      });
    });
  });

  describe('deduplicateServers', () => {
    it('should keep global servers over project servers', () => {
      const discovered = {
        global: {
          'shared-server': { command: 'global-cmd' },
        },
        projects: {
          'project1': {
            'shared-server': { command: 'project-cmd' },
          },
        },
      };

      const { servers, duplicates } = deduplicateServers(discovered);

      expect(servers['shared-server']).toEqual({ command: 'global-cmd' });
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].name).toBe('shared-server');
      expect(duplicates[0].kept).toBe('global');
    });

    it('should merge unique servers from different sources', () => {
      const discovered = {
        global: {
          'global-only': { command: 'global-cmd' },
        },
        projects: {
          'project1': {
            'project-only': { command: 'project-cmd' },
          },
        },
      };

      const { servers, duplicates } = deduplicateServers(discovered);

      expect(servers['global-only']).toEqual({ command: 'global-cmd' });
      expect(servers['project-only']).toEqual({ command: 'project-cmd' });
      expect(duplicates).toHaveLength(0);
    });

    it('should prefer first project alphabetically for project-only duplicates', () => {
      const discovered = {
        global: {},
        projects: {
          'z-project': {
            'shared-server': { command: 'z-cmd' },
          },
          'a-project': {
            'shared-server': { command: 'a-cmd' },
          },
        },
      };

      const { servers, duplicates } = deduplicateServers(discovered);

      expect(servers['shared-server']).toEqual({ command: 'a-cmd' });
      expect(duplicates[0].kept).toBe('project:a-project');
    });
  });

  describe('saveMcpuConfig', () => {
    it('should create config file and directory', () => {
      const configPath = join(mcpuDir, 'config.json');
      const servers = {
        'new-server': { command: 'new-cmd' },
      };

      saveMcpuConfig(servers, configPath);

      expect(existsSync(configPath)).toBe(true);
      const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(saved['new-server']).toEqual({ command: 'new-cmd' });
    });

    it('should merge with existing config', () => {
      const configPath = join(mcpuDir, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        'existing-server': { command: 'existing-cmd' },
      }));

      const servers = {
        'new-server': { command: 'new-cmd' },
      };

      saveMcpuConfig(servers, configPath);

      const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(saved['existing-server']).toEqual({ command: 'existing-cmd' });
      expect(saved['new-server']).toEqual({ command: 'new-cmd' });
    });

    it('should create backup of existing config', () => {
      const configPath = join(mcpuDir, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        'existing-server': { command: 'existing-cmd' },
      }));

      saveMcpuConfig({ 'new-server': { command: 'new-cmd' } }, configPath);

      // Check that a backup was created
      const files = require('node:fs').readdirSync(mcpuDir);
      const backupFile = files.find((f: string) => f.startsWith('config.json.backup.'));
      expect(backupFile).toBeDefined();
    });
  });

  describe('updateClaudeConfig', () => {
    it('should replace mcpServers with only MCPU', () => {
      const configPath = join(claudeDir, 'claude_desktop_config.json');
      writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          'old-server': { command: 'old-cmd' },
        },
        otherSetting: true,
      }));

      updateClaudeConfig(configPath);

      const updated = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(updated.mcpServers).toEqual({
        mcpu: { command: 'mcpu', args: ['mcp'] },
      });
      expect(updated.otherSetting).toBe(true);
    });

    it('should create backup before updating', () => {
      const configPath = join(claudeDir, 'claude_desktop_config.json');
      writeFileSync(configPath, JSON.stringify({
        mcpServers: { 'old-server': { command: 'old-cmd' } },
      }));

      updateClaudeConfig(configPath);

      const files = require('node:fs').readdirSync(claudeDir);
      const backupFile = files.find((f: string) => f.startsWith('claude_desktop_config.json.backup.'));
      expect(backupFile).toBeDefined();
    });

    it('should handle missing config file gracefully', () => {
      const configPath = join(claudeDir, 'nonexistent.json');
      expect(() => updateClaudeConfig(configPath)).not.toThrow();
    });
  });

  describe('updateClaudeCliConfig', () => {
    it('should clear mcpServers but preserve other settings', () => {
      const configPath = join(claudeDir, 'claude.json');
      writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          'old-server': { command: 'old-cmd' },
        },
        projects: {
          '/path/to/project': {
            mcpServers: {
              'project-server': { command: 'project-cmd' },
            },
            otherSetting: true,
          },
        },
        userSetting: 'preserved',
      }));

      updateClaudeCliConfig(configPath);

      const updated = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(updated.mcpServers).toEqual({});
      expect(updated.projects['/path/to/project'].mcpServers).toEqual({});
      expect(updated.projects['/path/to/project'].otherSetting).toBe(true);
      expect(updated.userSetting).toBe('preserved');
    });

    it('should create backup before updating', () => {
      const configPath = join(claudeDir, 'claude.json');
      writeFileSync(configPath, JSON.stringify({
        mcpServers: { 'old-server': { command: 'old-cmd' } },
      }));

      updateClaudeCliConfig(configPath);

      const files = require('node:fs').readdirSync(claudeDir);
      const backupFile = files.find((f: string) => f.startsWith('claude.json.backup.'));
      expect(backupFile).toBeDefined();
    });
  });
});
