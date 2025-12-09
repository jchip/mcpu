import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MCPClient } from '../src/client.js';

describe('HTTP Transport Integration', () => {
  let app: ReturnType<typeof express>;
  let httpServer: Server;
  let port: number;
  let mcpServer: McpServer;
  let transport: StreamableHTTPServerTransport;

  beforeAll(async () => {
    // Create MCP server with a test tool
    mcpServer = new McpServer({
      name: 'test-http-server',
      version: '1.0.0',
    });

    mcpServer.tool(
      'echo',
      'Echoes back the input message',
      {
        message: z.string().describe('Message to echo'),
      },
      async ({ message }) => ({
        content: [{ type: 'text', text: `Echo: ${message}` }],
      })
    );

    mcpServer.tool(
      'add',
      'Adds two numbers',
      {
        a: z.number().describe('First number'),
        b: z.number().describe('Second number'),
      },
      async ({ a, b }) => ({
        content: [{ type: 'text', text: String(a + b) }],
      })
    );

    // Create transport (stateless mode)
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await mcpServer.connect(transport);

    // Set up Express
    app = express();
    app.use(express.json());

    app.post('/mcp', async (req, res) => {
      try {
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
    });

    // Start server on random port
    httpServer = app.listen(0);
    port = (httpServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await mcpServer.close();
    httpServer.close();
  });

  it('should connect to HTTP MCP server and list tools', async () => {
    const client = new MCPClient();
    const connection = await client.connect('test-http', {
      url: `http://localhost:${port}/mcp`,
    });

    try {
      const tools = await client.listTools(connection);
      expect(tools.length).toBe(2);
      expect(tools.map(t => t.name).sort()).toEqual(['add', 'echo']);
    } finally {
      await client.disconnect(connection);
    }
  });

  it('should call tool via HTTP transport', async () => {
    const client = new MCPClient();
    const connection = await client.connect('test-http', {
      url: `http://localhost:${port}/mcp`,
    });

    try {
      const result = await client.callTool(connection, 'echo', { message: 'hello' });
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Echo: hello' }],
      });
    } finally {
      await client.disconnect(connection);
    }
  });

  it('should call tool with numeric args via HTTP', async () => {
    const client = new MCPClient();
    const connection = await client.connect('test-http', {
      url: `http://localhost:${port}/mcp`,
    });

    try {
      const result = await client.callTool(connection, 'add', { a: 5, b: 3 });
      expect(result).toEqual({
        content: [{ type: 'text', text: '8' }],
      });
    } finally {
      await client.disconnect(connection);
    }
  });
});
