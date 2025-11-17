import express, { type Request, type Response } from 'express';
import { ConnectionPool } from './connection-pool.js';
import { PidManager } from './pid-manager.js';
import { ConfigDiscovery } from '../config.js';
import { executeCommand, type ExecuteOptions } from '../core/executor.js';
import { parseCommandArgs } from '../core/parser.js';
import type { MCPServerConfig } from '../types.js';

/**
 * HTTP daemon server for persistent MCP connections
 */
export class DaemonServer {
  private app = express();
  private pool = new ConnectionPool();
  private pidManager = new PidManager();
  private configDiscovery: ConfigDiscovery;
  private configs = new Map<string, MCPServerConfig>();
  private server: any = null;
  private port: number = 0;

  constructor(private options: { port?: number; verbose?: boolean; config?: string } = {}) {
    this.configDiscovery = new ConfigDiscovery({
      configFile: options.config,
      verbose: options.verbose,
    });

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    this.app.use(express.json());

    // Request logging
    if (this.options.verbose) {
      this.app.use((req, _res, next) => {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
        next();
      });
    }
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', pid: process.pid });
    });

    // Execute CLI command
    this.app.post('/cli', async (req: Request, res: Response) => {
      try {
        const { argv, params, outputFile } = req.body;

        if (!Array.isArray(argv)) {
          res.status(400).json({
            success: false,
            error: 'Missing or invalid "argv" array',
            exitCode: 1,
          });
          return;
        }

        // Parse the command
        const parsed = parseCommandArgs(argv);

        // If params is provided, pass it to call command args
        if (params && typeof params === 'object' && parsed.command === 'call') {
          parsed.args.stdinData = JSON.stringify(params);
        }

        // Load configs if not already loaded
        if (this.configs.size === 0) {
          this.configs = await this.configDiscovery.loadConfigs();
        }

        // Execute command with persistent connections
        const result = await this.executeWithPool(parsed.command, parsed.args, parsed.options);

        // Optionally write to file
        if (outputFile && result.output) {
          const fs = await import('fs/promises');
          await fs.writeFile(outputFile, result.output, 'utf-8');
        }

        res.json(result);
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message || String(error),
          exitCode: 1,
        });
      }
    });

    // Connection management
    this.app.post('/control', async (req: Request, res: Response) => {
      try {
        const { action, server } = req.body;

        if (!action) {
          res.status(400).json({
            success: false,
            error: 'Missing "action" field',
          });
          return;
        }

        switch (action) {
          case 'list':
            {
              const connections = this.pool.listConnections();
              res.json({
                success: true,
                connections,
              });
            }
            break;

          case 'disconnect':
            {
              if (!server) {
                res.status(400).json({
                  success: false,
                  error: 'Missing "server" field for disconnect action',
                });
                return;
              }
              await this.pool.disconnect(server);
              res.json({
                success: true,
                message: `Disconnected from ${server}`,
              });
            }
            break;

          case 'reconnect':
            {
              if (!server) {
                res.status(400).json({
                  success: false,
                  error: 'Missing "server" field for reconnect action',
                });
                return;
              }
              await this.pool.reconnect(server);
              res.json({
                success: true,
                message: `Reconnected to ${server}`,
              });
            }
            break;

          default:
            res.status(400).json({
              success: false,
              error: `Unknown action: ${action}`,
            });
        }
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message || String(error),
        });
      }
    });

    // Graceful shutdown
    this.app.post('/exit', async (_req: Request, res: Response) => {
      res.json({
        success: true,
        message: 'Daemon shutting down...',
      });

      // Shutdown after sending response
      setTimeout(() => {
        this.shutdown().catch(err => {
          console.error('Error during shutdown:', err);
          process.exit(1);
        });
      }, 100);
    });
  }

  /**
   * Execute command using connection pool
   */
  private async executeWithPool(
    command: string,
    args: any,
    options: ExecuteOptions
  ): Promise<any> {
    // Load configs if needed
    if (this.configs.size === 0) {
      this.configs = await this.configDiscovery.loadConfigs();
    }

    // Execute the command with connection pool for persistent connections
    return await executeCommand(command, args, {
      ...options,
      connectionPool: this.pool,
    });
  }

  /**
   * Start the daemon server
   */
  async start(): Promise<number> {
    // Load configurations
    this.configs = await this.configDiscovery.loadConfigs();

    return new Promise((resolve, reject) => {
      try {
        const port = this.options.port || 0; // 0 = let OS assign port
        this.server = this.app.listen(port, () => {
          const address = this.server.address();
          this.port = address.port;

          // Write PID file
          this.pidManager.writeDaemonInfo({
            pid: process.pid,
            port: this.port,
            startTime: new Date().toISOString(),
          }).catch(err => {
            console.error('Failed to write PID file:', err);
          });

          console.log(`Daemon started on port ${this.port} (PID: ${process.pid})`);
          resolve(this.port);
        });

        this.server.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Shutdown the daemon
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down daemon...');

    // Close all connections
    await this.pool.shutdown();

    // Remove PID file
    await this.pidManager.removeDaemonInfo(process.pid);

    // Close HTTP server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server.close(() => {
          console.log('Server closed');
          resolve();
        });
      });
    }

    console.log('Daemon shut down successfully');
    process.exit(0);
  }

  /**
   * Get the port the server is listening on
   */
  getPort(): number {
    return this.port;
  }
}
