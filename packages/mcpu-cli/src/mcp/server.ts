/**
 * MCPU MCP Server - Exposes MCPU functionality via MCP protocol
 *
 * This allows AI agents to discover and use MCP servers through MCPU
 * using the standard MCP protocol over stdio.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import type { Server as HttpServer } from "node:http";
import { z } from "zod";
import { coreExecute } from "../core/core.ts";
import { ConnectionPool } from "../daemon/connection-pool.ts";
import { ConfigDiscovery } from "../config.ts";
import { VERSION } from "../version.ts";
import type { MCPServerConfig } from "../types.ts";
import type { CommandResult } from "../types/result.ts";
import { formatMcpResponse, autoSaveResponse } from "../formatters.ts";
import { getErrorMessage } from "../utils/error.ts";

export type TransportType = "stdio" | "http";

export interface McpuMcpServerOptions {
  config?: string;
  verbose?: boolean;
  autoDisconnect?: boolean;
  idleTimeoutMs?: number;
  transport?: TransportType;
  port?: number;
  endpoint?: string;
}

export class McpuMcpServer {
  private server: McpServer;
  private pool: ConnectionPool;
  private configs: Map<string, MCPServerConfig>;
  private configDiscovery: ConfigDiscovery | undefined;
  private options: McpuMcpServerOptions;
  private httpServer?: HttpServer;
  private httpTransport?: StreamableHTTPServerTransport;

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
   * Format raw result from call commands
   * If result contains rawResult in meta, format it according to auto-save config
   */
  private async formatRawResult(
    result: CommandResult,
    cwd?: string
  ): Promise<CommandResult> {
    // Only format if there's a rawResult from a call command
    if (!result.meta?.rawResult || !this.configDiscovery) {
      return result;
    }

    const { server, tool, result: mcpResult } = result.meta.rawResult;
    const workingDir = cwd || process.cwd();

    // Get auto-save config for this server/tool
    const autoSaveConfig = this.configDiscovery.getAutoSaveConfig(server, tool);

    let output: string;
    if (autoSaveConfig.enabled) {
      const autoSaveResult = await autoSaveResponse(
        mcpResult,
        server,
        tool,
        autoSaveConfig,
        workingDir
      );
      output = autoSaveResult.output;
    } else {
      output = formatMcpResponse(mcpResult);
    }

    // Return formatted result (remove rawResult from meta since it's been processed)
    const { rawResult, ...restMeta } = result.meta;
    return {
      ...result,
      output,
      meta: Object.keys(restMeta).length > 0 ? restMeta : undefined,
    };
  }

  /**
   * Register the mux tool
   */
  private registerTools(): void {
    // Tool description with examples for clarity
    const toolDescription = `Route commands to MCP servers.

Commands: argv=[cmd, ...args], params={}
- List servers: ["servers", "optional pattern"]
- Call tool: ["call","server","tool"], {arg1:"...", ...}
- Get summary of tools: ["tools","server"]
- Get full tool info: ["info","server","optional tool"]
- connect/disconnect: ["connect","server"] (commands auto connect)
- Set server config: ["setConfig","server"], {extraArgs?:["--flag"], env?:{}, requestTimeout?:ms}
- Batch Commands: ["batch"], {timeout?:ms, resp_mode?:auto|full|summary|refs}, batch={id: {argv, params, ...}}
- exec JS Code: ["exec"], {file?:string, code?:string, timeout?:ms}
  - API: mcpuMux({argv,params,...}):Promise<any>
- List connections: ["connections"]
- Reload: ["reload"]
`;

    this.server.tool(
      "mux",
      toolDescription,
      {
        argv: z.array(z.string()),
        params: z.record(z.any()).optional(),
        batch: z.record(z.any()).optional(),
        cwd: z.string().optional(),
      },
      async ({ argv, params, batch, cwd }) => {
        this.log("Executing command", { argv, params, batch, cwd });

        try {
          const rawResult = await coreExecute({
            argv,
            params,
            batch: batch as
              | Record<
                  string,
                  { argv: string[]; params?: Record<string, unknown> }
                >
              | undefined,
            cwd,
            connectionPool: this.pool,
            configs: this.configs,
            configDiscovery: this.configDiscovery,
          });

          // Format raw result from call commands
          const result = await this.formatRawResult(rawResult, cwd);

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
        } catch (error) {
          this.log("Command error", { error: getErrorMessage(error) });
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
    this.configDiscovery = discovery;

    this.log("Loaded configs", { servers: Array.from(this.configs.keys()) });

    const transportType = this.options.transport || "stdio";

    if (transportType === "http") {
      await this.startHttpServer();
    } else {
      // Connect via stdio transport
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      this.log("MCP server started (stdio)");
    }
  }

  /**
   * Start HTTP server with StreamableHTTPServerTransport
   */
  private async startHttpServer(): Promise<void> {
    const port = this.options.port || 3000;
    const endpoint = this.options.endpoint || "/mcp";

    // Create transport (stateless mode for simplicity)
    this.httpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await this.server.connect(this.httpTransport);

    // Set up Express
    const app = express();
    app.use(express.json());

    app.post(endpoint, async (req, res) => {
      try {
        await this.httpTransport!.handleRequest(req, res, req.body);
      } catch (error) {
        this.log("HTTP request error", { error: getErrorMessage(error) });
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    });

    // Method not allowed for GET/DELETE
    app.get(endpoint, (_req, res) => {
      res.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed" },
        id: null,
      });
    });

    app.delete(endpoint, (_req, res) => {
      res.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed" },
        id: null,
      });
    });

    // Start server
    this.httpServer = app.listen(port, () => {
      this.log(`MCP server started (http://localhost:${port}${endpoint})`);
      // Also log to stderr so user can see the URL
      console.error(
        `[mcpu-mcp] Listening on http://localhost:${port}${endpoint}`
      );
    });
  }

  /**
   * Shutdown the server and cleanup connections
   */
  async shutdown(): Promise<void> {
    this.log("Shutting down");

    // Close HTTP server if running
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.log("HTTP server closed");
    }

    try {
      await this.pool.shutdown();
    } catch (error) {
      this.log("Error during pool shutdown", { error: getErrorMessage(error) });
    }

    this.log("Shutdown complete");
  }
}
