import { MCPClient, type MCPConnection } from '../client.ts';
import type { MCPServerConfig } from '../types.ts';

/**
 * Manages persistent MCP server connections for the daemon
 */
export class ConnectionPool {
  private connections = new Map<string, MCPConnection>();
  private lastUsed = new Map<string, number>();
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
   */
  async getConnection(serverName: string, config: MCPServerConfig): Promise<MCPConnection> {
    // Check if connection exists and is still valid
    const existing = this.connections.get(serverName);
    if (existing) {
      this.lastUsed.set(serverName, Date.now());
      return existing;
    }

    // Create new connection
    const connection = await this.client.connect(serverName, config);
    this.connections.set(serverName, connection);
    this.configs.set(serverName, config);
    this.lastUsed.set(serverName, Date.now());

    return connection;
  }

  /**
   * Disconnect a specific server
   */
  async disconnect(serverName: string): Promise<void> {
    const connection = this.connections.get(serverName);
    if (connection) {
      await this.client.disconnect(connection);
      this.connections.delete(serverName);
      this.lastUsed.delete(serverName);
      this.configs.delete(serverName);
    }
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
   * Get list of connected servers
   */
  listConnections(): Array<{ server: string; lastUsed: number }> {
    const result: Array<{ server: string; lastUsed: number }> = [];
    for (const [server, connection] of this.connections.entries()) {
      const lastUsed = this.lastUsed.get(server) || 0;
      result.push({ server, lastUsed });
    }
    return result;
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

    for (const [serverName, lastUsedTime] of this.lastUsed.entries()) {
      if (now - lastUsedTime > this.TTL_MS) {
        toRemove.push(serverName);
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
