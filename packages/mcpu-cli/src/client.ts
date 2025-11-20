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
  stderrBuffer?: string[];  // Buffer for stderr output from stdio servers
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
        stderr: 'pipe',  // Capture stderr for buffering
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

    // Set up stderr buffering for stdio transport
    const stderrBuffer: string[] = [];
    if (transport instanceof StdioClientTransport) {
      const stderrStream = transport.stderr;
      if (stderrStream) {
        stderrStream.on('data', (chunk: Buffer) => {
          stderrBuffer.push(chunk.toString('utf8'));
        });
      }
    }

    return {
      client,
      transport,
      serverName,
      stderrBuffer,
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

    // Return raw response - let caller decide how to format
    return response;
  }

  /**
   * Get stderr output and optionally clear the buffer
   */
  getStderr(connection: MCPConnection, clear = false): string {
    if (!connection.stderrBuffer) {
      return '';
    }
    const output = connection.stderrBuffer.join('');
    if (clear) {
      connection.stderrBuffer.length = 0;
    }
    return output;
  }

  /**
   * Clear stderr buffer
   */
  clearStderr(connection: MCPConnection): void {
    if (connection.stderrBuffer) {
      connection.stderrBuffer.length = 0;
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