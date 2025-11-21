import { describe, it, expect } from 'vitest';
import { formatParamType, formatToolInfo, formatMcpResponse } from '../src/formatters.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

describe('Formatters', () => {
  describe('formatParamType', () => {
    it('should format simple string type', () => {
      const result = formatParamType({ type: 'string' });
      expect(result).toBe('string');
    });

    it('should format number type', () => {
      const result = formatParamType({ type: 'number' });
      expect(result).toBe('number');
    });

    it('should format union types', () => {
      const result = formatParamType({ type: ['string', 'boolean'] });
      expect(result).toBe('string|boolean');
    });

    it('should format enum types', () => {
      const result = formatParamType({
        type: 'string',
        enum: ['option1', 'option2', 'option3'],
      });
      expect(result).toBe('enum(option1|option2|option3)');
    });

    it('should format simple array types', () => {
      const result = formatParamType({
        type: 'array',
        items: { type: 'string' },
      });
      expect(result).toBe('string[]');
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
      expect(result).toBe('array[{name:string, age:number, email?:string}]');
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
      expect(result).toBe('array[{type:enum(textbox|checkbox|radio), value:string}]');
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
      expect(result).toBe('{field1:string, field2?:number}');
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
      expect(result).toBe('{status:enum(active|inactive), count?:number}');
    });

    it('should handle missing type', () => {
      const result = formatParamType({});
      expect(result).toBe('any');
    });

    it('should handle array without items schema', () => {
      const result = formatParamType({ type: 'array' });
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

      const result = formatToolInfo(tool, 'filesystem');

      expect(result).toContain('read_file');
      expect(result).toContain('Read a file from disk');
      expect(result).toContain('Parameters:');
      expect(result).toContain('path: string - File path');
      expect(result).toContain('Usage:');
      expect(result).toContain('mcpu call filesystem read_file');
    });

    it('should show title when different from name', () => {
      const tool: any = {
        name: 'browser_fill_form',
        title: 'Fill Form',
        description: 'Fill multiple form fields',
        inputSchema: { type: 'object', properties: {} },
      };

      const result = formatToolInfo(tool, 'playwright');

      expect(result).toContain('Fill Form');
      expect(result).toContain('(browser_fill_form)');
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

      const result = formatToolInfo(tool, 'filesystem');

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

      const result = formatToolInfo(tool, 'playwright');

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

      const result = formatToolInfo(tool, 'playwright');

      expect(result).toContain('fields: array[{name:string, type:enum(textbox|checkbox), value:string}]');
    });

    it('should show output schema if present', () => {
      const tool: any = {
        name: 'get_data',
        description: 'Get data',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object' },
      };

      const result = formatToolInfo(tool, 'server');

      expect(result).toContain('Returns: object');
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

      const result = formatToolInfo(tool, 'server');

      expect(result).toContain('Parameters:');
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

      const result = formatToolInfo(tool, 'filesystem');

      expect(result).toContain('path: string');
      expect(result).not.toContain('path?');
      expect(result).toContain('limit?: number');
    });

    it('should show default values', () => {
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

      const result = formatToolInfo(tool, 'filesystem');

      expect(result).toContain('(default: 100)');
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

    it('should stringify non-standard responses', () => {
      const response = { custom: 'data', value: 123 };
      const result = formatMcpResponse(response);
      expect(result).toContain('"custom"');
      expect(result).toContain('"value"');
    });
  });
});
