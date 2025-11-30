import { describe, it, expect } from 'vitest';
import { formatParamType, formatToolInfo, formatMcpResponse, abbreviateType, LEGEND_HEADER, TYPES_LINE } from '../src/formatters.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

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

    it('should stringify non-standard responses', () => {
      const response = { custom: 'data', value: 123 };
      const result = formatMcpResponse(response);
      expect(result).toContain('"custom"');
      expect(result).toContain('"value"');
    });
  });
});
