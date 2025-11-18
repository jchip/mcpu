import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MCPServerConfig } from './types.ts';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export interface MCPConnection {
  client: Client;
  transport: Transport;
  serverName: string;
}

/**
 * Manages ephemeral connections to MCP servers
 */
export class MCPClient {
  /**
   * Connect to an MCP server and get its tools
   */
  async connect(
    serverName: string,
    config: MCPServerConfig
  ): Promise<MCPConnection> {
    let transport: Transport;

    // Determine transport type based on config
    if ('url' in config) {
      const url = new URL(config.url);

      if (config.type === 'websocket' || url.protocol === 'ws:' || url.protocol === 'wss:') {
        // WebSocket transport
        transport = new WebSocketClientTransport(url);
      } else {
        // HTTP/SSE transport
        transport = new StreamableHTTPClientTransport(url, {
          requestInit: 'headers' in config && config.headers ? {
            headers: config.headers,
          } : undefined,
        });
      }
    } else {
      // stdio transport
      if (!('command' in config)) {
        throw new Error('Invalid stdio config: missing command');
      }
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
      });
    }

    const client = new Client({
      name: `mcpu-${serverName}`,
      version: '0.1.0',
    }, {
      capabilities: {}
    });

    // Connect
    await client.connect(transport);

    return {
      client,
      transport,
      serverName,
    };
  }

  /**
   * List available tools from a server
   */
  async listTools(connection: MCPConnection): Promise<Tool[]> {
    const response = await connection.client.listTools();
    return response.tools || [];
  }

  /**
   * Call a tool on a server
   */
  async callTool(
    connection: MCPConnection,
    toolName: string,
    args?: Record<string, unknown>
  ): Promise<unknown> {
    const response = await connection.client.callTool({
      name: toolName,
      arguments: args,
    });

    // Handle different response formats
    if ('content' in response) {
      // If it has content array (standard format)
      const content = response.content;
      if (Array.isArray(content) && content.length > 0) {
        // Return the first content item
        const item = content[0];
        if (item.type === 'text') {
          return item.text;
        } else if (item.type === 'image') {
          return {
            type: 'image',
            data: item.data,
            mimeType: item.mimeType,
          };
        } else if (item.type === 'resource') {
          return {
            type: 'resource',
            uri: item.resource?.uri,
            mimeType: item.resource?.mimeType,
            text: item.resource?.text,
          };
        }
      }
      return content;
    } else {
      // Raw response
      return response;
    }
  }

  /**
   * Disconnect from a server
   */
  async disconnect(connection: MCPConnection): Promise<void> {
    await connection.client.close();
    await connection.transport.close();
  }

  /**
   * Execute a function with a temporary connection
   */
  async withConnection<T>(
    serverName: string,
    config: MCPServerConfig,
    fn: (connection: MCPConnection) => Promise<T>
  ): Promise<T> {
    const connection = await this.connect(serverName, config);
    try {
      return await fn(connection);
    } finally {
      await this.disconnect(connection);
    }
  }
}