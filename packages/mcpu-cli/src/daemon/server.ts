import express, { type Request, type Response } from 'express';
import { ConnectionPool, type ConnectionInfo, type ConnectionPoolOptions } from './connection-pool.ts';
import { PidManager } from './pid-manager.ts';
import { ConfigDiscovery } from '../config.ts';
import { coreExecute } from '../core/core.ts';
import { type MCPServerConfig, isStdioConfig, isHttpConfig } from '../types.ts';
import { type Logger } from './logger.ts';

/**
 * Standard response envelope for success
 */
interface SuccessResponse<T = any> {
  success: true;
  data: T;
  error: null;
  meta?: {
    timestamp?: number;
    count?: number;
    requestId?: string;
  };
}

/**
 * Standard response envelope for errors
 */
interface ErrorResponse {
  success: false;
  data: null;
  error: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    timestamp?: number;
    requestId?: string;
  };
}

/**
 * Helper to create success response
 */
function successResponse<T>(data: T, meta?: any): SuccessResponse<T> {
  return {
    success: true,
    data,
    error: null,
    meta: {
      timestamp: Date.now(),
      ...meta,
    },
  };
}

/**
 * Helper to create error response
 */
function errorResponse(code: string, message: string, details?: any): ErrorResponse {
  return {
    success: false,
    data: null,
    error: {
      code,
      message,
      details,
    },
    meta: {
      timestamp: Date.now(),
    },
  };
}

/**
 * Convert ConnectionInfo to API format (without internal connection object)
 */
function toConnectionResponse(info: ConnectionInfo) {
  return {
    id: info.id,
    server: info.server,
    status: info.status,
    connectedAt: info.connectedAt,
    lastUsed: info.lastUsed,
    closedAt: info.closedAt,
  };
}

/**
 * HTTP daemon server for persistent MCP connections
 */
export interface DaemonServerOptions {
  port?: number;
  verbose?: boolean;
  config?: string;
  ppid?: number;
  logger?: Logger;
  /** Enable automatic disconnection of idle connections (default: false) */
  autoDisconnect?: boolean;
  /** Time in milliseconds before idle connections are closed (default: 5 minutes) */
  idleTimeoutMs?: number;
}

export class DaemonServer {
  private app = express();
  private pool: ConnectionPool;
  private pidManager = new PidManager();
  private configDiscovery: ConfigDiscovery;
  private configs = new Map<string, MCPServerConfig>();
  private server: any = null;
  private port: number = 0;
  private options: DaemonServerOptions;
  private parentMonitor: NodeJS.Timeout | null = null;
  private logger: Logger | null = null;

  constructor(options: DaemonServerOptions = {}) {
    this.logger = options.logger || null;
    this.options = options;
    this.pool = new ConnectionPool({
      autoDisconnect: options.autoDisconnect,
      idleTimeoutMs: options.idleTimeoutMs,
    });
    this.configDiscovery = new ConfigDiscovery({
      configFile: options.config,
      verbose: options.verbose,
    });

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Log helper - uses pino logger if available, falls back to console
   */
  private log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: Record<string, any>): void {
    if (this.logger) {
      this.logger[level](data || {}, message);
    } else {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      fn(data ? `${message} ${JSON.stringify(data)}` : message);
    }
  }

  /**
   * Check if parent process is still alive
   */
  private isParentAlive(ppid: number): boolean {
    try {
      return process.kill(ppid, 0);
    } catch (error) {
      return false;
    }
  }

  /**
   * Start monitoring parent process (for ppid > 0 with real process)
   */
  private startParentMonitor(): void {
    const ppid = this.options.ppid;

    if (!ppid || ppid <= 0) {
      return; // Only monitor for session-specific daemons (ppid > 0)
    }

    // Check if parent process actually exists
    if (!this.isParentAlive(ppid)) {
      // Parent doesn't exist - treat ppid as just an ID, no monitoring
      return;
    }

    // Parent exists - start monitoring every 5 seconds
    this.parentMonitor = setInterval(() => {
      if (!this.isParentAlive(ppid)) {
        this.log('info', 'Parent process terminated, shutting down', { ppid });
        this.shutdown().catch(err => {
          this.log('error', 'Error during shutdown', { error: String(err) });
          process.exit(1);
        });
      }
    }, 5000);
  }

  /**
   * Get Express app for testing
   */
  getApp(): express.Express {
    return this.app;
  }

