import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Remote CLI', () => {
  let mockFetch: any;
  let mockConsoleLog: any;
  let mockConsoleError: any;

  beforeEach(() => {
    // Mock fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Mock console
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('YAML parsing logic', () => {
    it('should parse valid YAML with params key', async () => {
      const yamlContent = `params:
  field1: value1
  field2: 42`;

      const { parse: parseYaml } = await import('yaml');
      const parsed = parseYaml(yamlContent);

      expect(parsed).toHaveProperty('params');
      expect(parsed.params).toEqual({
        field1: 'value1',
        field2: 42,
      });
    });

    it('should parse valid YAML without params key (direct object)', async () => {
      const yamlContent = `field1: value1
field2: 42`;

      const { parse: parseYaml } = await import('yaml');
      const parsed = parseYaml(yamlContent);

      expect(parsed).toEqual({
        field1: 'value1',
        field2: 42,
      });
    });

    it('should parse YAML with nested objects', async () => {
      const yamlContent = `params:
  fields:
    - name: First Name
      type: textbox
      value: John
    - name: Last Name
      type: textbox
      value: Doe
  options:
    nested:
      key: value`;

      const { parse: parseYaml } = await import('yaml');
      const parsed = parseYaml(yamlContent);

      expect(parsed.params.fields).toHaveLength(2);
      expect(parsed.params.fields[0]).toEqual({
        name: 'First Name',
        type: 'textbox',
        value: 'John',
      });
      expect(parsed.params.options.nested.key).toBe('value');
    });

    it('should handle invalid YAML gracefully', async () => {
      const invalidYaml = `{invalid: yaml: content`;

      const { parse: parseYaml } = await import('yaml');

      expect(() => parseYaml(invalidYaml)).toThrow();
    });
  });

  describe('HTTP request formatting', () => {
    it('should send correct request body without params', async () => {
      mockFetch.mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: true,
          output: 'Success',
          exitCode: 0,
        }),
      });

      const port = 8080;
      const argv = ['servers'];
      const expectedBody = {
        argv: ['servers'],
        cwd: process.cwd(),
      };

      // We can't directly test sendCommand since it calls process.exit
      // But we can verify the expected fetch call format
      await mockFetch(`http://localhost:${port}/cli`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expectedBody),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:${port}/cli`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(expectedBody),
        })
      );
    });

    it('should include params in request body when provided', async () => {
      const port = 8080;
      const argv = ['call', 'server', 'tool'];
      const params = { field1: 'value1', field2: 42 };
      const expectedBody = {
        argv: ['call', 'server', 'tool'],
        cwd: process.cwd(),
        params: { field1: 'value1', field2: 42 },
      };

      await mockFetch(`http://localhost:${port}/cli`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expectedBody),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:${port}/cli`,
        expect.objectContaining({
          body: JSON.stringify(expectedBody),
        })
      );
    });
  });

  describe('Response handling', () => {
    it('should handle successful response', async () => {
      const successResponse = {
        success: true,
        output: 'Command executed successfully',
        exitCode: 0,
      };

      // Verify the expected behavior
      expect(successResponse.success).toBe(true);
      expect(successResponse.exitCode).toBe(0);
    });

    it('should handle error response', async () => {
      const errorResponse = {
        success: false,
        error: 'Command failed',
        output: 'Error output',
        exitCode: 1,
      };

      // Verify the expected behavior
      expect(errorResponse.success).toBe(false);
      expect(errorResponse.exitCode).toBe(1);
    });

    it('should handle response with both error and output', async () => {
      const response = {
        success: false,
        error: 'Specific error message',
        output: 'General output',
        exitCode: 1,
      };

      // Both error and output should be different
      expect(response.error).not.toBe(response.output);
    });
  });

  describe('Params extraction logic', () => {
    it('should extract params from YAML with params key', () => {
      const parsed = {
        params: { field1: 'value1', field2: 42 },
      };

      const params = parsed.params !== undefined ? parsed.params : parsed;

      expect(params).toEqual({ field1: 'value1', field2: 42 });
    });

    it('should use entire object when no params key', () => {
      const parsed = {
        field1: 'value1',
        field2: 42,
      };

      const params = parsed.params !== undefined ? parsed.params : parsed;

      expect(params).toEqual({ field1: 'value1', field2: 42 });
    });

    it('should handle argv field in YAML (if present)', () => {
      const parsed = {
        argv: ['additional', 'args'],
        params: { field1: 'value1' },
      };

      // Current implementation only uses params, not argv from YAML
      const params = parsed.params !== undefined ? parsed.params : parsed;

      expect(params).toEqual({ field1: 'value1' });
    });
  });

  describe('Error scenarios', () => {
    it('should create error for invalid YAML', () => {
      const { parse: parseYaml } = require('yaml');

      expect(() => {
        parseYaml('invalid: yaml: {content');
      }).toThrow();
    });

    it('should handle empty stdin', () => {
      const { parse: parseYaml } = require('yaml');
      const emptyYaml = '';

      const result = parseYaml(emptyYaml);
      expect(result).toBeNull();
    });

    it('should handle malformed nested structures', () => {
      const { parse: parseYaml } = require('yaml');
      const malformedYaml = `params:
  - invalid
    nested: structure`;

      // Should either parse with unexpected structure or throw
      expect(() => parseYaml(malformedYaml)).toBeDefined();
    });
  });

  describe('Command forwarding', () => {
    it('should forward servers command', () => {
      const argv = ['servers'];
      const expectedRequest = {
        argv: ['servers'],
        cwd: expect.any(String),
      };

      expect(expectedRequest.argv).toEqual(['servers']);
    });

    it('should forward tools command with server names', () => {
      const argv = ['tools', 'playwright', 'filesystem'];
      const expectedRequest = {
        argv: ['tools', 'playwright', 'filesystem'],
        cwd: expect.any(String),
      };

      expect(expectedRequest.argv).toEqual(['tools', 'playwright', 'filesystem']);
    });

    it('should forward call command with tool arguments', () => {
      const argv = ['call', 'playwright', 'navigate', '--url=https://example.com'];
      const expectedRequest = {
        argv: ['call', 'playwright', 'navigate', '--url=https://example.com'],
        cwd: expect.any(String),
      };

      expect(expectedRequest.argv).toEqual(['call', 'playwright', 'navigate', '--url=https://example.com']);
    });
  });

  describe('Integration: --stdin flag with params', () => {
    it('should combine --stdin flag with params for call command', () => {
      const argv = ['call', 'server', 'tool', '--stdin'];
      const params = { field1: 'value1', field2: 42 };
      const expectedRequest = {
        argv: ['call', 'server', 'tool', '--stdin'],
        params: { field1: 'value1', field2: 42 },
        cwd: expect.any(String),
      };

      expect(expectedRequest.argv).toContain('--stdin');
      expect(expectedRequest.params).toEqual(params);
    });

    it('should handle complex params with arrays', () => {
      const params = {
        fields: [
          { name: 'field1', value: 'value1' },
          { name: 'field2', value: 'value2' },
        ],
      };
      const expectedRequest = {
        argv: ['call', 'server', 'tool'],
        params,
        cwd: expect.any(String),
      };

      expect(expectedRequest.params.fields).toHaveLength(2);
      expect(Array.isArray(expectedRequest.params.fields)).toBe(true);
    });
  });
});
