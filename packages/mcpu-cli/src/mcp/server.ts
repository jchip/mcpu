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
    const description = `MCPU CLI proxy for MCP servers.

argv: servers | tools [svr..] | info <svr> [tools..] | call <svr> <tool> | connect/disconnect <svr> | connections | config <svr>

params: tool args for call. --yaml/--json: full MCP response.`;

    this.server.tool(
      "cli",
      description,
      {
        argv: z.array(z.string()).describe("Command args"),
        params: z.union([z.record(z.any()), z.string()]).optional().describe("Tool params for call"),
        mcpServerConfig: z
          .object({
            extraArgs: z.array(z.string()).optional(),
          })
          .optional()
          .describe("Server extraArgs"),
        cwd: z.string().optional().describe("Working dir"),
      },
      async ({ argv, params, mcpServerConfig, cwd }) => {
        // Parse params if passed as JSON string
        let parsedParams = params;
        if (typeof params === "string") {
          try {
            parsedParams = JSON.parse(params);
          } catch {
            parsedParams = params; // Keep as-is if not valid JSON
          }
        }

        this.log("Executing command", { argv, params: parsedParams, mcpServerConfig, cwd });

        try {
          const result = await coreExecute({
            argv,
            params: parsedParams,
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
