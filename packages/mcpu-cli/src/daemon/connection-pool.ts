import { MCPClient, type MCPConnection } from '../client.ts';
import type { MCPServerConfig } from '../types.ts';

export interface ConnectionInfo {
  id: number;
  server: string;
  connection: MCPConnection;
  status: 'connected' | 'disconnected' | 'error';
  connectedAt: number;
  lastUsed: number;
  closedAt: number | null;
}

/**
 * Manages persistent MCP server connections for the daemon
 */
export class ConnectionPool {
  private connections = new Map<string, MCPConnection>();
  private connectionInfo = new Map<number, ConnectionInfo>();
  private serverToId = new Map<string, number>();
  private idToServer = new Map<number, string>();
  private nextId = 1;
  private configs = new Map<string, MCPServerConfig>();
  private client = new MCPClient();
  private cleanupInterval: NodeJS.Timeout | null = null;

  // Connection TTL: 5 minutes of inactivity
  private readonly TTL_MS = 5 * 60 * 1000;

  constructor() {
    // Start periodic cleanup of stale connections
    this.startCleanup();
  }

  /**
   * Get or create a connection to a server
   * Returns the ConnectionInfo with the connection ID
   */
  async getConnection(serverName: string, config: MCPServerConfig): Promise<ConnectionInfo> {
    // Check if connection exists and is still valid
    const existingId = this.serverToId.get(serverName);
    if (existingId !== undefined) {
      const info = this.connectionInfo.get(existingId);
      if (info) {
        // Update last used timestamp
        info.lastUsed = Date.now();
        return info;
      }
    }

    // Create new connection
    const connection = await this.client.connect(serverName, config);
    const id = this.nextId++;
    const now = Date.now();

    const info: ConnectionInfo = {
      id,
      server: serverName,
      connection,
      status: 'connected',
      connectedAt: now,
      lastUsed: now,
      closedAt: null,
    };

    this.connections.set(serverName, connection);
    this.connectionInfo.set(id, info);
    this.serverToId.set(serverName, id);
    this.idToServer.set(id, serverName);
    this.configs.set(serverName, config);

    return info;
  }

  /**
   * Disconnect a specific server
   * Returns the ConnectionInfo with updated status
   */
  async disconnect(serverName: string): Promise<ConnectionInfo | null> {
    const connection = this.connections.get(serverName);
    const id = this.serverToId.get(serverName);

    if (connection && id !== undefined) {
      await this.client.disconnect(connection);

      const info = this.connectionInfo.get(id);
      if (info) {
        info.status = 'disconnected';
        info.closedAt = Date.now();

        // Clean up maps but keep ConnectionInfo for history
        this.connections.delete(serverName);
        this.serverToId.delete(serverName);
        this.idToServer.delete(id);
        this.configs.delete(serverName);

        return info;
      }
    }

    return null;
  }

  /**
   * Disconnect by connection ID
   */
  async disconnectById(id: number): Promise<ConnectionInfo | null> {
    const serverName = this.idToServer.get(id);
    if (serverName) {
      return this.disconnect(serverName);
    }
    return null;
  }

  /**
   * Disconnect all servers
   */
  async disconnectAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const serverName of this.connections.keys()) {
      promises.push(this.disconnect(serverName));
    }
    await Promise.all(promises);
  }

  /**
   * Get list of all active connections
   */
  listConnections(): ConnectionInfo[] {
    const result: ConnectionInfo[] = [];
    for (const id of this.serverToId.values()) {
      const info = this.connectionInfo.get(id);
      if (info && info.status === 'connected') {
        result.push(info);
      }
    }
    return result;
  }

  /**
   * Get list of connections for a specific server
   */
  listServerConnections(serverName: string): ConnectionInfo[] {
    const id = this.serverToId.get(serverName);
    if (id !== undefined) {
      const info = this.connectionInfo.get(id);
      if (info) {
        return [info];
      }
    }
    return [];
  }

  /**
   * Get connection info by ID
   */
  getConnectionById(id: number): ConnectionInfo | null {
    return this.connectionInfo.get(id) || null;
  }

  /**
   * Get connection info by server name
   */
  getConnectionByServer(serverName: string): ConnectionInfo | null {
    const id = this.serverToId.get(serverName);
    if (id !== undefined) {
      return this.connectionInfo.get(id) || null;
    }
    return null;
  }

  /**
   * Get the actual MCPConnection for a server (for internal use)
   */
  getRawConnection(serverName: string): MCPConnection | null {
    const info = this.getConnectionByServer(serverName);
    if (info && info.status === 'connected') {
      // Update last used
      info.lastUsed = Date.now();
      return info.connection;
    }
    return null;
  }

  /**
   * Reconnect a specific server
   */
  async reconnect(serverName: string): Promise<void> {
    const config = this.configs.get(serverName);
    if (!config) {
      throw new Error(`No configuration found for server: ${serverName}`);
    }

    // Disconnect if connected
    await this.disconnect(serverName);

    // Reconnect
    await this.getConnection(serverName, config);
  }

  /**
   * Clean up stale connections (not used for TTL_MS)
   */
  private async cleanupStale(): Promise<void> {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [serverName, id] of this.serverToId.entries()) {
      const info = this.connectionInfo.get(id);
      if (info && info.status === 'connected') {
        if (now - info.lastUsed > this.TTL_MS) {
          toRemove.push(serverName);
        }
      }
    }

    for (const serverName of toRemove) {
      await this.disconnect(serverName);
    }
  }

  /**
   * Start periodic cleanup
   */
  private startCleanup(): void {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupStale().catch(err => {
        console.error('Error during connection cleanup:', err);
      });
    }, 60 * 1000);
  }

  /**
   * Stop periodic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Shutdown the pool
   */
  async shutdown(): Promise<void> {
    this.stopCleanup();
    await this.disconnectAll();
  }
}