  /**
   * Get ConnectionPool for testing
   */
  getPool(): ConnectionPool {
    return this.pool;
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    this.app.use(express.json());

    // Request logging
    if (this.options.verbose) {
      this.app.use((req, _res, next) => {
        this.log('debug', 'HTTP request', { method: req.method, path: req.path });
        next();
      });
    }
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check (legacy)
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', pid: process.pid });
    });

    // ===== Daemon Management =====
    this.app.get('/api/daemon', (_req: Request, res: Response) => {
      res.json(successResponse({
        pid: process.pid,
        port: this.port,
        uptime: process.uptime(),
      }));
    });

    this.app.post('/api/daemon/_shutdown', async (_req: Request, res: Response) => {
      res.json(successResponse({
        pid: process.pid,
        port: this.port,
        uptime: process.uptime(),
        status: 'shutting_down',
        shutdownAt: Date.now(),
      }));

      // Shutdown after sending response
      setTimeout(() => {
        this.shutdown().catch(err => {
          this.log('error', 'Error during shutdown', { error: String(err) });
          process.exit(1);
        });
      }, 100);
    });

    // ===== Server Management (Configured Servers) =====
    this.app.get('/api/servers', (_req: Request, res: Response) => {
      const servers = Array.from(this.configs.entries()).map(([name, config]) => {
        if (isStdioConfig(config)) {
          return { name, type: 'stdio', command: config.command, args: config.args, env: config.env };
        } else if (isHttpConfig(config)) {
          return { name, type: 'http', url: config.url, headers: config.headers };
        } else {
          return { name, type: 'websocket', url: config.url };
        }
      });
      res.json(successResponse(servers, { count: servers.length }));
    });

    this.app.get('/api/servers/:server', (req: Request, res: Response) => {
      const serverName = req.params.server;
      const config = this.configs.get(serverName);

      if (!config) {
        res.status(404).json(errorResponse(
          'SERVER_NOT_FOUND',
          `Server '${serverName}' not found in configuration`,
          { server: serverName }
        ));
        return;
      }

      if (isStdioConfig(config)) {
        res.json(successResponse({
          name: serverName,
          type: 'stdio',
          command: config.command,
          args: config.args,
          env: config.env,
        }));
      } else if (isHttpConfig(config)) {
        res.json(successResponse({
          name: serverName,
          type: 'http',
          url: config.url,
          headers: config.headers,
        }));
      } else {
        res.json(successResponse({
          name: serverName,
          type: 'websocket',
          url: config.url,
        }));
      }
    });

    // ===== Connection Management (Server-scoped) =====
    this.app.get('/api/servers/:server/connections', (req: Request, res: Response) => {
      const serverName = req.params.server;
      const config = this.configs.get(serverName);

      if (!config) {
        res.status(404).json(errorResponse(
          'SERVER_NOT_FOUND',
          `Server '${serverName}' not found in configuration`,
          { server: serverName }
        ));
        return;
      }

      const connections = this.pool.listServerConnections(serverName);
      const responseData = connections.map(toConnectionResponse);
      res.json(successResponse(responseData, { count: responseData.length }));
    });

    this.app.post('/api/servers/:server/connections', async (req: Request, res: Response) => {
      try {
        const serverName = req.params.server;
        const config = this.configs.get(serverName);

        if (!config) {
          res.status(404).json(errorResponse(
            'SERVER_NOT_FOUND',
            `Server '${serverName}' not found in configuration`,
            { server: serverName }
          ));
          return;
        }

        // Check if connection already exists
        const existing = this.pool.getConnectionByServer(serverName);
        if (existing && existing.status === 'connected') {
          // Return existing connection (idempotent)
          res.status(200).json(successResponse(toConnectionResponse(existing)));
          return;
        }

        // Create new connection
        const info = await this.pool.getConnection(serverName, config);
        res.status(201).json(successResponse(toConnectionResponse(info)));
      } catch (error: any) {
        res.status(500).json(errorResponse(
          'CONNECTION_FAILED',
          error.message || String(error)
        ));
      }
    });

    this.app.get('/api/servers/:server/connections/:id', (req: Request, res: Response) => {
      const serverName = req.params.server;
      const id = parseInt(req.params.id, 10);

      if (isNaN(id)) {
        res.status(400).json(errorResponse(
          'INVALID_FORMAT',
          'Connection ID must be an integer',
          { id: req.params.id }
        ));
        return;
      }

      const info = this.pool.getConnectionById(id);
      if (!info || info.server !== serverName) {
        res.status(404).json(errorResponse(
          'CONNECTION_NOT_FOUND',
          `Connection ${id} not found for server '${serverName}'`,
          { id, server: serverName }
        ));
        return;
      }

      res.json(successResponse(toConnectionResponse(info)));
    });

    this.app.delete('/api/servers/:server/connections/:id', async (req: Request, res: Response) => {
      try {
        const serverName = req.params.server;
        const id = parseInt(req.params.id, 10);

        if (isNaN(id)) {
          res.status(400).json(errorResponse(
            'INVALID_FORMAT',
            'Connection ID must be an integer',
            { id: req.params.id }
          ));
          return;
        }

        const info = this.pool.getConnectionById(id);
        if (!info || info.server !== serverName) {
          res.status(404).json(errorResponse(
            'CONNECTION_NOT_FOUND',
            `Connection ${id} not found for server '${serverName}'`,
            { id, server: serverName }
          ));
          return;
        }

        const closed = await this.pool.disconnect(serverName);
        if (closed) {
          res.json(successResponse(toConnectionResponse(closed)));
        } else {
          res.status(500).json(errorResponse(
            'DAEMON_ERROR',
            'Failed to close connection'
          ));
        }
      } catch (error: any) {
        res.status(500).json(errorResponse(
          'DAEMON_ERROR',
          error.message || String(error)
        ));
      }
    });

    // ===== Connection Management (Global) =====
    this.app.get('/api/connections', (_req: Request, res: Response) => {
      const connections = this.pool.listConnections();
      const responseData = connections.map(toConnectionResponse);
      res.json(successResponse(responseData, { count: responseData.length }));
    });

    this.app.get('/api/connections/:id', (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);

      if (isNaN(id)) {
        res.status(400).json(errorResponse(
          'INVALID_FORMAT',
          'Connection ID must be an integer',
          { id: req.params.id }
        ));
        return;
      }

      const info = this.pool.getConnectionById(id);
      if (!info) {
        res.status(404).json(errorResponse(
          'CONNECTION_NOT_FOUND',
          `Connection ${id} not found`,
          { id }
        ));
        return;
      }

      res.json(successResponse(toConnectionResponse(info)));
    });

    this.app.delete('/api/connections/:id', async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);

        if (isNaN(id)) {
          res.status(400).json(errorResponse(
            'INVALID_FORMAT',
            'Connection ID must be an integer',
            { id: req.params.id }
          ));
          return;
        }

        const closed = await this.pool.disconnectById(id);
        if (closed) {
          res.json(successResponse(toConnectionResponse(closed)));
        } else {
          res.status(404).json(errorResponse(
            'CONNECTION_NOT_FOUND',
            `Connection ${id} not found`,
            { id }
          ));
        }
      } catch (error: any) {
        res.status(500).json(errorResponse(
          'DAEMON_ERROR',
          error.message || String(error)
        ));
      }
    });

    // ===== Tool Discovery & Execution =====
    this.app.get('/api/servers/:server/tools', async (req: Request, res: Response) => {
      try {
        const serverName = req.params.server;
        const config = this.configs.get(serverName);

        if (!config) {
          res.status(404).json(errorResponse(
            'SERVER_NOT_FOUND',
            `Server '${serverName}' not found in configuration`,
            { server: serverName }
          ));
          return;
        }

        const connection = this.pool.getRawConnection(serverName);
        if (!connection) {
          res.status(503).json(errorResponse(
            'NOT_CONNECTED',
            `Server '${serverName}' is not connected`,
            { server: serverName }
          ));
          return;
        }

        const response = await connection.client.listTools();
        const tools = response.tools || [];
        res.json(successResponse(tools, { count: tools.length }));
      } catch (error: any) {
        res.status(500).json(errorResponse(
          'DAEMON_ERROR',
          error.message || String(error)
        ));
      }
    });

    this.app.get('/api/servers/:server/tools/:tool', async (req: Request, res: Response) => {
      try {
        const serverName = req.params.server;
        const toolName = req.params.tool;
        const config = this.configs.get(serverName);

        if (!config) {
          res.status(404).json(errorResponse(
            'SERVER_NOT_FOUND',
            `Server '${serverName}' not found in configuration`,
            { server: serverName }
          ));
          return;
        }

        const connection = this.pool.getRawConnection(serverName);
        if (!connection) {
          res.status(503).json(errorResponse(
            'NOT_CONNECTED',
            `Server '${serverName}' is not connected`,
            { server: serverName }
          ));
          return;
        }

        const response = await connection.client.listTools();
        const tools = response.tools || [];
        const tool = tools.find(t => t.name === toolName);

        if (!tool) {
          res.status(404).json(errorResponse(
            'TOOL_NOT_FOUND',
            `Tool '${toolName}' not found on server '${serverName}'`,
            { server: serverName, tool: toolName }
          ));
          return;
        }

        res.json(successResponse(tool));
      } catch (error: any) {
        res.status(500).json(errorResponse(
          'DAEMON_ERROR',
          error.message || String(error)
        ));
      }
    });

    this.app.post('/api/servers/:server/tools/:tool/_execute', async (req: Request, res: Response) => {
      try {
        const serverName = req.params.server;
        const toolName = req.params.tool;
        const { params = {} } = req.body;
        const config = this.configs.get(serverName);

        if (!config) {
          res.status(404).json(errorResponse(
            'SERVER_NOT_FOUND',
            `Server '${serverName}' not found in configuration`,
            { server: serverName }
          ));
          return;
        }

        const connection = this.pool.getRawConnection(serverName);
        if (!connection) {
          res.status(503).json(errorResponse(
            'NOT_CONNECTED',
            `Server '${serverName}' is not connected`,
            { server: serverName }
          ));
          return;
        }

        const result = await connection.client.callTool({ name: toolName, arguments: params });
        res.json(successResponse({
          tool: toolName,
          server: serverName,
          executedAt: Date.now(),
          result,
        }));
      } catch (error: any) {
        res.status(500).json(errorResponse(
          'TOOL_EXECUTION_FAILED',
          error.message || String(error),
          { server: req.params.server, tool: req.params.tool }
        ));
      }
    });

    // ===== Legacy/Backward Compatibility Endpoints =====

    // Execute CLI command (backward compatibility)
    this.app.post('/cli', async (req: Request, res: Response) => {
      try {
        const { argv, params, mcpServerConfig, cwd } = req.body;

        if (!Array.isArray(argv)) {
          res.status(400).json({
            success: false,
            error: 'Missing or invalid "argv" array',
            exitCode: 1,
          });
          return;
        }

        // Execute using core module with connection pool and config map
        const result = await coreExecute({
          argv,
          params,
          mcpServerConfig,
          cwd,
          connectionPool: this.pool,
          configs: this.configs,  // Pass mutable config map
        });

        res.json(result);
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message || String(error),
          exitCode: 1,
        });
      }
    });

    // Legacy /exit endpoint
    this.app.post('/exit', async (_req: Request, res: Response) => {
      res.json({
        success: true,
        message: 'Daemon shutting down...',
      });

      setTimeout(() => {
        this.shutdown().catch(err => {
          this.log('error', 'Error during shutdown', { error: String(err) });
          process.exit(1);
        });
      }, 100);
    });

    // Legacy /control endpoint
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
          this.pidManager.saveDaemonInfo({
            pid: process.pid,
            ppid: this.options.ppid || 0,
            port: this.port,
            startTime: new Date().toISOString(),
          }).catch(err => {
            this.log('error', 'Failed to write PID file', { error: String(err) });
          });

          this.log('info', 'Daemon started', {
            port: this.port,
            pid: process.pid,
            ppid: this.options.ppid || 0,
          });

          // Start monitoring parent process (if ppid > 0 and parent exists)
          this.startParentMonitor();

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
    this.log('info', 'Shutting down daemon');

    // Stop parent monitor
    if (this.parentMonitor) {
      clearInterval(this.parentMonitor);
      this.parentMonitor = null;
    }

    // Close all connections (best effort)
    try {
      await this.pool.shutdown();
    } catch (error) {
      this.log('error', 'Error closing connections', { error: String(error) });
    }

    // Remove PID file (always attempt cleanup)
    try {
      await this.pidManager.removeDaemonInfo(this.options.ppid || 0, process.pid);
    } catch (error) {
      this.log('error', 'Error removing PID file', { error: String(error) });
    }

    // Close HTTP server (best effort)
    if (this.server) {
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Server close timeout'));
          }, 5000);

          this.server.close((err: any) => {
            clearTimeout(timeout);
            if (err) {
              reject(err);
            } else {
              this.log('debug', 'Server closed');
              resolve();
            }
          });
        });
      } catch (error) {
        this.log('error', 'Error closing server', { error: String(error) });
      }
    }

    this.log('info', 'Daemon shut down successfully');
    process.exit(0);
  }

  /**
   * Get the port the server is listening on
   */
  getPort(): number {
    return this.port;
  }
}
