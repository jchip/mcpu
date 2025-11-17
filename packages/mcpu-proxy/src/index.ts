import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { RegistryManager } from './core/RegistryManager';
import { ServerManager } from './core/ServerManager';
import { ProxyRouter } from './core/ProxyRouter';
import { configManager } from './config';
import { createChildLogger } from './utils/logger';

const logger = createChildLogger('MCPProxy');

export class MCPProxy {
  private app: express.Application;
  private server: any;
  private wss: WebSocketServer | undefined;
  private registryManager: RegistryManager;
  private serverManager: ServerManager;
  private proxyRouter: ProxyRouter;

  constructor() {
    this.app = express();
    this.registryManager = new RegistryManager();
    this.serverManager = new ServerManager();
    this.proxyRouter = new ProxyRouter(this.serverManager);

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.url}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });

    // MCP JSON-RPC endpoint - catch all MCP requests
    this.app.use('/mcp/:namespace/:method', (req, res) => {
      this.proxyRouter.handleRequest(req, res);
    });

    // Registry endpoints
    this.app.get('/api/registries', (req, res) => {
      const registries = this.registryManager.getAllRegistries();
      res.json(registries);
    });

    this.app.get('/api/servers', (req, res) => {
      const servers = this.serverManager.getAllServers();
      res.json(servers);
    });

    // Catch-all for MCP routing - simplified
    this.app.use((req, res) => {
      this.proxyRouter.handleRequest(req, res);
    });
  }

  async start(port: number = 3000): Promise<void> {
    logger.info(`Starting MCP Proxy on port ${port}`);

    // Initialize components
    await configManager.load();
    await this.registryManager.loadRegistries();
    await this.serverManager.loadServers();

    // Start HTTP server
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    // Setup WebSocket handling
    this.wss.on('connection', (ws, req) => {
      this.proxyRouter.handleWebSocket(ws, req);
    });

    return new Promise((resolve, reject) => {
      this.server.listen(port, () => {
        logger.info(`MCP Proxy listening on port ${port}`);
        resolve();
      });

      this.server.on('error', (error: any) => {
        logger.error('Server error:', error);
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    logger.info('Stopping MCP Proxy');

    if (this.wss) {
      this.wss.close();
    }

    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          logger.info('MCP Proxy stopped');
          resolve();
        });
      });
    }
  }

  getRegistryManager(): RegistryManager {
    return this.registryManager;
  }

  getServerManager(): ServerManager {
    return this.serverManager;
  }

  getProxyRouter(): ProxyRouter {
    return this.proxyRouter;
  }
}

// For CLI usage
if (require.main === module) {
  const proxy = new MCPProxy();
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  proxy.start(port).catch((error) => {
    console.error('Failed to start MCP Proxy:', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await proxy.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await proxy.stop();
    process.exit(0);
  });
}