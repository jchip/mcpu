/**
 * Batch command execution - execute multiple tool calls in a single request
 *
 * Execution model:
 * - Per-server serial: calls to the same MCP server run serially
 * - Cross-server parallel: different servers run in parallel
 *
 * This reduces round-trips between LLM and mcpu while respecting
 * server concurrency constraints.
 */

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { coreExecute, type CoreExecutionOptions } from './core.ts';
import type { CommandResult } from '../types/result.ts';
import { getErrorMessage } from '../utils/error.ts';

// ============================================================================
// Types
// ============================================================================

/** A single call within a batch */
export interface BatchCall {
  /** Command argv (e.g., ["call", "server", "tool"]) */
  argv: string[];
  /** Tool parameters */
  params?: Record<string, unknown>;
}

/** Response mode for batch results */
export type ResponseMode = 'auto' | 'full' | 'summary' | 'refs';

/** Input parameters for batch command */
export interface BatchParams {
  /** Keyed map of calls - keys are used for result correlation */
  calls: Record<string, BatchCall>;
  /** How to format the response (default: 'auto') */
  response_mode?: ResponseMode;
  /** Overall timeout in milliseconds (default: 300000 = 5 min) */
  timeout?: number;
}

/** Result of a single call within a batch */
export interface BatchCallResult {
  /** Whether the call succeeded */
  success: boolean;
  /** Output from the call (if successful) */
  output?: unknown;
  /** Error message (if failed) */
  error?: string;
  /** Path to file containing full result */
  file?: string;
  /** True if output was truncated and saved to file */
  truncated?: boolean;
}

/** Summary statistics for batch execution */
export interface BatchSummary {
  /** Total number of calls */
  total: number;
  /** Number of successful calls */
  succeeded: number;
  /** Number of failed calls */
  failed: number;
  /** Number of calls that timed out */
  timedOut?: number;
}

/** Complete batch result */
export interface BatchResult {
  /** Keyed results matching input call keys */
  results: Record<string, BatchCallResult>;
  /** Order in which calls completed */
  order: string[];
  /** Summary statistics */
  summary: BatchSummary;
  /** True if batch timeout was hit */
  timedOut?: boolean;
  /** List of files containing large outputs */
  saved_files?: string[];
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of calls allowed in a single batch */
export const MAX_BATCH_SIZE = 100;

/** Maximum number of concurrent servers */
export const MAX_CONCURRENT_SERVERS = 20;

/** Default overall timeout (5 minutes) */
export const DEFAULT_BATCH_TIMEOUT = 300000;

/** Maximum total response size before auto-switching to refs mode (1MB) */
export const MAX_RESPONSE_SIZE = 1024 * 1024;

/** Commands allowed in batch calls */
const ALLOWED_COMMANDS = new Set(['call', 'servers', 'tools', 'info']);

/** Commands explicitly rejected (mutations and nested batches) */
const REJECTED_COMMANDS = new Set(['connect', 'disconnect', 'reconnect', 'reload', 'setConfig', 'batch']);

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  callId: string;
  message: string;
}

/**
 * Extract the command name from argv
 */
function getCommandName(argv: string[]): string | null {
  for (const arg of argv) {
    if (!arg.startsWith('-')) {
      return arg;
    }
  }
  return null;
}

/**
 * Extract the server name from a call argv
 * For 'call' command: argv[1] is server, argv[2] is tool
 * For 'tools': argv[1...] are optional server names
 * For 'info': argv[1] is server
 * For 'servers': no server specified
 */
export function extractServerFromCall(call: BatchCall): string | null {
  const cmd = getCommandName(call.argv);
  if (!cmd) return null;

  switch (cmd) {
    case 'call':
    case 'info':
      // call <server> <tool> [args...]
      // info <server> [tools...]
      return call.argv[1] || null;
    case 'tools':
      // tools [servers...]
      // For grouping purposes, tools without specific servers goes to '__global__'
      return call.argv[1] || '__global__';
    case 'servers':
      // servers has no server context
      return '__global__';
    default:
      return null;
  }
}

/**
 * Validate a single batch call
 */
