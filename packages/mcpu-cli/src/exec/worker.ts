/**
 * Worker runtime for exec command
 *
 * This file runs in an isolated child process. It receives code from the
 * main process, executes it, and sends results back via IPC.
 *
 * The user code gets access to `mcpuMux` function which proxies calls
 * back to the main process where actual MCP connections exist.
 */

import { createRequire } from 'module';

// Types for IPC messages
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

// Pending mux calls waiting for response
let nextId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

/**
 * mcpuMux stub - sends calls to main process via IPC
 *
 * This function is injected into user code. It looks and behaves like
 * a regular async function, but actually sends IPC messages to the
 * main process which has the actual MCP connections.
 */
async function mcpuMux(opts: {
  argv: string[];
  params?: Record<string, unknown>;
  batch?: Record<string, { argv: string[]; params?: Record<string, unknown> }>;
}): Promise<unknown> {
  const id = nextId++;

  const request: MuxRequest = { id, ...opts };
  process.send!(request);

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

/**
 * Run user code in an async context
 *
 * The code is wrapped in an AsyncFunction with mcpuMux and require
 * injected as parameters. The code should use `return` to provide
 * a result, or the last expression value is returned.
 */
async function runUserCode(code: string, cwd?: string): Promise<unknown> {
  // Change to specified working directory if provided
  if (cwd) {
    process.chdir(cwd);
  }

  // Create a require function scoped to the working directory
  const userRequire = createRequire(cwd ? `${cwd}/` : process.cwd() + '/');

  // Create async function with injected parameters
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  // Wrap code to handle both explicit return and expression result
  const wrappedCode = code;

  const fn = new AsyncFunction('mcpuMux', 'require', wrappedCode);

  return await fn(mcpuMux, userRequire);
}

// Handle messages from main process
process.on('message', async (msg: ExecMessage | MuxResponse) => {
  if ('type' in msg && msg.type === 'exec') {
    // Execute user code
    try {
      const result = await runUserCode(msg.code, msg.cwd);
      const doneMsg: DoneMessage = { type: 'done', value: result };
      process.send!(doneMsg);
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      const doneMsg: DoneMessage = { type: 'done', error };
      process.send!(doneMsg);
    }
  } else if ('id' in msg) {
    // Response to a mux call
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(msg.error));
      } else {
        p.resolve(msg.result);
      }
    }
  }
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  const doneMsg: DoneMessage = { type: 'done', error: `Uncaught exception: ${err.message}` };
  process.send!(doneMsg);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason.message : String(reason);
  const doneMsg: DoneMessage = { type: 'done', error: `Unhandled rejection: ${error}` };
  process.send!(doneMsg);
  process.exit(1);
});
