import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// MCP Server Configuration Schema (stdio)
const StdioConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

// MCP Server Configuration Schema (HTTP)
const HttpConfigSchema = z.object({
  type: z.literal('http'),
  url: z.string(),
  headers: z.record(z.string()).optional(),
});

// Union of transport types
export const MCPServerConfigSchema = z.union([
  StdioConfigSchema,
  HttpConfigSchema,
]);

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

// Claude settings.json schema
export const ClaudeSettingsSchema = z.object({
  mcpServers: z.record(MCPServerConfigSchema).optional(),
}).passthrough(); // Allow other settings

export type ClaudeSettings = z.infer<typeof ClaudeSettingsSchema>;

// Project .mcp.json schema
export const ProjectMCPConfigSchema = z.record(MCPServerConfigSchema);

export type ProjectMCPConfig = z.infer<typeof ProjectMCPConfigSchema>;

// Tool Summary (compressed format for listing)
export interface ToolSummary {
  name: string;
  description?: string;
  // Intentionally minimal - no parameters
}

// Server Summary
export interface ServerSummary {
  name: string;
  tools: ToolSummary[];
  resourceCount?: number;
  promptCount?: number;
}

// Full tool schema (for detailed view)
export interface ToolSchema {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

// Cache entry
export interface CacheEntry {
  server: string;
  tools: Tool[];
  timestamp: number;
  version: string;
}

// CLI output formats
export interface ListOutput {
  servers: ServerSummary[];
  totalTools: number;
  estimatedTokens: number;
}

export interface ShowOutput {
  server: string;
  tool: ToolSchema;
}

export interface CallOutput {
  result: unknown;
  error?: string;
}