function validateCall(id: string, call: BatchCall): ValidationError | null {
  // Check argv exists and is array
  if (!call.argv || !Array.isArray(call.argv)) {
    return { callId: id, message: 'Missing or invalid argv array' };
  }

  if (call.argv.length === 0) {
    return { callId: id, message: 'Empty argv array' };
  }

  // Get command name
  const cmd = getCommandName(call.argv);
  if (!cmd) {
    return { callId: id, message: 'No command found in argv' };
  }

  // Check for rejected commands
  if (REJECTED_COMMANDS.has(cmd)) {
    return { callId: id, message: `Command '${cmd}' not allowed in batch (mutation or nested batch)` };
  }

  // Check for allowed commands
  if (!ALLOWED_COMMANDS.has(cmd)) {
    return { callId: id, message: `Command '${cmd}' not supported in batch. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}` };
  }

  // Validate 'call' command has required args
  if (cmd === 'call') {
    if (call.argv.length < 3) {
      return { callId: id, message: 'call command requires server and tool arguments' };
    }
  }

  // Validate 'info' command has required args
  if (cmd === 'info') {
    if (call.argv.length < 2) {
      return { callId: id, message: 'info command requires server argument' };
    }
  }

  return null;
}

/**
 * Validate entire batch params
 * Returns array of validation errors (empty if valid)
 */
export function validateBatchParams(params: BatchParams): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check calls exists
  if (!params.calls || typeof params.calls !== 'object') {
    errors.push({ callId: '__batch__', message: 'Missing or invalid calls object' });
    return errors;
  }

  const callIds = Object.keys(params.calls);

  // Check batch size
  if (callIds.length === 0) {
    errors.push({ callId: '__batch__', message: 'Batch contains no calls' });
    return errors;
  }

  if (callIds.length > MAX_BATCH_SIZE) {
    errors.push({
      callId: '__batch__',
      message: `Batch size ${callIds.length} exceeds limit of ${MAX_BATCH_SIZE}`,
    });
    return errors;
  }

  // Validate response_mode if provided
  if (params.response_mode !== undefined) {
    const validModes: ResponseMode[] = ['auto', 'full', 'summary', 'refs'];
    if (!validModes.includes(params.response_mode)) {
      errors.push({
        callId: '__batch__',
        message: `Invalid response_mode '${params.response_mode}'. Valid: ${validModes.join(', ')}`,
      });
    }
  }

  // Validate timeout if provided
  if (params.timeout !== undefined) {
    if (typeof params.timeout !== 'number' || params.timeout <= 0) {
      errors.push({
        callId: '__batch__',
        message: 'timeout must be a positive number (milliseconds)',
      });
    }
  }

  // Validate each call
  for (const id of callIds) {
    const call = params.calls[id];
    const error = validateCall(id, call);
    if (error) {
      errors.push(error);
    }
  }

  return errors;
}

// ============================================================================
// Grouping and Ordering
// ============================================================================

/** A group of calls targeting the same server */
export interface ServerCallGroup {
  server: string;
  calls: Array<{ id: string; call: BatchCall }>;
}

/**
 * Group calls by target server and sort by key within each group
 *
 * Keys are sorted lexicographically, so "1" < "10" < "2".
 * Use zero-padded keys ("01", "02") for predictable numeric ordering.
 */
export function groupCallsByServer(calls: Record<string, BatchCall>): ServerCallGroup[] {
  const groups = new Map<string, Array<{ id: string; call: BatchCall }>>();

  // Group calls by server
  for (const [id, call] of Object.entries(calls)) {
    const server = extractServerFromCall(call) || '__unknown__';

    if (!groups.has(server)) {
      groups.set(server, []);
    }
    groups.get(server)!.push({ id, call });
  }

  // Sort calls within each group by id (lexicographic)
  const result: ServerCallGroup[] = [];
  for (const [server, serverCalls] of groups.entries()) {
    serverCalls.sort((a, b) => a.id.localeCompare(b.id));
    result.push({ server, calls: serverCalls });
  }

  return result;
}

// ============================================================================
// Execution
// ============================================================================

/**
 * Execute a single call and return the result
 */
