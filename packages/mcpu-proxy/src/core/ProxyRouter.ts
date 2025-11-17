import { IncomingMessage, ServerResponse } from 'http';
import WebSocket from 'ws';
import { MCPServer, MCPMessage } from '../types';
import { createChildLogger } from '../utils/logger';
import { ServerManager } from './ServerManager';

const logger = createChildLogger('ProxyRouter');

export class ProxyRouter {
  private serverManager: ServerManager;
  private activeConnections: Map<string, WebSocket> = new Map();

  constructor(serverManager: ServerManager) {
    this.serverManager = serverManager;
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const namespace = url.pathname.slice(1); // Remove leading slash

    if (!namespace) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Namespace required' }));
      return;
    }

    const server = this.findServerByNamespace(namespace);
    if (!server) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Server for namespace '${namespace}' not found` }));
      return;
    }

    // Route to appropriate server
    await this.routeToServer(server, req, res);
  }

  handleWebSocket(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const namespace = url.pathname.slice(1);

    if (!namespace) {
      ws.close(1003, 'Namespace required');
      return;
    }

    const server = this.findServerByNamespace(namespace);
    if (!server) {
      ws.close(1003, `Server for namespace '${namespace}' not found`);
      return;
    }

    this.routeWebSocketToServer(server, ws);
  }

  private findServerByNamespace(namespace: string): MCPServer | undefined {
    // Find server whose namespace matches or is a prefix
    for (const server of this.serverManager.getAllServers()) {
      if (server.namespace === namespace || namespace.startsWith(server.namespace + '/')) {
        return server;
      }
    }
    return undefined;
  }

  private async routeToServer(server: MCPServer, req: IncomingMessage, res: ServerResponse): Promise<void> {
    // For now, implement basic JSON-RPC proxy
    // In a real implementation, this would maintain persistent connections to servers

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const message: MCPMessage = JSON.parse(body);

        // Route message to server
        const response = await this.sendToServer(server, message);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (error) {
        logger.error('Error routing request:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  }

  private routeWebSocketToServer(server: MCPServer, clientWs: WebSocket): void {
    // Create connection to server
    const serverWs = new WebSocket(`ws://localhost:${this.getServerPort(server)}`);

    serverWs.on('open', () => {
      logger.info(`WebSocket connection established for server ${server.id}`);
    });

    serverWs.on('message', (data) => {
      clientWs.send(data);
    });

    serverWs.on('close', (code, reason) => {
      logger.info(`Server WebSocket closed for ${server.id}: ${code} ${reason}`);
      clientWs.close(code, reason);
    });

    serverWs.on('error', (error) => {
      logger.error(`Server WebSocket error for ${server.id}:`, error);
      clientWs.close(1011, 'Server error');
    });

    clientWs.on('message', (data) => {
      if (serverWs.readyState === WebSocket.OPEN) {
        serverWs.send(data);
      }
    });

    clientWs.on('close', (code, reason) => {
      logger.info(`Client WebSocket closed for ${server.id}: ${code} ${reason}`);
      serverWs.close(code, reason);
    });

    clientWs.on('error', (error) => {
      logger.error(`Client WebSocket error for ${server.id}:`, error);
      serverWs.close(1011, 'Client error');
    });
  }

  private async sendToServer(server: MCPServer, message: MCPMessage): Promise<MCPMessage> {
    // This is a simplified implementation
    // In reality, you'd maintain persistent connections and route messages

    return {
      jsonrpc: '2.0',
      id: message.id,
      result: { message: `Processed by ${server.name}` }
    };
  }

  private getServerPort(server: MCPServer): number {
    // This would be determined by the server's configuration
    // For now, return a default port
    return 3001; // This should be configurable per server
  }

  getActiveConnections(): string[] {
    return Array.from(this.activeConnections.keys());
  }
}