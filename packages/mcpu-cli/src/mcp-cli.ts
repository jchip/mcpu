/**
 * MCPU MCP Server CLI
 *
 * Start MCPU as an MCP server using stdio transport.
 * This allows AI agents to discover and use MCP servers through MCPU.
 */

import { NixClap } from 'nix-clap';
import { McpuMcpServer } from './mcp/server.ts';
import { VERSION } from './version.ts';

interface McpCommandOptions {
  config?: string;
  verbose?: boolean;
  autoDisconnect?: boolean;
  idleTimeoutMs?: number;
}

async function mcpCommand(options: McpCommandOptions): Promise<void> {
  const server = new McpuMcpServer(options);

  // Handle shutdown signals
  const shutdown = async () => {
    await server.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);

  // Handle uncaught errors
  process.on('uncaughtException', async (error) => {
    console.error('[mcpu-mcp] Uncaught exception:', error);
    try {
      await server.shutdown();
    } catch {
      // Ignore shutdown errors
    }
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    console.error('[mcpu-mcp] Unhandled rejection:', reason);
    try {
      await server.shutdown();
    } catch {
      // Ignore shutdown errors
    }
    process.exit(1);
  });

  try {
    await server.start();
    // Server runs until stdin closes or signal received
  } catch (error: any) {
    console.error('[mcpu-mcp] Failed to start:', error.message || String(error));
    process.exit(1);
  }
}

// CLI entry point
new NixClap({ name: 'mcpu-mcp' })
  .version(VERSION)
  .usage('$0 [options]')
  .init2({
    desc: 'Start MCPU as an MCP server (stdio transport)',
    options: {
      config: {
        desc: 'Use specific config file',
        args: '<file string>',
      },
      verbose: {
        desc: 'Show detailed logging to stderr',
      },
      'auto-disconnect': {
        desc: 'Enable automatic disconnection of idle MCP connections',
      },
      'idle-timeout': {
        desc: 'Idle timeout in minutes before disconnecting (default: 5)',
        args: '<minutes number>',
      },
    },
    exec: async (cmd) => {
      const opts = cmd.jsonMeta.opts;
      const idleTimeoutMinutes = opts['idle-timeout'] ? parseInt(opts['idle-timeout'] as string, 10) : undefined;
      const idleTimeoutMs = idleTimeoutMinutes ? idleTimeoutMinutes * 60 * 1000 : undefined;

      await mcpCommand({
        config: opts.config as string | undefined,
        verbose: opts.verbose as boolean | undefined,
        autoDisconnect: opts['auto-disconnect'] as boolean | undefined,
        idleTimeoutMs,
      });
    },
  })
  .parse();
