import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatParamType, formatToolInfo, formatMcpResponse, abbreviateType, compactJson, LEGEND_HEADER, TYPES_LINE, autoSaveResponse } from '../src/formatters.js';
import { AUTO_SAVE_DEFAULTS } from '../src/config.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { mkdir, rm, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';

describe('Formatters', () => {
  describe('abbreviateType', () => {
    it('should abbreviate common types', () => {
      expect(abbreviateType('string')).toBe('S');
      expect(abbreviateType('integer')).toBe('I');
      expect(abbreviateType('number')).toBe('N');
      expect(abbreviateType('null')).toBe('Z');
      expect(abbreviateType('boolean')).toBe('B');
      expect(abbreviateType('object')).toBe('O');
      // Arrays use [] suffix, not abbreviation
      expect(abbreviateType('array')).toBe('array');
    });

    it('should pass through unknown types', () => {
      expect(abbreviateType('custom')).toBe('custom');
    });
  });

  describe('compactJson', () => {
    it('should compact indented JSON objects', () => {
      const input = `{
  "name": "test",
  "value": 123
}`;
      expect(compactJson(input)).toBe('{"name":"test","value":123}');
    });

    it('should compact indented JSON arrays', () => {
      const input = `[
  "a",
  "b",
  "c"
]`;
      expect(compactJson(input)).toBe('["a","b","c"]');
    });

    it('should return non-JSON text as-is', () => {
      expect(compactJson('Hello world')).toBe('Hello world');
      expect(compactJson('not { valid json')).toBe('not { valid json');
    });

    it('should handle already compact JSON', () => {
      expect(compactJson('{"name":"test"}')).toBe('{"name":"test"}');
    });

    it('should preserve leading/trailing content for non-JSON', () => {
      expect(compactJson('  plain text  ')).toBe('  plain text  ');
    });
  });

  describe('Legend constants', () => {
    it('should have proper header', () => {
      expect(LEGEND_HEADER).toBe('# Legend');
    });

    it('should include all type abbreviations', () => {
      expect(TYPES_LINE).toMatch(/^Types:/);
      expect(TYPES_LINE).toContain('S=string');
      expect(TYPES_LINE).toContain('I=integer');
      expect(TYPES_LINE).toContain('O=object');
      // Arrays use [] suffix, not A abbreviation
      expect(TYPES_LINE).not.toContain('A=array');
    });
  });

  describe('formatParamType', () => {
    it('should format simple string type', () => {
      const result = formatParamType({ type: 'string' });
      expect(result).toBe('S');
    });

    it('should format number type', () => {
      const result = formatParamType({ type: 'number' });
      expect(result).toBe('N');
    });

    it('should format union types', () => {
      const result = formatParamType({ type: ['string', 'boolean'] });
      expect(result).toBe('S|B');
    });

    it('should format enum types without enum() wrapper', () => {
      const result = formatParamType({
        type: 'string',
        enum: ['option1', 'option2', 'option3'],
      });
      expect(result).toBe('option1|option2|option3');
    });

    it('should format simple array types', () => {
      const result = formatParamType({
        type: 'array',
        items: { type: 'string' },
      });
      expect(result).toBe('S[]');
    });

    it('should format array of objects with structure', () => {
      const result = formatParamType({
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
            email: { type: 'string' },
          },
          required: ['name', 'age'],
        },
      });
      expect(result).toBe('O{name:S, age:N, email?:S}[]');
    });

    it('should format array of objects with enum fields', () => {
      const result = formatParamType({
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['textbox', 'checkbox', 'radio'],
            },
            value: { type: 'string' },
          },
          required: ['type', 'value'],
        },
      });
      expect(result).toBe('O{type:textbox|checkbox|radio, value:S}[]');
    });

    it('should format object with properties', () => {
      const result = formatParamType({
        type: 'object',
        properties: {
          field1: { type: 'string' },
          field2: { type: 'number' },
        },
        required: ['field1'],
      });
      expect(result).toBe('O{field1:S, field2?:N}');
    });

    it('should format object with enum properties', () => {
      const result = formatParamType({
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['active', 'inactive'],
          },
          count: { type: 'number' },
        },
        required: ['status'],
      });
      expect(result).toBe('O{status:active|inactive, count?:N}');
    });

    it('should handle missing type', () => {
      const result = formatParamType({});
      expect(result).toBe('any');
    });

    it('should handle array without items schema', () => {
      const result = formatParamType({ type: 'array' });
      // Bare array without items - falls through as 'array' (rare case)
      expect(result).toBe('array');
    });
  });

  describe('formatToolInfo', () => {
    it('should format basic tool with simple parameters', () => {
      const tool: Tool = {
        name: 'read_file',
        description: 'Read a file from disk',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
          },
          required: ['path'],
        },
      };

      const result = formatToolInfo(tool);

      expect(result).toContain('# read_file');
      expect(result).toContain('Read a file from disk');
      expect(result).toContain('ARGS:');
      expect(result).toContain('path: S - File path');
      expect(result).not.toContain('Usage:');
      // Legend is added by caller, not formatToolInfo
      expect(result).not.toContain(LEGEND_HEADER);
    });

    it('should show title when different from name', () => {
      const tool: any = {
        name: 'browser_fill_form',
        title: 'Fill Form',
        description: 'Fill multiple form fields',
        inputSchema: { type: 'object', properties: {} },
      };

      const result = formatToolInfo(tool);

      expect(result).toContain('# browser_fill_form');
      expect(result).toContain('(Fill Form)');
    });

    it('should show annotations as hints', () => {
      const tool: any = {
        name: 'delete_file',
        description: 'Delete a file',
        inputSchema: { type: 'object', properties: {} },
        annotations: {
          destructiveHint: true,
          readOnlyHint: false,
        },
      };

      const result = formatToolInfo(tool);

      expect(result).toContain('Hints: destructive');
      expect(result).not.toContain('read-only');
    });

    it('should show multiple hints', () => {
      const tool: any = {
        name: 'browser_action',
        description: 'Perform browser action',
        inputSchema: { type: 'object', properties: {} },
        annotations: {
          destructiveHint: true,
          openWorldHint: true,
          idempotentHint: false,
        },
      };

      const result = formatToolInfo(tool);

      expect(result).toContain('Hints: destructive, open-world');
    });

    it('should format complex nested parameters', () => {
      const tool: Tool = {
        name: 'browser_fill_form',
        description: 'Fill multiple form fields',
        inputSchema: {
          type: 'object',
          properties: {
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  type: {
                    type: 'string',
                    enum: ['textbox', 'checkbox'],
                  },
                  value: { type: 'string' },
                },
                required: ['name', 'type', 'value'],
              },
            },
          },
          required: ['fields'],
        },
      };

      const result = formatToolInfo(tool);

      expect(result).toContain('fields: O{name:S, type:textbox|checkbox, value:S}[]');
    });

    it('should show output schema if present', () => {
      const tool: any = {
        name: 'get_data',
        description: 'Get data',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object' },
      };

      const result = formatToolInfo(tool);

      expect(result).toContain('-> O');
    });

    it('should handle tools with no parameters', () => {
      const tool: Tool = {
        name: 'ping',
        description: 'Ping the server',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      };

      const result = formatToolInfo(tool);

      expect(result).toContain('ARGS:');
      expect(result).toContain('(none)');
    });

    it('should show optional parameters with ?', () => {
      const tool: Tool = {
        name: 'list_files',
        description: 'List files',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['path'],
        },
      };

      const result = formatToolInfo(tool);

      expect(result).toContain('path: S');
      expect(result).not.toContain('path?');
      expect(result).toContain('limit?: N');
    });

    it('should show default values as =value', () => {
      const tool: Tool = {
        name: 'list_files',
        description: 'List files',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', default: 100 },
          },
        },
      };

      const result = formatToolInfo(tool);

      expect(result).toContain('limit?: N=100');
    });
  });

  describe('formatMcpResponse', () => {
    it('should extract text from content array', () => {
      const response = {
        content: [
          { type: 'text', text: 'Hello world' },
        ],
      };

      const result = formatMcpResponse(response);
      expect(result).toBe('Hello world');
    });

    it('should handle multiple text items', () => {
      const response = {
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
        ],
      };

      const result = formatMcpResponse(response);
      expect(result).toBe('Part 1\nPart 2');
    });

    it('should format image content', () => {
      const response = {
        content: [
          { type: 'image', data: 'base64...', mimeType: 'image/png' },
        ],
      };

      const result = formatMcpResponse(response);
      expect(result).toContain('[Image: image/png]');
    });

    it('should format resource content', () => {
      const response = {
        content: [
          {
            type: 'resource',
            uri: 'file:///tmp/test.txt',
            text: 'Resource text',
          },
        ],
      };

      const result = formatMcpResponse(response);
      expect(result).toContain('[Resource: file:///tmp/test.txt]');
      expect(result).toContain('Resource text');
    });

    it('should handle string responses', () => {
      const result = formatMcpResponse('Simple string');
      expect(result).toBe('Simple string');
    });

    it('should handle error responses', () => {
      const response = {
        isError: true,
        content: [{ type: 'text', text: 'Error occurred' }],
      };

      expect(() => formatMcpResponse(response)).toThrow('Error occurred');
    });

    it('should stringify non-standard responses compactly', () => {
      const response = { custom: 'data', value: 123 };
      const result = formatMcpResponse(response);
      expect(result).toBe('{"custom":"data","value":123}');
    });

    it('should compact JSON text content', () => {
      const response = {
        content: [
          { type: 'text', text: '{\n  "name": "test",\n  "value": 123\n}' },
        ],
      };

      const result = formatMcpResponse(response);
      expect(result).toBe('{"name":"test","value":123}');
    });

    it('should not modify non-JSON text content', () => {
      const response = {
        content: [
          { type: 'text', text: 'Hello, this is plain text' },
        ],
      };

      const result = formatMcpResponse(response);
      expect(result).toBe('Hello, this is plain text');
    });
  });

  describe('autoSaveResponse', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `mcpu-autosave-test-${Date.now()}`);
      await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
      if (existsSync(testDir)) {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('should not save response below threshold', async () => {
      const response = {
        content: [{ type: 'text', text: 'Short response' }],
      };
      const config = { ...AUTO_SAVE_DEFAULTS, thresholdSize: 1000 };

      const result = await autoSaveResponse(response, 'test', 'tool', config, testDir);

      expect(result.saved).toBe(false);
      expect(result.output).toBe('Short response');
      expect(result.manifestPath).toBeUndefined();
    });

    it('should save text response above threshold', async () => {
      const longText = 'A'.repeat(2000);
      const response = {
        content: [{ type: 'text', text: longText }],
      };
      const config = { ...AUTO_SAVE_DEFAULTS, thresholdSize: 100, dir: '.temp' };

      const result = await autoSaveResponse(response, 'test', 'tool', config, testDir);

      expect(result.saved).toBe(true);
      expect(result.output).toContain('[Response');
      expect(result.output).toContain('extracted to');
      expect(result.extractedFiles).toHaveLength(1);

      // Verify file was created
      const extractedFile = result.extractedFiles![0];
      expect(existsSync(extractedFile)).toBe(true);
      const savedContent = await readFile(extractedFile, 'utf-8');
      expect(savedContent).toBe(longText);
    });

    it('should save JSON content to .json file with pretty printing', async () => {
      const jsonData = { name: 'test', value: 123, nested: { key: 'value' } };
      const response = {
        content: [{ type: 'text', text: JSON.stringify(jsonData) }],
      };
      const config = { ...AUTO_SAVE_DEFAULTS, thresholdSize: 10, dir: '.temp' };

      const result = await autoSaveResponse(response, 'server', 'tool', config, testDir);

      expect(result.saved).toBe(true);
      const extractedFile = result.extractedFiles![0];
      expect(extractedFile).toMatch(/\.json$/);

      const savedContent = await readFile(extractedFile, 'utf-8');
      expect(JSON.parse(savedContent)).toEqual(jsonData);
      // Check pretty-printed (has indentation)
      expect(savedContent).toContain('\n');
    });

    it('should extract image content to binary file', async () => {
      // Create a small PNG-like binary data
      const pngData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]).toString('base64');
      const response = {
        content: [
          { type: 'text', text: 'A'.repeat(100) },
          { type: 'image', data: pngData, mimeType: 'image/png' },
        ],
      };
      const config = { ...AUTO_SAVE_DEFAULTS, thresholdSize: 10, dir: '.temp' };

      const result = await autoSaveResponse(response, 'playwright', 'snapshot', config, testDir);

      expect(result.saved).toBe(true);
      expect(result.extractedFiles).toHaveLength(2);

      // Find the image file
      const imageFile = result.extractedFiles!.find(f => f.endsWith('.png'));
      expect(imageFile).toBeDefined();

      // Verify binary content
      const savedContent = await readFile(imageFile!, null);
      expect(savedContent.toString('base64')).toBe(pngData);
    });

    it('should create manifest with _extracted references', async () => {
      const response = {
        content: [
          { type: 'text', text: 'A'.repeat(100) },
        ],
      };
      const config = { ...AUTO_SAVE_DEFAULTS, thresholdSize: 10, dir: '.temp' };

      const result = await autoSaveResponse(response, 'server', 'tool', config, testDir);

      expect(result.manifestPath).toBeDefined();
      const manifest = JSON.parse(await readFile(result.manifestPath!, 'utf-8'));

      expect(manifest.content).toHaveLength(1);
      expect(manifest.content[0].type).toBe('text');
      expect(manifest.content[0]._extracted).toBeDefined();
      expect(manifest.content[0]._extracted).toMatch(/\.txt$/);
    });

    it('should show preview of text content in output', async () => {
      const longText = 'START' + 'X'.repeat(600) + 'END';
      const response = {
        content: [{ type: 'text', text: longText }],
      };
      const config = { ...AUTO_SAVE_DEFAULTS, thresholdSize: 10, previewSize: 100, dir: '.temp' };

      const result = await autoSaveResponse(response, 'server', 'tool', config, testDir);

      expect(result.output).toContain('START');
      expect(result.output).toContain('...');
      expect(result.output).not.toContain('END');
    });

    it('should handle multiple text items with indexed filenames', async () => {
      const response = {
        content: [
          { type: 'text', text: 'A'.repeat(50) },
          { type: 'text', text: 'B'.repeat(50) },
        ],
      };
      const config = { ...AUTO_SAVE_DEFAULTS, thresholdSize: 10, dir: '.temp' };

      const result = await autoSaveResponse(response, 'server', 'tool', config, testDir);

      expect(result.extractedFiles).toHaveLength(2);
      // Check files have different names
      expect(result.extractedFiles![0]).not.toBe(result.extractedFiles![1]);
    });

    it('should save simple non-MCP response as plain file', async () => {
      const longText = 'A'.repeat(200);
      const config = { ...AUTO_SAVE_DEFAULTS, thresholdSize: 10, dir: '.temp' };

      const result = await autoSaveResponse(longText, 'server', 'tool', config, testDir);

      expect(result.saved).toBe(true);
      expect(result.extractedFiles).toHaveLength(1);
      expect(result.extractedFiles![0]).toMatch(/\.txt$/);
    });
  });
});
