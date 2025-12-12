/**
 * Integration test for McpuMcpServer HTTP transport
 * Tests that mcpu-mcp can serve over HTTP and clients can connect
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MCPClient } from '../../src/client.js';
import { McpuMcpServer } from '../../src/mcp/server.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('McpuMcpServer HTTP Transport', () => {
  let server: McpuMcpServer;
  let port: number;
  let testDir: string;
  let configPath: string;

  beforeAll(async () => {
    // Create temp config with a simple test server config
    testDir = join(tmpdir(), `mcpu-http-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    configPath = join(testDir, 'config.json');

    // Empty config - we just want to test the mcpu-mcp server itself
    await writeFile(configPath, JSON.stringify({}));

    // Use a random high port
    port = 49000 + Math.floor(Math.random() * 1000);

    server = new McpuMcpServer({
      config: configPath,
      transport: 'http',
      port,
    });

    await server.start();
    // Give server a moment to fully start
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    await server.shutdown();
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('should accept HTTP connections and list tools', async () => {
    const client = new MCPClient();
    const connection = await client.connect('mcpu-http', {
      url: `http://localhost:${port}/mcp`,
    });

    try {
      const tools = await client.listTools(connection);
      // mcpu-mcp exposes a single 'mux' tool
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('mux');
    } finally {
      await client.disconnect(connection);
    }
  });

  it('should handle cli tool calls via HTTP', async () => {
    const client = new MCPClient();
    const connection = await client.connect('mcpu-http', {
      url: `http://localhost:${port}/mcp`,
    });

    try {
      // Call the mux tool with 'servers' command
      const result = await client.callTool(connection, 'mux', {
        argv: ['servers'],
      }) as { content: Array<{ type: string; text: string }> };

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      // Should return something (even if no servers configured)
      expect(typeof result.content[0].text).toBe('string');
    } finally {
      await client.disconnect(connection);
    }
  });
});
