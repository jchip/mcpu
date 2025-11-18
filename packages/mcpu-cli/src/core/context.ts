import { join, resolve, isAbsolute } from 'path';

/**
 * Execution context - encapsulates the runtime environment for a command execution
 * This ensures all path operations use the correct working directory, especially
 * important when daemon is running in a different directory than the client.
 */
export class ExecutionContext {
  /**
   * Client's working directory - all relative paths should be resolved against this
   */
  readonly cwd: string;

  /**
   * Verbose mode
   */
  readonly verbose: boolean;

  /**
   * JSON output mode
   */
  readonly json: boolean;

  /**
   * YAML output mode
   */
  readonly yaml: boolean;

  /**
   * Raw output mode (no processing/formatting)
   */
  readonly raw: boolean;

  /**
   * Explicit config file path
   */
  readonly configFile?: string;

  /**
   * Disable schema caching
   */
  readonly noCache: boolean;

  constructor(options: {
    cwd?: string;
    verbose?: boolean;
    json?: boolean;
    yaml?: boolean;
    raw?: boolean;
    configFile?: string;
    noCache?: boolean;
  } = {}) {
    this.cwd = options.cwd || process.cwd();
    this.verbose = options.verbose ?? false;
    this.json = options.json ?? false;
    this.yaml = options.yaml ?? false;
    this.raw = options.raw ?? false;
    this.configFile = options.configFile;
    this.noCache = options.noCache ?? false;
  }

  /**
   * Resolve a path relative to the client's working directory
   */
  resolvePath(path: string): string {
    if (isAbsolute(path)) {
      return path;
    }
    return resolve(this.cwd, path);
  }

  /**
   * Join paths relative to the client's working directory
   */
  joinPath(...paths: string[]): string {
    return join(this.cwd, ...paths);
  }

  /**
   * Log message if verbose mode is enabled
   */
  log(...args: any[]): void {
    if (this.verbose) {
      console.error(...args);
    }
  }
}
