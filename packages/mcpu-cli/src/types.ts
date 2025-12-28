import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Default request timeout: 3 minutes (in milliseconds)
export const DEFAULT_REQUEST_TIMEOUT_MS = 180000;

// Args passthrough config for injecting context values
const ArgsPassThruSchema = z.record(
  z.object({
    path: z.string(), // Dot-notation path to inject value (e.g., "cwd" or "params.workingDir")
    value: z.enum(['$cwd', '$projectDir']), // Variable to inject
  })
);

// Context keywords for auto-detection
const ContextKeywordsSchema = z.object({
  cwd: z.array(z.string()).optional(),
  projectDir: z.array(z.string()).optional(),
});

// Common config fields shared by all transport types
const CommonConfigSchema = z.object({
  enabled: z.boolean().optional(), // Set to false to disable server without removing config
  cacheTTL: z.number().optional(), // Cache TTL in minutes (default: 60)
  requestTimeout: z.number().optional(), // Request timeout in ms (default: 180000 = 3 min)
  usage: z.enum(['tools', 'info', 'infoc']).optional(), // Default command for 'usage' (default: 'tools')
  argsPassThru: ArgsPassThruSchema.optional(), // Inject context values into tool args
  autoDetectContext: z.boolean().optional(), // Enable auto-detection of context params (default: true)
  contextKeywords: ContextKeywordsSchema.optional(), // Custom keywords for auto-detection
});

// MCP Server Configuration Schema (stdio)
const StdioConfigSchema = CommonConfigSchema.extend({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  extraArgs: z.array(z.string()).optional(), // Runtime-added args via config command
});

// MCP Server Configuration Schema (HTTP)
// type is optional - defaults to 'http' if url is present without type
const HttpConfigSchema = CommonConfigSchema.extend({
  type: z.literal('http').optional(),
  url: z.string(),
  headers: z.record(z.string()).optional(),
});

// MCP Server Configuration Schema (WebSocket)
const WebSocketConfigSchema = CommonConfigSchema.extend({
  type: z.literal('websocket'),
  url: z.string(),
});

// Union of transport types
// Order matters: WebSocket first (requires type: 'websocket'), then HTTP (type optional), then Stdio
export const MCPServerConfigSchema = z.union([
  WebSocketConfigSchema,
  HttpConfigSchema,
  StdioConfigSchema,
]);

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

// Export argsPassThru and context types
export type ArgsPassThruConfig = z.infer<typeof ArgsPassThruSchema>;
export type ContextKeywords = z.infer<typeof ContextKeywordsSchema>;

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
  // HTTP config has url and either no type or type === 'http'
  return 'url' in config && (!('type' in config) || config.type === 'http');
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

// Config for collapsing optional args in tool summaries
// By default, optionals are never collapsed. Set this to enable collapsing.
export const CollapseOptionalsConfigSchema = z.object({
  minOptionals: z.number().optional(), // Collapse when optionals >= this count
  minTools: z.number().optional(),     // Only collapse if server has >= this many tools
});
export type CollapseOptionalsConfig = z.infer<typeof CollapseOptionalsConfigSchema>;

// Global config schema
export const GlobalConfigSchema = z.object({
  autoSaveResponse: AutoSaveConfigBaseSchema.optional(),
  execEnabled: z.boolean().optional(), // Enable/disable exec command (default: true)
  collapseOptionals: CollapseOptionalsConfigSchema.optional(), // Config for collapsing optional args
  autoDetectContext: z.boolean().optional(), // Global default for auto-detection (default: true)
  contextKeywords: ContextKeywordsSchema.optional(), // Global default keywords for auto-detection
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