import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPClient } from '../src/client.js';
import type { MCPServerConfig } from '../src/types.js';

// Create mock instances that can be accessed
let mockClientInstance: any;
let mockTransportInstance: any;

// Mock the MCP SDK
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => {
    mockClientInstance = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'test_tool',
            description: 'A test tool',
            inputSchema: {
              type: 'object',
              properties: {
                arg1: { type: 'string' },
              },
            },
          },
        ],
      }),
      callTool: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'Tool result',
          },
        ],
      }),
    };
    return mockClientInstance;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => {
    mockTransportInstance = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    return mockTransportInstance;
  }),
}));

describe('MCPClient', () => {
  let client: MCPClient;

  beforeEach(() => {
    client = new MCPClient();
    vi.clearAllMocks();
  });

  describe('connect', () => {
    it('should create a connection to an MCP server', async () => {
      const config: MCPServerConfig = {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      };

      const connection = await client.connect('filesystem', config);

      expect(connection).toBeDefined();
      expect(connection.serverName).toBe('filesystem');
      expect(connection.client).toBeDefined();
      expect(connection.transport).toBeDefined();
    });

    it('should pass environment variables to the transport', async () => {
      const config: MCPServerConfig = {
        command: 'uvx',
        args: ['mcp-server-github'],
        env: {
          GITHUB_TOKEN: 'test-token',
        },
      };

      const connection = await client.connect('github', config);

      expect(connection).toBeDefined();
      expect(connection.serverName).toBe('github');
    });

    it('should inherit all parent env vars and merge with config env', async () => {
      // Get the StdioClientTransport constructor mock
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

      const config: MCPServerConfig = {
        command: 'test-server',
        args: ['--foo'],
        env: {
          CUSTOM_VAR: 'custom-value',
          PATH: '/custom/path', // Override parent PATH
        },
      };

      await client.connect('test', config);

      // Verify StdioClientTransport was called with merged env
      expect(StdioClientTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'test-server',
          args: ['--foo'],
          env: expect.objectContaining({
            // Should inherit parent env
            HOME: process.env.HOME,
            USER: process.env.USER,
            // Should include custom env
            CUSTOM_VAR: 'custom-value',
            // Should override parent env
            PATH: '/custom/path',
          }),
        })
      );
    });

    it('should handle servers without args', async () => {
      const config: MCPServerConfig = {
        command: 'node',
      };

      const connection = await client.connect('simple-server', config);

      expect(connection).toBeDefined();
      expect(connection.serverName).toBe('simple-server');
    });
  });

  describe('listTools', () => {
    it('should list tools from a connected server', async () => {
      const config: MCPServerConfig = {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      };

      const connection = await client.connect('filesystem', config);
      const tools = await client.listTools(connection);

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('test_tool');
      expect(tools[0].description).toBe('A test tool');
    });

    it('should handle empty tool list', async () => {
      const config: MCPServerConfig = {
        command: 'npx',
        args: [],
      };

      const connection = await client.connect('empty-server', config);

      // Override the mock for this specific test
      mockClientInstance.listTools = vi.fn().mockResolvedValue({ tools: [] });

      const tools = await client.listTools(connection);

      expect(tools).toEqual([]);
    });

    it('should handle missing tools field', async () => {
      const config: MCPServerConfig = {
        command: 'npx',
        args: [],
      };

      const connection = await client.connect('no-tools-server', config);

      // Override the mock for this specific test
      mockClientInstance.listTools = vi.fn().mockResolvedValue({});

      const tools = await client.listTools(connection);

      expect(tools).toEqual([]);
    });
  });

  describe('callTool', () => {
    it('should call a tool with arguments', async () => {
      const config: MCPServerConfig = {
        command: 'npx',
        args: [],
      };

      const connection = await client.connect('filesystem', config);
      const result = await client.callTool(connection, 'read_file', {
        path: '/tmp/test.txt',
      });

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Tool result' }],
      });
    });

    it('should handle tool calls without arguments', async () => {
      const config: MCPServerConfig = {
        command: 'npx',
        args: [],
      };

      const connection = await client.connect('server', config);
      const result = await client.callTool(connection, 'simple_tool');

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Tool result' }],
      });
    });

    it('should handle image content type', async () => {
      const config: MCPServerConfig = { command: 'npx', args: [] };
      const connection = await client.connect('server', config);

      // Override the mock for this specific test
      mockClientInstance.callTool = vi.fn().mockResolvedValue({
        content: [
          {
            type: 'image',
            data: 'base64-image-data',
            mimeType: 'image/png',
          },
        ],
      });

      const result = await client.callTool(connection, 'screenshot');

      expect(result).toEqual({
        content: [
          {
            type: 'image',
            data: 'base64-image-data',
            mimeType: 'image/png',
          },
        ],
      });
    });

    it('should handle resource content type', async () => {
      const config: MCPServerConfig = { command: 'npx', args: [] };
      const connection = await client.connect('server', config);

      // Override the mock for this specific test
      mockClientInstance.callTool = vi.fn().mockResolvedValue({
        content: [
          {
            type: 'resource',
            resource: {
              uri: 'file:///tmp/test.txt',
              mimeType: 'text/plain',
              text: 'Resource content',
            },
          },
        ],
      });

      const result = await client.callTool(connection, 'read_resource');

      expect(result).toEqual({
        content: [
          {
            type: 'resource',
            resource: {
              uri: 'file:///tmp/test.txt',
              mimeType: 'text/plain',
              text: 'Resource content',
            },
          },
        ],
      });
    });

    it('should handle empty content array', async () => {
      const config: MCPServerConfig = { command: 'npx', args: [] };
      const connection = await client.connect('server', config);

      // Override the mock for this specific test
      mockClientInstance.callTool = vi.fn().mockResolvedValue({
        content: [],
      });

      const result = await client.callTool(connection, 'empty_tool');

      expect(result).toEqual({ content: [] });
    });

    it('should handle raw response without content field', async () => {
      const config: MCPServerConfig = { command: 'npx', args: [] };
      const connection = await client.connect('server', config);

      // Override the mock for this specific test
      mockClientInstance.callTool = vi.fn().mockResolvedValue({
        result: 'raw result',
        status: 'success',
      });

      const result = await client.callTool(connection, 'raw_tool');

      expect(result).toEqual({
        result: 'raw result',
        status: 'success',
      });
    });
  });

  describe('disconnect', () => {
    it('should close client and transport', async () => {
      const config: MCPServerConfig = {
        command: 'npx',
        args: [],
      };

      const connection = await client.connect('server', config);
      await client.disconnect(connection);

      expect(connection.client.close).toHaveBeenCalled();
      expect(connection.transport.close).toHaveBeenCalled();
    });
  });

  describe('withConnection', () => {
    it('should execute function with temporary connection', async () => {
      const config: MCPServerConfig = {
        command: 'npx',
        args: [],
      };

      const result = await client.withConnection('server', config, async (conn) => {
        expect(conn.serverName).toBe('server');
        return 'test result';
      });

      expect(result).toBe('test result');
    });

    it('should disconnect even if function throws', async () => {
      const config: MCPServerConfig = {
        command: 'npx',
        args: [],
      };

      await expect(
        client.withConnection('server', config, async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      // The mock will show that close was called despite the error
      expect(mockClientInstance.close).toHaveBeenCalled();
    });

    it('should allow multiple operations in the callback', async () => {
      const config: MCPServerConfig = {
        command: 'npx',
        args: [],
      };

      const operations: string[] = [];

      await client.withConnection('server', config, async (conn) => {
        operations.push('list');
        await client.listTools(conn);

        operations.push('call');
        await client.callTool(conn, 'test_tool', { arg: 'value' });

        return operations;
      });

      expect(operations).toEqual(['list', 'call']);
    });
  });
});