async function executeCall(
  id: string,
  call: BatchCall,
  options: CoreExecutionOptions
): Promise<{ id: string; result: BatchCallResult }> {
  try {
    const execResult = await coreExecute({
      ...options,
      argv: call.argv,
      params: call.params,
    });

    if (execResult.success) {
      // Try to parse output as JSON for structured result
      let output: unknown = execResult.output;
      if (typeof execResult.output === 'string') {
        try {
          output = JSON.parse(execResult.output);
        } catch {
          // Keep as string if not valid JSON
        }
      }

      return {
        id,
        result: {
          success: true,
          output,
        },
      };
    } else {
      return {
        id,
        result: {
          success: false,
          error: execResult.error || 'Unknown error',
        },
      };
    }
  } catch (error) {
    return {
      id,
      result: {
        success: false,
        error: getErrorMessage(error),
      },
    };
  }
}

/**
 * Execute a server's call queue serially
 */
async function executeServerQueue(
  group: ServerCallGroup,
  options: CoreExecutionOptions,
  completionOrder: string[],
  abortSignal?: { aborted: boolean }
): Promise<Map<string, BatchCallResult>> {
  const results = new Map<string, BatchCallResult>();

  for (const { id, call } of group.calls) {
    // Check if batch was aborted (timeout)
    if (abortSignal?.aborted) {
      results.set(id, {
        success: false,
        error: 'Batch timeout exceeded',
      });
      continue;
    }

    const { result } = await executeCall(id, call, options);
    results.set(id, result);
    completionOrder.push(id);
  }

  return results;
}

/**
 * Execute all server queues in parallel
 */
async function executeAllQueues(
  groups: ServerCallGroup[],
  options: CoreExecutionOptions,
  timeout: number
): Promise<{ results: Map<string, BatchCallResult>; order: string[]; timedOut: boolean }> {
  const completionOrder: string[] = [];
  const abortSignal = { aborted: false };

  // Create timeout promise
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    setTimeout(() => {
      abortSignal.aborted = true;
      resolve('timeout');
    }, timeout);
  });

  // Execute server queues in parallel
  const queuePromises = groups.map((group) =>
    executeServerQueue(group, options, completionOrder, abortSignal)
  );

  // Race between completion and timeout
  const raceResult = await Promise.race([
    Promise.all(queuePromises).then((results) => ({ type: 'complete' as const, results })),
    timeoutPromise.then(() => ({ type: 'timeout' as const })),
  ]);

  // Merge all results
  const allResults = new Map<string, BatchCallResult>();

  if (raceResult.type === 'complete') {
    for (const queueResults of raceResult.results) {
      for (const [id, result] of queueResults) {
        allResults.set(id, result);
      }
    }
    return { results: allResults, order: completionOrder, timedOut: false };
  } else {
    // Timeout - wait a bit for in-flight calls to finish, then collect what we have
    abortSignal.aborted = true;

    // Give a small grace period for in-flight calls
    await Promise.race([
      Promise.all(queuePromises),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);

    // Collect results that completed
    const partialResults = await Promise.all(queuePromises);
    for (const queueResults of partialResults) {
      for (const [id, result] of queueResults) {
        allResults.set(id, result);
      }
    }

    return { results: allResults, order: completionOrder, timedOut: true };
  }
}

// ============================================================================
// Response Formatting
// ============================================================================

/**
 * Save a result to a file
 */
async function saveResultToFile(
  id: string,
  result: BatchCallResult,
  dir: string,
  timestamp: number
): Promise<string> {
  const filename = `batch-${timestamp}-${id}.json`;
  const filePath = join(dir, filename);
  await writeFile(filePath, JSON.stringify(result.output, null, 2), 'utf-8');
  return filePath;
}

/**
 * Format batch results based on response mode
 */
