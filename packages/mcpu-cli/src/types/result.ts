/**
 * Metadata about command execution
 */
export interface CommandMeta {
  /** Whether tools schema was loaded from cache */
  fromCache?: boolean;
  /** Servers that were loaded from cache */
  cachedServers?: string[];
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