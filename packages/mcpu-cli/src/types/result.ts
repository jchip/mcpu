/**
 * Raw result from a call command - returned in meta for caller to format
 */
export interface CallRawResult {
  /** Server name */
  server: string;
  /** Tool name */
  tool: string;
  /** Raw MCP response (unformatted) */
  result: unknown;
}

/**
 * Metadata about command execution
 */
export interface CommandMeta {
  /** Whether tools schema was loaded from cache */
  fromCache?: boolean;
  /** Servers that were loaded from cache */
  cachedServers?: string[];
  /** Raw result from call command - caller handles formatting */
  rawResult?: CallRawResult;
}

/**
 * Result from executing a command
 */
export interface CommandResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode: number;
  meta?: CommandMeta;
}

/**
 * Parsed command structure
 */
export interface ParsedCommand {
  command: string;
  args: string[];
  options: Record<string, any>;
}