export async function formatBatchResponse(
  results: Map<string, BatchCallResult>,
  order: string[],
  timedOut: boolean,
  responseMode: ResponseMode,
  cwd: string
): Promise<BatchResult> {
  const responseDir = join(cwd, '.temp', 'mcpu-responses');
  const timestamp = Date.now();

  // Calculate summary
  let succeeded = 0;
  let failed = 0;
  let timedOutCount = 0;

  for (const result of results.values()) {
    if (result.success) {
      succeeded++;
    } else {
      failed++;
      if (result.error?.includes('timeout')) {
        timedOutCount++;
      }
    }
  }

  const summary: BatchSummary = {
    total: results.size,
    succeeded,
    failed,
  };

  if (timedOutCount > 0) {
    summary.timedOut = timedOutCount;
  }

  // Convert Map to Record for output
  const resultsRecord: Record<string, BatchCallResult> = {};
  const savedFiles: string[] = [];

  // Calculate total response size for auto mode
  let totalSize = 0;
  for (const [id, result] of results) {
    if (result.output !== undefined) {
      totalSize += JSON.stringify(result.output).length;
    }
  }

  // Determine effective response mode
  let effectiveMode = responseMode;
  if (effectiveMode === 'auto' && totalSize > MAX_RESPONSE_SIZE) {
    effectiveMode = 'refs';
  }

  // Process results based on mode
  await mkdir(responseDir, { recursive: true });

  for (const [id, result] of results) {
    const processedResult: BatchCallResult = { ...result };

    if (effectiveMode === 'refs') {
      // Save all results to files
      if (result.output !== undefined) {
        const filePath = await saveResultToFile(id, result, responseDir, timestamp);
        processedResult.file = filePath;
        processedResult.output = '[saved]';
        processedResult.truncated = true;
        savedFiles.push(filePath);
      }
    } else if (effectiveMode === 'summary') {
      // Brief summary only, full to files
      if (result.output !== undefined) {
        const outputStr = JSON.stringify(result.output);
        const filePath = await saveResultToFile(id, result, responseDir, timestamp);
        processedResult.file = filePath;
        savedFiles.push(filePath);

        // Create brief summary
        if (outputStr.length > 200) {
          processedResult.output = outputStr.slice(0, 200) + '...';
          processedResult.truncated = true;
        }
      }
    } else if (effectiveMode === 'auto') {
      // Auto: truncate individual large results
      if (result.output !== undefined) {
        const outputStr = JSON.stringify(result.output);
        // Use 10KB threshold per result in auto mode
        if (outputStr.length > 10240) {
          const filePath = await saveResultToFile(id, result, responseDir, timestamp);
          processedResult.file = filePath;
          processedResult.output = outputStr.slice(0, 500) + '...';
          processedResult.truncated = true;
          savedFiles.push(filePath);
        }
      }
    }
    // 'full' mode: keep everything inline

    resultsRecord[id] = processedResult;
  }

  const batchResult: BatchResult = {
    results: resultsRecord,
    order,
    summary,
  };

  if (timedOut) {
    batchResult.timedOut = true;
  }

  if (savedFiles.length > 0) {
    batchResult.saved_files = savedFiles;
  }

  return batchResult;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Execute a batch of calls
 */
export async function executeBatch(
  params: BatchParams,
  options: CoreExecutionOptions
): Promise<CommandResult> {
  // Validate params
  const validationErrors = validateBatchParams(params);
  if (validationErrors.length > 0) {
    const errorMessages = validationErrors.map((e) => `${e.callId}: ${e.message}`).join('\n');
    return {
      success: false,
      error: `Batch validation failed:\n${errorMessages}`,
      exitCode: 1,
    };
  }

  const { calls, response_mode = 'auto', timeout = DEFAULT_BATCH_TIMEOUT } = params;

  // Group calls by server
  const groups = groupCallsByServer(calls);

  // Check concurrent server limit
  if (groups.length > MAX_CONCURRENT_SERVERS) {
    return {
      success: false,
      error: `Batch targets ${groups.length} servers, exceeds limit of ${MAX_CONCURRENT_SERVERS}`,
      exitCode: 1,
    };
  }

  // Execute all queues
  const { results, order, timedOut } = await executeAllQueues(groups, options, timeout);

  // Format response
  const cwd = options.cwd || process.cwd();
  const batchResult = await formatBatchResponse(results, order, timedOut, response_mode, cwd);

  // Return as JSON output
  return {
    success: !timedOut && batchResult.summary.failed === 0,
    output: JSON.stringify(batchResult),
    exitCode: timedOut || batchResult.summary.failed > 0 ? 1 : 0,
  };
}
