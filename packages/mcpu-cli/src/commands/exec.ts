/**
 * Exec command - execute user code in an isolated worker process
 *
 * This enables programmatic tool calling where Claude writes code that
 * orchestrates multiple MCP tools, processes outputs, and controls what
 * information reaches its context window.
 *
 * Architecture:
 * - Main process forks a worker child process
 * - Worker executes user code with injected `mcpuMux` function
 * - mcpuMux calls are sent back to main via IPC
 * - Main process executes the actual mux calls (has MCP connections)
 * - Results sent back to worker via IPC
 * - Final result returned when worker completes
 */

import { fork, type ChildProcess } from 'child_process';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { coreExecute, type CoreExecutionOptions } from '../core/core.ts';
import type { CommandResult } from '../types/result.ts';

// Get the directory of this module for locating worker
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Find the worker script path
 * Bun: use .ts source (handles TypeScript natively)
 * Node: use built .js (tsx is devDependency only)
 */
function getWorkerPath(): string {
  const isBun = !!process.versions.bun;

  if (isBun) {
    // Bun handles TypeScript natively - use source
    const srcWorker = resolve(__dirname, '../exec/worker.ts');
    if (existsSync(srcWorker)) {
      return srcWorker;
    }
  }

  // Node.js - use built worker
  // From dist/commands/exec.js -> ../exec/worker.js
  const fromDist = resolve(__dirname, '../exec/worker.js');
  if (existsSync(fromDist)) {
    return fromDist;
  }

  // From src/commands/exec.ts -> ../../dist/exec/worker.js
  const fromSrc = resolve(__dirname, '../../dist/exec/worker.js');
  if (existsSync(fromSrc)) {
    return fromSrc;
  }

  throw new Error('Worker not found - run build first');
}

const WORKER_PATH = getWorkerPath();

/** Parameters for exec command */
export interface ExecParams {
  /** Path to JS file to execute */
  file?: string;
  /** Inline JS code to execute */
  code?: string;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/** IPC message types */
interface MuxRequest {
  id: number;
  argv: string[];
  params?: Record<string, unknown>;
  batch?: Record<string, { argv: string[]; params?: Record<string, unknown> }>;
}

interface MuxResponse {
  id: number;
  result?: unknown;
  error?: string;
}

interface ExecMessage {
  type: 'exec';
  code: string;
  cwd?: string;
}

interface DoneMessage {
  type: 'done';
  value?: unknown;
  error?: string;
}

/**
 * Execute user code in an isolated worker process
 */
export async function executeExec(
  params: ExecParams,
  options: CoreExecutionOptions
): Promise<CommandResult> {
  const { file, code, timeout = 30000 } = params;

  // Validate: need either file or code
  if (!file && !code) {
    return {
      success: false,
      error: 'exec requires either file or code parameter',
      exitCode: 1,
    };
  }

  if (file && code) {
    return {
      success: false,
      error: 'exec accepts either file or code, not both',
      exitCode: 1,
    };
  }

  // Get the code to execute
  let userCode: string;
  try {
    if (file) {
      const filePath = resolve(options.cwd || process.cwd(), file);
      userCode = await readFile(filePath, 'utf-8');
    } else {
      userCode = code!;
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to read file: ${error}`,
      exitCode: 1,
    };
  }

  // Fork worker process
  let worker: ChildProcess;
  try {
    const workerPath = getWorkerPath();

    // No execArgv needed:
    // - Bun handles TypeScript natively
    // - Node uses built .js worker
    const execArgv: string[] = [];

    // Remove NODE_OPTIONS to prevent tsx preload inheritance when running .js worker
    const workerEnv = { ...process.env };
    delete workerEnv.NODE_OPTIONS;

    worker = fork(workerPath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      execArgv,
      env: workerEnv,
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to fork worker: ${error}`,
      exitCode: 1,
    };
  }

  // Collect stderr from worker
  let stderrOutput = '';
  worker.stderr?.on('data', (data: Buffer) => {
    stderrOutput += data.toString();
  });

  return new Promise<CommandResult>((resolvePromise) => {
    let resolved = false;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const finish = (result: CommandResult) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolvePromise(result);
    };

    // Handle mux calls from worker
    worker.on('message', async (msg: MuxRequest | DoneMessage) => {
      if ('type' in msg && msg.type === 'done') {
        // Worker finished executing
        if (msg.error) {
          finish({
            success: false,
            error: msg.error,
            exitCode: 1,
          });
        } else {
          // Format output - if it's an object, JSON stringify it
          let output: string;
          if (msg.value === undefined || msg.value === null) {
            output = '';
          } else if (typeof msg.value === 'string') {
            output = msg.value;
          } else {
            output = JSON.stringify(msg.value);
          }

          finish({
            success: true,
            output,
            exitCode: 0,
          });
        }
      } else if ('id' in msg) {
        // Mux call from worker - execute it
        try {
          const result = await coreExecute({
            ...options,
            argv: msg.argv,
            params: msg.params,
            batch: msg.batch,
          });

          // Use raw result if available (from call commands), otherwise parse output
          let parsedOutput: unknown;
          if (result.meta?.rawResult) {
            // Call command returned raw MCP result - unwrap content for user code
            const mcpResult = result.meta.rawResult.result as any;

            // Unwrap MCP response: extract text content and parse as JSON if possible
            if (mcpResult?.content && Array.isArray(mcpResult.content)) {
              const textContent = mcpResult.content
                .filter((item: any) => item.type === 'text' && item.text)
                .map((item: any) => item.text)
                .join('\n');

              // Try to parse as JSON for structured data
              try {
                parsedOutput = JSON.parse(textContent);
              } catch {
                parsedOutput = textContent || mcpResult;
              }
            } else {
              // Non-standard response, use as-is
              parsedOutput = mcpResult;
            }
          } else if (typeof result.output === 'string') {
            // Other commands return formatted output - try to parse as JSON
            try {
              parsedOutput = JSON.parse(result.output);
            } catch {
              // Keep as string if not valid JSON
              parsedOutput = result.output;
            }
          } else {
            parsedOutput = result.output;
          }

          const response: MuxResponse = {
            id: msg.id,
            result: result.success ? parsedOutput : undefined,
            error: result.success ? undefined : result.error,
          };
          worker.send(response);
        } catch (err: unknown) {
          const error = err instanceof Error ? err.message : String(err);
          const response: MuxResponse = {
            id: msg.id,
            error,
          };
          worker.send(response);
        }
      }
    });

    // Handle worker exit
    worker.on('exit', (exitCode) => {
      if (!resolved) {
        const errorMsg = stderrOutput
          ? `Worker exited with code ${exitCode}: ${stderrOutput}`
          : `Worker exited with code ${exitCode}`;
        finish({
          success: false,
          error: errorMsg,
          exitCode: exitCode || 1,
        });
      }
    });

    // Handle worker errors
    worker.on('error', (err) => {
      finish({
        success: false,
        error: `Worker error: ${err.message}`,
        exitCode: 1,
      });
    });

    // Set timeout
    timer = setTimeout(() => {
      worker.kill('SIGKILL');
      finish({
        success: false,
        error: `Execution timed out after ${timeout}ms`,
        exitCode: 124, // Standard timeout exit code
      });
    }, timeout);

    // Send code to worker
    const execMsg: ExecMessage = {
      type: 'exec',
      code: userCode,
      cwd: options.cwd,
    };
    worker.send(execMsg);
  });
}
