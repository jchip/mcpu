import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Default request timeout: 3 minutes (in milliseconds)
export const DEFAULT_REQUEST_TIMEOUT_MS = 180000;

// Common config fields shared by all transport types
const CommonConfigSchema = z.object({
  enabled: z.boolean().optional(), // Set to false to disable server without removing config
  cacheTTL: z.number().optional(), // Cache TTL in minutes (default: 60)
  requestTimeout: z.number().optional(), // Request timeout in ms (default: 180000 = 3 min)
});

// MCP Server Configuration Schema (stdio)
const StdioConfigSchema = CommonConfigSchema.extend({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  extraArgs: z.array(z.string()).optional(), // Runtime-added args via config command
});

// MCP Server Configuration Schema (HTTP)
const HttpConfigSchema = CommonConfigSchema.extend({
  type: z.literal('http'),
  url: z.string(),
  headers: z.record(z.string()).optional(),
});

// MCP Server Configuration Schema (WebSocket)
const WebSocketConfigSchema = CommonConfigSchema.extend({
  type: z.literal('websocket'),
  url: z.string(),
});

// Union of transport types
export const MCPServerConfigSchema = z.union([
  StdioConfigSchema,
  HttpConfigSchema,
  WebSocketConfigSchema,
]);

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

// Type for stdio config
export type StdioConfig = z.infer<typeof StdioConfigSchema>;

// Type for HTTP config
export type HttpConfig = z.infer<typeof HttpConfigSchema>;

// Type for WebSocket config
export type WebSocketConfig = z.infer<typeof WebSocketConfigSchema>;

// Type guards for MCPServerConfig
export function isStdioConfig(config: MCPServerConfig): config is StdioConfig {
  return 'command' in config;
}

export function isHttpConfig(config: MCPServerConfig): config is HttpConfig {
  return 'type' in config && config.type === 'http';
}

export function isWebSocketConfig(config: MCPServerConfig): config is WebSocketConfig {
  return 'type' in config && config.type === 'websocket';
}

export function isUrlConfig(config: MCPServerConfig): config is HttpConfig | WebSocketConfig {
  return 'url' in config;
}

// Claude settings.json schema
export const ClaudeSettingsSchema = z.object({
  mcpServers: z.record(MCPServerConfigSchema).optional(),
}).passthrough(); // Allow other settings

export type ClaudeSettings = z.infer<typeof ClaudeSettingsSchema>;

// Auto-save response config - consistent shape at all levels
// All fields optional, inherit from parent level if not specified
const AutoSaveConfigBaseSchema = z.object({
  enabled: z.boolean().optional(),
  thresholdSize: z.number().optional(),
  dir: z.string().optional(),
  previewSize: z.number().optional(),
});

// Tool-level config (no byTools nesting)
export const ToolAutoSaveConfigSchema = AutoSaveConfigBaseSchema;
export type ToolAutoSaveConfig = z.infer<typeof ToolAutoSaveConfigSchema>;

// Server-level config (adds byTools for per-tool overrides)
export const ServerAutoSaveConfigSchema = AutoSaveConfigBaseSchema.extend({
  byTools: z.record(ToolAutoSaveConfigSchema).optional(),
});
export type ServerAutoSaveConfig = z.infer<typeof ServerAutoSaveConfigSchema>;

// Global config schema
export const GlobalConfigSchema = z.object({
  autoSaveResponse: AutoSaveConfigBaseSchema.optional(),
}).passthrough(); // Allow server configs at top level

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

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
  stderr?: string;  // Stderr output from stdio-based MCP servers
}