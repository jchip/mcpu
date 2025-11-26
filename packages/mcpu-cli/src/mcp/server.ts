/**
 * MCPU MCP Server - Exposes MCPU functionality via MCP protocol
 *
 * This allows AI agents to discover and use MCP servers through MCPU
 * using the standard MCP protocol over stdio.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { coreExecute } from "../core/core.ts";
import { ConnectionPool } from "../daemon/connection-pool.ts";
import { ConfigDiscovery } from "../config.ts";
import { VERSION } from "../version.ts";
import type { MCPServerConfig } from "../types.ts";

export interface McpuMcpServerOptions {
  config?: string;
  verbose?: boolean;
  autoDisconnect?: boolean;
  idleTimeoutMs?: number;
}

export class McpuMcpServer {
  private server: McpServer;
  private pool: ConnectionPool;
  private configs: Map<string, MCPServerConfig>;
  private options: McpuMcpServerOptions;

  constructor(options: McpuMcpServerOptions = {}) {
    this.options = options;
    this.server = new McpServer({
      name: "mcpu-mcp",
      version: VERSION,
    });
    this.pool = new ConnectionPool({
      autoDisconnect: options.autoDisconnect,
      idleTimeoutMs: options.idleTimeoutMs,
    });
    this.configs = new Map();

    this.registerTools();
  }

  /**
   * Log to stderr (stdout is reserved for MCP protocol)
   */
  private log(message: string, data?: Record<string, any>): void {
    if (this.options.verbose) {
      const output = data ? `${message} ${JSON.stringify(data)}` : message;
      console.error(`[mcpu-mcp] ${output}`);
    }
  }

  /**
   * Register the mcpu_cli tool
   */
  private registerTools(): void {
    const description = `Execute MCPU CLI commands to interact with MCP servers.

Commands for argv:
- servers: List configured MCP servers
- tools [servers...]: List tools from servers
- info <server> [tools...]: Get detailed tool schema
- call <server> <tool>: Call a tool
- config <server>: Additional config for MCP server (extraArgs)

For call commands, pass tool parameters in the params field.

Response format:
- Default: Unwrapped text content extracted from MCP response
- '--yaml' in argv: Full MCP response structure with metadata.  '--json' also supported.  ie: ['--yaml', 'info', 'playwright', 'browser_navigate']`;

    this.server.tool(
      "mcpu_cli",
      description,
      {
        argv: z
          .array(z.string())
          .describe(
            'Command and arguments (e.g., ["servers"], ["tools", "playwright"], ["call", "playwright", "browser_navigate"])'
          ),
        params: z
          .record(z.any())
          .optional()
          .describe("Tool parameters for the call command"),
        mcpServerConfig: z
          .object({
            extraArgs: z.array(z.string()).optional(),
          })
          .optional()
          .describe("Additional CLI flags for starting stdio MCP servers"),
        cwd: z.string().optional().describe("Working directory"),
      },
      async ({ argv, params, mcpServerConfig, cwd }) => {
        this.log("Executing command", { argv, params, mcpServerConfig, cwd });

        try {
          const result = await coreExecute({
            argv,
            params,
            mcpServerConfig,
            cwd,
            connectionPool: this.pool,
            configs: this.configs,
          });

          this.log("Command result", {
            success: result.success,
            exitCode: result.exitCode,
          });

          return {
            content: [
              {
                type: "text" as const,
                text: result.output || result.error || "",
              },
            ],
            isError: !result.success,
          };
        } catch (error: any) {
          this.log("Command error", { error: error.message });
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error.message || String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    // Load configurations
    const discovery = new ConfigDiscovery({
      configFile: this.options.config,
      verbose: this.options.verbose,
    });
    this.configs = await discovery.loadConfigs();

    this.log("Loaded configs", { servers: Array.from(this.configs.keys()) });

    // Connect via stdio transport
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    this.log("MCP server started");
  }

  /**
   * Shutdown the server and cleanup connections
   */
  async shutdown(): Promise<void> {
    this.log("Shutting down");

    try {
      await this.pool.shutdown();
    } catch (error: any) {
      this.log("Error during pool shutdown", { error: error.message });
    }

    this.log("Shutdown complete");
  }
}
