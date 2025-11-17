/**
 * Result from executing a command
 */
export interface CommandResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode: number;
}

/**
 * Parsed command structure
 */
export interface ParsedCommand {
  command: string;
  args: string[];
  options: Record<string, any>;
}