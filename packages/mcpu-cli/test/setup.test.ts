import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  getClaudeConfigPaths,
  getClaudeDesktopConfigPath,
  getClaudeCliConfigPath,
  getGeminiCliConfigPath,
  getGeminiConfigDir,
  getCursorConfigPath,
  getCursorConfigDir,
  readClaudeConfig,
  readClaudeCliConfig,
  readGeminiCliConfig,
  readProjectConfigs,
  discoverServers,
  deduplicateServers,
  getMcpuConfigPath,
  createMigrationPlan,
  saveMcpuConfig,
  updateClaudeConfig,
  updateClaudeCliConfig,
  updateGeminiCliConfig,
  updateCursorConfig,
  executeSetup,
  isMcpuMcpAvailable,
  isRunningViaNpx,
  getMcpuServerConfig,
} from '../src/commands/setup.ts';

// ============================================================================
// Fixture Paths
// ============================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = join(__dirname, 'fixtures');
const DESKTOP_FIXTURE_DIR = join(FIXTURES_DIR, 'claude-desktop');
const CLI_FIXTURE_DIR = join(FIXTURES_DIR, 'claude-cli');
const GEMINI_FIXTURE_DIR = join(FIXTURES_DIR, 'gemini-cli');

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
      const backupFile = files.find((f: string) => f=== 'config.json.mcpu.bak');
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
      const backupFile = files.find((f: string) => f=== 'claude_desktop_config.json.mcpu.bak');
      expect(backupFile).toBeDefined();
    });

    it('should handle missing config file gracefully', () => {
      const configPath = join(claudeDir, 'nonexistent.json');
      expect(() => updateClaudeConfig(configPath)).not.toThrow();
    });
  });

  describe('updateClaudeCliConfig', () => {
    it('should replace mcpServers with mcpu and preserve other settings', () => {
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
      expect(updated.mcpServers).toEqual({ mcpu: { command: 'mcpu-mcp', args: [] } });
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
      const backupFile = files.find((f: string) => f === 'claude.json.mcpu.bak');
      expect(backupFile).toBeDefined();
    });
  });

  // ==========================================================================
  // Integration Tests with Fixtures
  // ==========================================================================

  describe('integration: Claude Desktop migration', () => {
    const desktopDir = join(testDir, 'desktop');
    const mcpuOutputDir = join(testDir, 'mcpu-output');

    beforeEach(() => {
      mkdirSync(mcpuOutputDir, { recursive: true });

      // Copy Desktop fixture to test directory
      cpSync(DESKTOP_FIXTURE_DIR, desktopDir, { recursive: true });

      // Set env vars to use test directories - no CLI or Gemini config
      vi.stubEnv('CLAUDE_DESKTOP_CONFIG_DIR', desktopDir);
      vi.stubEnv('CLAUDE_CONFIG_DIR', join(testDir, 'nonexistent-cli'));
      vi.stubEnv('GEMINI_CONFIG_DIR', join(testDir, 'nonexistent-gemini'));
      vi.stubEnv('CURSOR_CONFIG_DIR', join(testDir, 'nonexistent-cursor'));
      vi.stubEnv('XDG_CONFIG_HOME', mcpuOutputDir);
    });

    it('should discover all servers from Desktop config and projects', () => {
      const result = discoverServers();
      expect(result).not.toBeNull();

      const { discovered } = result!;

      // Global servers
      expect(discovered.global).toHaveProperty('playwright');
      expect(discovered.global).toHaveProperty('filesystem');
      expect(discovered.global).toHaveProperty('memory');

      // Project servers (prefixed with desktop:)
      expect(discovered.projects).toHaveProperty('desktop:project-alpha');
      expect(discovered.projects).toHaveProperty('desktop:project-beta');
      expect(discovered.projects['desktop:project-alpha']).toHaveProperty('project-db');
      expect(discovered.projects['desktop:project-beta']).toHaveProperty('project-api');
      expect(discovered.projects['desktop:project-beta']).toHaveProperty('playwright'); // duplicate
    });

    it('should deduplicate servers correctly (global wins)', () => {
      const result = discoverServers();
      const { servers, duplicates } = deduplicateServers(result!.discovered);

      // Should have 5 unique servers: playwright, filesystem, memory, project-db, project-api
      expect(Object.keys(servers)).toHaveLength(5);

      // playwright from project-beta should be marked as duplicate
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].name).toBe('playwright');
      expect(duplicates[0].kept).toBe('global');
      expect(duplicates[0].sources).toContain('project:desktop:project-beta');
    });

    it('should execute full migration and update configs', async () => {
      const result = await executeSetup({ dryRun: false });

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(Object.keys(result.plan!.servers)).toHaveLength(5);

      // Check MCPU config was created
      const mcpuConfigPath = join(mcpuOutputDir, 'mcpu', 'config.json');
      expect(existsSync(mcpuConfigPath)).toBe(true);

      const mcpuConfig = JSON.parse(readFileSync(mcpuConfigPath, 'utf-8'));
      expect(mcpuConfig).toHaveProperty('playwright');
      expect(mcpuConfig).toHaveProperty('filesystem');
      expect(mcpuConfig).toHaveProperty('memory');
      expect(mcpuConfig).toHaveProperty('project-db');
      expect(mcpuConfig).toHaveProperty('project-api');

      // Check env vars are preserved
      expect(mcpuConfig['project-db'].env).toEqual({ DATABASE_URL: 'postgres://localhost/alpha' });

      // Check Desktop config was updated to use only MCPU
      const desktopConfig = JSON.parse(readFileSync(join(desktopDir, 'claude_desktop_config.json'), 'utf-8'));
      expect(desktopConfig.mcpServers).toEqual({
        mcpu: { command: 'mcpu', args: ['mcp'] },
      });
      // Other settings preserved
      expect(desktopConfig.theme).toBe('dark');
      expect(desktopConfig.globalShortcut).toBe('Ctrl+Space');

      // Check backup was created
      const files = require('node:fs').readdirSync(desktopDir);
      expect(files.some((f: string) => f=== 'claude_desktop_config.json.mcpu.bak')).toBe(true);
    });

    it('should support dry-run mode', async () => {
      const result = await executeSetup({ dryRun: true });

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();

      // MCPU config should NOT be created
      const mcpuConfigPath = join(mcpuOutputDir, 'mcpu', 'config.json');
      expect(existsSync(mcpuConfigPath)).toBe(false);

      // Desktop config should NOT be modified
      const desktopConfig = JSON.parse(readFileSync(join(desktopDir, 'claude_desktop_config.json'), 'utf-8'));
      expect(desktopConfig.mcpServers).toHaveProperty('playwright');
      expect(desktopConfig.mcpServers).not.toHaveProperty('mcpu');
    });
  });

  describe('integration: Claude CLI migration', () => {
    const cliDir = join(testDir, 'cli');
    const mcpuOutputDir = join(testDir, 'mcpu-output');

    beforeEach(() => {
      mkdirSync(mcpuOutputDir, { recursive: true });

      // Copy CLI fixture to test directory
      cpSync(CLI_FIXTURE_DIR, cliDir, { recursive: true });

      // Set env vars - only CLI, no Desktop or Gemini
      vi.stubEnv('CLAUDE_CONFIG_DIR', cliDir);
      vi.stubEnv('CLAUDE_DESKTOP_CONFIG_DIR', join(testDir, 'nonexistent-desktop'));
      vi.stubEnv('GEMINI_CONFIG_DIR', join(testDir, 'nonexistent-gemini'));
      vi.stubEnv('CURSOR_CONFIG_DIR', join(testDir, 'nonexistent-cursor'));
      vi.stubEnv('XDG_CONFIG_HOME', mcpuOutputDir);
    });

    it('should discover all servers from CLI config', () => {
      const result = discoverServers();
      expect(result).not.toBeNull();

      const { discovered, sources } = result!;

      // Check sources
      expect(sources.cli).toBe(join(cliDir, 'settings.json'));
      expect(sources.desktop).toBeUndefined();

      // Global servers from CLI
      expect(discovered.global).toHaveProperty('chroma');
      expect(discovered.global).toHaveProperty('github');

      // Project servers (prefixed with cli:)
      expect(discovered.projects).toHaveProperty('cli:webapp');
      expect(discovered.projects).toHaveProperty('cli:api-service');
      expect(discovered.projects['cli:webapp']).toHaveProperty('webapp-tools');
      expect(discovered.projects['cli:api-service']).toHaveProperty('api-tools');
      expect(discovered.projects['cli:api-service']).toHaveProperty('github'); // duplicate
    });

    it('should deduplicate CLI servers correctly (user-level wins)', () => {
      const result = discoverServers();
      const { servers, duplicates } = deduplicateServers(result!.discovered);

      // Should have 4 unique servers: chroma, github, webapp-tools, api-tools
      expect(Object.keys(servers)).toHaveLength(4);

      // github from api-service should be marked as duplicate
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].name).toBe('github');
      expect(duplicates[0].kept).toBe('global');
    });

    it('should execute full migration and update CLI config', async () => {
      const result = await executeSetup({ dryRun: false });

      expect(result.success).toBe(true);
      expect(Object.keys(result.plan!.servers)).toHaveLength(4);

      // Check MCPU config
      const mcpuConfigPath = join(mcpuOutputDir, 'mcpu', 'config.json');
      const mcpuConfig = JSON.parse(readFileSync(mcpuConfigPath, 'utf-8'));
      expect(mcpuConfig).toHaveProperty('chroma');
      expect(mcpuConfig).toHaveProperty('github');
      expect(mcpuConfig).toHaveProperty('webapp-tools');
      expect(mcpuConfig).toHaveProperty('api-tools');

      // Check env vars preserved
      expect(mcpuConfig.chroma.env).toEqual({ CHROMA_DATA_DIR: '~/.local/share/chromadb' });
      expect(mcpuConfig.github.env).toEqual({ GITHUB_TOKEN: 'ghp_xxxx' });

      // Check CLI config was updated - mcpServers replaced with mcpu
      const cliConfig = JSON.parse(readFileSync(join(cliDir, 'settings.json'), 'utf-8'));
      expect(cliConfig.mcpServers).toEqual({ mcpu: { command: 'mcpu-mcp', args: [] } });
      expect(cliConfig.projects['/Users/dev/webapp'].mcpServers).toEqual({});
      expect(cliConfig.projects['/Users/dev/api-service'].mcpServers).toEqual({});

      // Other settings preserved
      expect(cliConfig.installMethod).toBe('global');
      expect(cliConfig.autoUpdates).toBe(true);
      expect(cliConfig.userID).toBe('test-user-id');
      expect(cliConfig.projects['/Users/dev/webapp'].hasTrustDialogAccepted).toBe(true);
      expect(cliConfig.projects['/Users/dev/api-service'].exampleFiles).toEqual(['main.py', 'server.py']);
    });
  });

  describe('integration: Combined Desktop + CLI migration', () => {
    const desktopDir = join(testDir, 'desktop');
    const cliDir = join(testDir, 'cli');
    const mcpuOutputDir = join(testDir, 'mcpu-output');

    beforeEach(() => {
      mkdirSync(mcpuOutputDir, { recursive: true });

      // Copy Desktop fixture to test directory
      cpSync(DESKTOP_FIXTURE_DIR, desktopDir, { recursive: true });

      // Copy CLI fixture and add a duplicate server (playwright exists in both)
      cpSync(CLI_FIXTURE_DIR, cliDir, { recursive: true });
      const cliConfig = JSON.parse(readFileSync(join(cliDir, 'settings.json'), 'utf-8'));
      cliConfig.mcpServers.playwright = {
        command: 'npx',
        args: ['-y', '@anthropic/mcp-playwright', '--cli-mode'],
      };
      writeFileSync(join(cliDir, 'settings.json'), JSON.stringify(cliConfig, null, 2));

      vi.stubEnv('CLAUDE_DESKTOP_CONFIG_DIR', desktopDir);
      vi.stubEnv('CLAUDE_CONFIG_DIR', cliDir);
      vi.stubEnv('GEMINI_CONFIG_DIR', join(testDir, 'nonexistent-gemini'));
      vi.stubEnv('CURSOR_CONFIG_DIR', join(testDir, 'nonexistent-cursor'));
      vi.stubEnv('XDG_CONFIG_HOME', mcpuOutputDir);
    });

    it('should discover from both sources', () => {
      const result = discoverServers();
      expect(result).not.toBeNull();

      const { sources } = result!;
      expect(sources.desktop).toBe(join(desktopDir, 'claude_desktop_config.json'));
      expect(sources.cli).toBe(join(cliDir, 'settings.json'));
    });

    it('should prefer Desktop over CLI for duplicates', () => {
      const result = discoverServers();
      const { servers, duplicates } = deduplicateServers(result!.discovered);

      // playwright should come from Desktop (no --cli-mode flag)
      expect(servers.playwright.args).not.toContain('--cli-mode');
      expect(servers.playwright.args).toEqual(['-y', '@anthropic/mcp-playwright']);

      // Check duplicates include playwright
      const playwrightDup = duplicates.find(d => d.name === 'playwright');
      expect(playwrightDup).toBeDefined();
    });

    it('should merge unique servers from both sources', () => {
      const result = discoverServers();
      const { servers } = deduplicateServers(result!.discovered);

      // From Desktop
      expect(servers).toHaveProperty('playwright');
      expect(servers).toHaveProperty('filesystem');
      expect(servers).toHaveProperty('memory');

      // From CLI
      expect(servers).toHaveProperty('chroma');
      expect(servers).toHaveProperty('github');
    });

    it('should update both configs during migration', async () => {
      const result = await executeSetup({ dryRun: false });

      expect(result.success).toBe(true);

      // Desktop config updated
      const desktopConfig = JSON.parse(readFileSync(join(desktopDir, 'claude_desktop_config.json'), 'utf-8'));
      expect(desktopConfig.mcpServers).toEqual({
        mcpu: { command: 'mcpu', args: ['mcp'] },
      });

      // CLI config updated (with dynamic mcpu config based on install method)
      const cliConfig = JSON.parse(readFileSync(join(cliDir, 'settings.json'), 'utf-8'));
      expect(cliConfig.mcpServers.mcpu).toBeDefined();
      expect(cliConfig.mcpServers.mcpu.command).toBeDefined();

      // Both have backups
      const desktopFiles = require('node:fs').readdirSync(desktopDir);
      const cliFiles = require('node:fs').readdirSync(cliDir);
      expect(desktopFiles.some((f: string) => f.includes('.mcpu.bak'))).toBe(true);
      expect(cliFiles.some((f: string) => f.includes('.mcpu.bak'))).toBe(true);
    });
  });

  describe('npx detection', () => {
    it('isRunningViaNpx should detect npx via npm_execpath', () => {
      const originalExecPath = process.env.npm_execpath;
      try {
        process.env.npm_execpath = '/usr/local/lib/node_modules/npm/bin/npx-cli.js';
        expect(isRunningViaNpx()).toBe(true);

        process.env.npm_execpath = '/usr/local/lib/node_modules/npm/bin/npm-cli.js';
        expect(isRunningViaNpx()).toBe(false);
      } finally {
        if (originalExecPath !== undefined) {
          process.env.npm_execpath = originalExecPath;
        } else {
          delete process.env.npm_execpath;
        }
      }
    });

    it('getMcpuServerConfig should return npx config when not globally installed and running via npx', () => {
      const originalExecPath = process.env.npm_execpath;
      const originalArgv1 = process.argv[1];
      try {
        // Simulate npx execution with mcpu-mcp not available
        process.env.npm_execpath = '/path/to/npx-cli.js';
        process.argv[1] = '/tmp/_npx/12345/node_modules/.bin/mcpu';

        const config = getMcpuServerConfig();

        // Should use npx wrapper if mcpu-mcp not globally available
        if (!isMcpuMcpAvailable()) {
          expect(config.command).toBe('npx');
          expect(config.args).toContain('--package=@mcpu/cli');
          expect(config.args).toContain('mcpu-mcp');
        }
      } finally {
        if (originalExecPath !== undefined) {
          process.env.npm_execpath = originalExecPath;
        } else {
          delete process.env.npm_execpath;
        }
        process.argv[1] = originalArgv1;
      }
    });

    it('getMcpuServerConfig should return direct mcpu-mcp when globally installed', () => {
      // This test verifies the logic - if mcpu-mcp is available, use it directly
      if (isMcpuMcpAvailable()) {
        const config = getMcpuServerConfig();
        expect(config.command).toBe('mcpu-mcp');
        expect(config.args).toEqual([]);
      }
    });
  });

  // ==========================================================================
  // Gemini CLI Tests
  // ==========================================================================

  describe('getGeminiConfigDir', () => {
    it('should use GEMINI_CONFIG_DIR when set', () => {
      const customDir = join(testDir, 'custom-gemini');
      vi.stubEnv('GEMINI_CONFIG_DIR', customDir);
      expect(getGeminiConfigDir()).toBe(customDir);
    });

    it('should return default ~/.gemini when env not set', () => {
      vi.stubEnv('GEMINI_CONFIG_DIR', '');
      const result = getGeminiConfigDir();
      expect(result).toContain('.gemini');
    });
  });

  describe('readGeminiCliConfig', () => {
    it('should return null for missing file', () => {
      const result = readGeminiCliConfig(join(testDir, 'nonexistent.json'));
      expect(result).toBeNull();
    });

    it('should parse valid config with mcpServers', () => {
      const geminiDir = join(testDir, 'gemini');
      mkdirSync(geminiDir, { recursive: true });
      const configPath = join(geminiDir, 'settings.json');
      writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          'test-server': {
            command: 'test-cmd',
            args: ['--arg1'],
          },
        },
        general: { previewFeatures: true },
      }));

      const result = readGeminiCliConfig(configPath);
      expect(result).not.toBeNull();
      expect(result!['test-server']).toEqual({
        command: 'test-cmd',
        args: ['--arg1'],
      });
    });

    it('should handle SSE transport config', () => {
      const geminiDir = join(testDir, 'gemini');
      mkdirSync(geminiDir, { recursive: true });
      const configPath = join(geminiDir, 'settings.json');
      writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          'sse-server': {
            url: 'http://localhost:8080/sse',
            headers: { 'Authorization': 'Bearer token' },
          },
        },
      }));

      const result = readGeminiCliConfig(configPath);
      expect(result).not.toBeNull();
      expect(result!['sse-server']).toEqual({
        url: 'http://localhost:8080/sse',
        headers: { 'Authorization': 'Bearer token' },
      });
    });

    it('should return empty object for config without mcpServers', () => {
      const geminiDir = join(testDir, 'gemini');
      mkdirSync(geminiDir, { recursive: true });
      const configPath = join(geminiDir, 'settings.json');
      writeFileSync(configPath, JSON.stringify({ general: { previewFeatures: true } }));

      const result = readGeminiCliConfig(configPath);
      expect(result).toEqual({});
    });

    it('should return null for invalid JSON', () => {
      const geminiDir = join(testDir, 'gemini');
      mkdirSync(geminiDir, { recursive: true });
      const configPath = join(geminiDir, 'settings.json');
      writeFileSync(configPath, 'not valid json');

      const result = readGeminiCliConfig(configPath);
      expect(result).toBeNull();
    });
  });

  describe('updateGeminiCliConfig', () => {
    it('should replace mcpServers with only MCPU', () => {
      const geminiDir = join(testDir, 'gemini');
      mkdirSync(geminiDir, { recursive: true });
      const configPath = join(geminiDir, 'settings.json');
      writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          'old-server': { command: 'old-cmd' },
        },
        general: { previewFeatures: true },
        security: { auth: { selectedType: 'oauth-personal' } },
      }));

      updateGeminiCliConfig(configPath);

      const updated = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(updated.mcpServers.mcpu).toBeDefined();
      expect(updated.mcpServers.mcpu.command).toBeDefined();
      expect(updated.mcpServers['old-server']).toBeUndefined();
      expect(updated.general.previewFeatures).toBe(true);
      expect(updated.security.auth.selectedType).toBe('oauth-personal');
    });

    it('should create backup before updating', () => {
      const geminiDir = join(testDir, 'gemini');
      mkdirSync(geminiDir, { recursive: true });
      const configPath = join(geminiDir, 'settings.json');
      writeFileSync(configPath, JSON.stringify({
        mcpServers: { 'old-server': { command: 'old-cmd' } },
      }));

      updateGeminiCliConfig(configPath);

      const files = require('node:fs').readdirSync(geminiDir);
      const backupFile = files.find((f: string) => f === 'settings.json.mcpu.bak');
      expect(backupFile).toBeDefined();
    });

    it('should handle missing config file gracefully', () => {
      const configPath = join(testDir, 'nonexistent.json');
      expect(() => updateGeminiCliConfig(configPath)).not.toThrow();
    });
  });

  describe('integration: Gemini CLI migration', () => {
    const geminiDir = join(testDir, 'gemini');
    const mcpuOutputDir = join(testDir, 'mcpu-output');

    beforeEach(() => {
      mkdirSync(mcpuOutputDir, { recursive: true });

      // Copy Gemini fixture to test directory
      cpSync(GEMINI_FIXTURE_DIR, geminiDir, { recursive: true });

      // Set env vars - only Gemini, no Desktop or Claude CLI
      vi.stubEnv('GEMINI_CONFIG_DIR', geminiDir);
      vi.stubEnv('CLAUDE_DESKTOP_CONFIG_DIR', join(testDir, 'nonexistent-desktop'));
      vi.stubEnv('CLAUDE_CONFIG_DIR', join(testDir, 'nonexistent-cli'));
      vi.stubEnv('CURSOR_CONFIG_DIR', join(testDir, 'nonexistent-cursor'));
      vi.stubEnv('XDG_CONFIG_HOME', mcpuOutputDir);
    });

    it('should discover all servers from Gemini CLI config', () => {
      const result = discoverServers();
      expect(result).not.toBeNull();

      const { discovered, sources } = result!;

      // Check sources
      expect(sources.gemini).toBe(join(geminiDir, 'settings.json'));
      expect(sources.desktop).toBeUndefined();
      expect(sources.cli).toBeUndefined();

      // Global servers from Gemini
      expect(discovered.global).toHaveProperty('sqlite');
      expect(discovered.global).toHaveProperty('brave-search');
    });

    it('should execute full migration and update Gemini config', async () => {
      const result = await executeSetup({ dryRun: false });

      expect(result.success).toBe(true);
      expect(Object.keys(result.plan!.servers)).toHaveLength(2);

      // Check MCPU config
      const mcpuConfigPath = join(mcpuOutputDir, 'mcpu', 'config.json');
      expect(existsSync(mcpuConfigPath)).toBe(true);
      const mcpuConfig = JSON.parse(readFileSync(mcpuConfigPath, 'utf-8'));
      expect(mcpuConfig).toHaveProperty('sqlite');
      expect(mcpuConfig).toHaveProperty('brave-search');

      // Check env vars preserved
      expect(mcpuConfig['sqlite'].env).toEqual({ DATABASE_PATH: '~/data/app.db' });
      expect(mcpuConfig['brave-search'].env).toEqual({ BRAVE_API_KEY: 'bsk_xxxx' });

      // Check Gemini config was updated - mcpServers replaced with mcpu
      const geminiConfig = JSON.parse(readFileSync(join(geminiDir, 'settings.json'), 'utf-8'));
      expect(geminiConfig.mcpServers.mcpu).toBeDefined();
      expect(geminiConfig.mcpServers['sqlite']).toBeUndefined();
      expect(geminiConfig.mcpServers['brave-search']).toBeUndefined();

      // Other settings preserved
      expect(geminiConfig.general.previewFeatures).toBe(true);
      expect(geminiConfig.security.auth.selectedType).toBe('oauth-personal');

      // Check backup was created
      const files = require('node:fs').readdirSync(geminiDir);
      expect(files.some((f: string) => f === 'settings.json.mcpu.bak')).toBe(true);
    });

    it('should support dry-run mode', async () => {
      const result = await executeSetup({ dryRun: true });

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();

      // MCPU config should NOT be created
      const mcpuConfigPath = join(mcpuOutputDir, 'mcpu', 'config.json');
      expect(existsSync(mcpuConfigPath)).toBe(false);

      // Gemini config should NOT be modified
      const geminiConfig = JSON.parse(readFileSync(join(geminiDir, 'settings.json'), 'utf-8'));
      expect(geminiConfig.mcpServers).toHaveProperty('sqlite');
      expect(geminiConfig.mcpServers).not.toHaveProperty('mcpu');
    });
  });

  describe('integration: Combined Claude + Gemini migration', () => {
    const desktopDir = join(testDir, 'desktop');
    const geminiDir = join(testDir, 'gemini');
    const mcpuOutputDir = join(testDir, 'mcpu-output');

    beforeEach(() => {
      mkdirSync(mcpuOutputDir, { recursive: true });

      // Copy Desktop fixture to test directory
      cpSync(DESKTOP_FIXTURE_DIR, desktopDir, { recursive: true });

      // Copy Gemini fixture with a duplicate server (playwright exists in Desktop)
      cpSync(GEMINI_FIXTURE_DIR, geminiDir, { recursive: true });
      const geminiConfig = JSON.parse(readFileSync(join(geminiDir, 'settings.json'), 'utf-8'));
      geminiConfig.mcpServers.playwright = {
        command: 'npx',
        args: ['-y', '@anthropic/mcp-playwright', '--gemini-mode'],
      };
      writeFileSync(join(geminiDir, 'settings.json'), JSON.stringify(geminiConfig, null, 2));

      vi.stubEnv('CLAUDE_DESKTOP_CONFIG_DIR', desktopDir);
      vi.stubEnv('CLAUDE_CONFIG_DIR', join(testDir, 'nonexistent-cli'));
      vi.stubEnv('GEMINI_CONFIG_DIR', geminiDir);
      vi.stubEnv('CURSOR_CONFIG_DIR', join(testDir, 'nonexistent-cursor'));
      vi.stubEnv('XDG_CONFIG_HOME', mcpuOutputDir);
    });

    it('should discover from both sources', () => {
      const result = discoverServers();
      expect(result).not.toBeNull();

      const { sources } = result!;
      expect(sources.desktop).toBe(join(desktopDir, 'claude_desktop_config.json'));
      expect(sources.gemini).toBe(join(geminiDir, 'settings.json'));
    });

    it('should prefer Claude Desktop over Gemini for duplicates', () => {
      const result = discoverServers();
      const { servers } = deduplicateServers(result!.discovered);

      // playwright should come from Desktop (no --gemini-mode flag)
      expect(servers.playwright.args).not.toContain('--gemini-mode');
      expect(servers.playwright.args).toEqual(['-y', '@anthropic/mcp-playwright']);
    });

    it('should merge unique servers from both sources', () => {
      const result = discoverServers();
      const { servers } = deduplicateServers(result!.discovered);

      // From Desktop
      expect(servers).toHaveProperty('playwright');
      expect(servers).toHaveProperty('filesystem');
      expect(servers).toHaveProperty('memory');

      // From Gemini
      expect(servers).toHaveProperty('sqlite');
      expect(servers).toHaveProperty('brave-search');
    });

    it('should update both configs during migration', async () => {
      const result = await executeSetup({ dryRun: false });

      expect(result.success).toBe(true);

      // Desktop config updated
      const desktopConfig = JSON.parse(readFileSync(join(desktopDir, 'claude_desktop_config.json'), 'utf-8'));
      expect(desktopConfig.mcpServers).toEqual({
        mcpu: { command: 'mcpu', args: ['mcp'] },
      });

      // Gemini config updated
      const geminiConfig = JSON.parse(readFileSync(join(geminiDir, 'settings.json'), 'utf-8'));
      expect(geminiConfig.mcpServers.mcpu).toBeDefined();

      // Both have backups
      const desktopFiles = require('node:fs').readdirSync(desktopDir);
      const geminiFiles = require('node:fs').readdirSync(geminiDir);
      expect(desktopFiles.some((f: string) => f.includes('.mcpu.bak'))).toBe(true);
      expect(geminiFiles.some((f: string) => f.includes('.mcpu.bak'))).toBe(true);
    });
  });
});
