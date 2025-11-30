import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { jsonSchemaValidator, JsonSchemaType } from '@modelcontextprotocol/sdk/validation/index.js';
import type { MCPServerConfig, StdioConfig } from './types.ts';
import { isStdioConfig, DEFAULT_REQUEST_TIMEOUT_MS } from './types.ts';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

/**
 * Recursively remove additionalProperties: false from a JSON schema
 * This relaxes output validation to allow servers to return extra fields
 */
export function relaxSchema(schema: Record<string, unknown> | undefined): void {
  if (!schema || typeof schema !== 'object') return;

  // Remove additionalProperties: false (but leave additionalProperties: true or other values)
  if (schema.additionalProperties === false) {
    delete schema.additionalProperties;
  }

  // Recurse into nested schemas
  if (schema.properties && typeof schema.properties === 'object') {
    for (const prop of Object.values(schema.properties as Record<string, unknown>)) {
      relaxSchema(prop as Record<string, unknown>);
    }
  }
  if (schema.items && typeof schema.items === 'object') {
    relaxSchema(schema.items as Record<string, unknown>);
  }
  if (schema.allOf && Array.isArray(schema.allOf)) {
    schema.allOf.forEach((s: unknown) => relaxSchema(s as Record<string, unknown>));
  }
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    schema.anyOf.forEach((s: unknown) => relaxSchema(s as Record<string, unknown>));
  }
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    schema.oneOf.forEach((s: unknown) => relaxSchema(s as Record<string, unknown>));
  }
}

/**
 * JSON Schema validator that relaxes additionalProperties constraints
 * Wraps AjvJsonSchemaValidator but strips additionalProperties: false before compiling
 */
export class RelaxedAjvJsonSchemaValidator implements jsonSchemaValidator {
  private inner = new AjvJsonSchemaValidator();

  getValidator<T>(schema: JsonSchemaType) {
    const relaxed = structuredClone(schema) as Record<string, unknown>;
    relaxSchema(relaxed);
    return this.inner.getValidator<T>(relaxed as JsonSchemaType);
  }
}

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
      if (!isStdioConfig(config)) {
        throw new Error('Invalid stdio config: missing command');
      }
      // Merge args and extraArgs
      const mergedArgs = [
        ...(config.args || []),
        ...(config.extraArgs || []),
      ];
      transport = new StdioClientTransport({
        command: config.command,
        args: mergedArgs.length > 0 ? mergedArgs : undefined,
        env: config.env,
        stderr: 'pipe',  // Capture stderr for buffering
      });
    }

    const client = new Client({
      name: `mcpu-${serverName}`,
      version: '0.1.0',
    }, {
      capabilities: {},
      jsonSchemaValidator: new RelaxedAjvJsonSchemaValidator(),
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
   * @param timeout Request timeout in ms (default: 180000 = 3 min)
   */
  async callTool(
    connection: MCPConnection,
    toolName: string,
    args?: Record<string, unknown>,
    timeout: number = DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<unknown> {
    const response = await connection.client.callTool(
      { name: toolName, arguments: args },
      undefined, // use default resultSchema
      { timeout }
    );

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