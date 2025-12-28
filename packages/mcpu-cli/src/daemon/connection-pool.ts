import { MCPClient, type MCPConnection } from '../client.ts';
import type { MCPServerConfig } from '../types.ts';
import { SchemaCache } from '../cache.ts';
import { createLogger, logServerDisconnect } from '../logging.ts';
import type pino from 'pino';

/**
 * Form connection key: "server" or "server[id]"
 */
export function getConnectionKey(serverName: string, connId?: string): string {
  return connId ? `${serverName}[${connId}]` : serverName;
}

/**
 * Parse connection key back to {server, connId}
 */
export function parseConnectionKey(key: string): { server: string; connId?: string } {
  const match = key.match(/^(.+?)\[(.+)\]$/);
  if (match) {
    return { server: match[1], connId: match[2] };
  }
  return { server: key };
}

export interface ConnectionInfo {
  id: number;
  server: string;
  connId?: string;  // Optional connection instance ID
  connection: MCPConnection;
  status: 'connected' | 'disconnected' | 'error';
  connectedAt: number;
  lastUsed: number;
  closedAt: number | null;
}

export interface ConnectionPoolOptions {
  /** Enable automatic disconnection of idle connections (default: false) */
  autoDisconnect?: boolean;
  /** Time in milliseconds before idle connections are closed (default: 5 minutes) */
  idleTimeoutMs?: number;
  /** Service name for logging (e.g., 'daemon' or 'mcpu-mcp') */
  service?: string;
  /** Parent process ID for logging */
  ppid?: number;
  /** Process ID for logging */
  pid?: number;
  /** Roots to forward to managed MCP servers */
  roots?: string[];
}

/**
 * Manages persistent MCP server connections for the daemon
 */
export class ConnectionPool {
  private connections = new Map<string, MCPConnection>(); // key -> connection
  private connectionInfo = new Map<number, ConnectionInfo>();
  private keyToId = new Map<string, number>(); // connection key -> id
  private idToKey = new Map<number, string>(); // id -> connection key
  private nextId = 1;
  private serverNextAutoId = new Map<string, number>(); // server -> next auto ID
  private configs = new Map<string, MCPServerConfig>(); // key -> config
  private client = new MCPClient();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private schemaCache = new SchemaCache();
  private refreshingServers = new Set<string>(); // Track servers being refreshed
  private connectingServers = new Map<string, Promise<ConnectionInfo>>(); // Track in-flight connection attempts (by key)

  // Connection TTL: 5 minutes of inactivity (default)
  private readonly idleTimeoutMs: number;
  private readonly autoDisconnect: boolean;
  private readonly service?: string;
  private readonly ppid?: number;
  private readonly pid?: number;
  private readonly logger?: pino.Logger;
  private roots?: string[]; // Roots to forward to managed servers

  constructor(options: ConnectionPoolOptions = {}) {
    this.autoDisconnect = options.autoDisconnect ?? false;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60 * 1000;
    this.service = options.service;
    this.ppid = options.ppid;
    this.pid = options.pid;
    this.roots = options.roots;

    // Create logger if service/ppid/pid provided
    if (this.service && this.ppid !== undefined && this.pid !== undefined) {
      this.logger = createLogger(this.service, this.ppid, this.pid);
    }

    // Start periodic cleanup of stale connections (only if enabled)
    if (this.autoDisconnect) {
      this.startCleanup();
    }
  }

  /**
   * Get or create a connection to a server
   * Returns the ConnectionInfo with the connection ID
   * @param serverName - The server name from config
   * @param config - Server configuration
   * @param connId - Optional connection instance ID (for multi-instance support)
   */
  async getConnection(serverName: string, config: MCPServerConfig, connId?: string): Promise<ConnectionInfo> {
    const key = getConnectionKey(serverName, connId);

    // Check if connection exists and is still valid
    const existingId = this.keyToId.get(key);
    if (existingId !== undefined) {
      const info = this.connectionInfo.get(existingId);
      if (info && info.status === 'connected') {
        // Update last used timestamp
        info.lastUsed = Date.now();
        return info;
      }
    }

    // Check if connection is already in progress (prevents race condition)
    const existingPromise = this.connectingServers.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    // Create connection promise and track it
    const connectionPromise = this.createConnection(serverName, config, connId);
    this.connectingServers.set(key, connectionPromise);

    try {
      return await connectionPromise;
    } finally {
      this.connectingServers.delete(key);
    }
  }

  /**
   * Get or create a new connection instance with auto-assigned ID
   * Always creates a new instance, even if default connection exists
   */
  async getConnectionWithNewId(serverName: string, config: MCPServerConfig): Promise<ConnectionInfo> {
    // Get next auto ID for this server
    const nextAutoId = this.serverNextAutoId.get(serverName) || 1;
    const connId = String(nextAutoId);

    // Increment for next time
    this.serverNextAutoId.set(serverName, nextAutoId + 1);

    return this.getConnection(serverName, config, connId);
  }

  /**
   * Internal method to create a new connection
   */
  private async createConnection(serverName: string, config: MCPServerConfig, connId?: string): Promise<ConnectionInfo> {
    const key = getConnectionKey(serverName, connId);
    const connection = await this.client.connect(serverName, config, key, this.logger, this.roots);
    const id = this.nextId++;
    const now = Date.now();

    // Log any stderr output from initial connection (but don't clear it so caller can access it)
    const stderr = this.client.getStderr(connection, false);
    if (stderr) {
      console.error(`[${key}] stderr during connection:\n${stderr}`);
    }

    const info: ConnectionInfo = {
      id,
      server: serverName,
      connId,
      connection,
      status: 'connected',
      connectedAt: now,
      lastUsed: now,
      closedAt: null,
    };

    this.connections.set(key, connection);
    this.connectionInfo.set(id, info);
    this.keyToId.set(key, id);
    this.idToKey.set(id, key);
    this.configs.set(key, config);

    // New connection - always kick off async cache refresh check
    this.refreshCacheAsync(serverName, connection);

    return info;
  }

  /**
   * Async cache refresh - always runs on first connection
   * Fire-and-forget, does not block the caller
   */
  private refreshCacheAsync(serverName: string, connection: MCPConnection): void {
    // Don't refresh if already refreshing this server
    if (this.refreshingServers.has(serverName)) {
      return;
    }

    this.refreshingServers.add(serverName);

    // Fire and forget - fetch tools and update cache
    // Use .catch() to ensure no unhandled rejections
    this.doRefreshCache(serverName, connection).catch((error) => {
      console.error(`[${serverName}] Background cache refresh failed:`, error);
    });
  }

  /**
   * Internal cache refresh implementation
   */
  private async doRefreshCache(serverName: string, connection: MCPConnection): Promise<void> {
    try {
      const response = await connection.client.listTools();
      const tools = response.tools || [];
      await this.schemaCache.set(serverName, tools);
    } finally {
      this.refreshingServers.delete(serverName);
    }
  }

  /**
   * Sync cache refresh - blocks until cache is updated
   * Called when TTL is expired and fresh data is required
   */
  async refreshCacheSync(serverName: string): Promise<void> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      return;
    }

    try {
      const response = await connection.client.listTools();
      const tools = response.tools || [];
      await this.schemaCache.set(serverName, tools);
    } catch (error) {
      console.error(`[${serverName}] Sync cache refresh failed:`, error);
      throw error;
    }
  }

  /**
   * Disconnect a specific server connection
   * Returns the ConnectionInfo with updated status
   * @param serverName - The server name from config
   * @param connId - Optional connection instance ID
   */
  async disconnect(serverName: string, connId?: string): Promise<ConnectionInfo | null> {
    const key = getConnectionKey(serverName, connId);
    const connection = this.connections.get(key);
    const id = this.keyToId.get(key);

    if (connection && id !== undefined) {
      await this.client.disconnect(connection);

      // Log disconnect
      if (this.logger) {
        logServerDisconnect(this.logger, serverName, key);
      }

      const info = this.connectionInfo.get(id);
      if (info) {
        info.status = 'disconnected';
        info.closedAt = Date.now();

        // Clean up all maps including connectionInfo to prevent memory leak
        this.connections.delete(key);
        this.keyToId.delete(key);
        this.idToKey.delete(id);
        this.configs.delete(key);
        this.connectionInfo.delete(id);

        return info;
      }
    }

    return null;
  }

  /**
   * Disconnect by connection ID
   */
  async disconnectById(id: number): Promise<ConnectionInfo | null> {
    const key = this.idToKey.get(id);
    if (key) {
      const { server, connId } = parseConnectionKey(key);
      return this.disconnect(server, connId);
    }
    return null;
  }

  /**
   * Disconnect all servers
   */
  async disconnectAll(): Promise<void> {
    const promises: Promise<ConnectionInfo | null>[] = [];
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
    for (const id of this.keyToId.values()) {
      const info = this.connectionInfo.get(id);
      if (info && info.status === 'connected') {
        result.push(info);
      }
    }
    return result;
  }

  /**
   * Get stderr output from a connection
   */
  getStderr(connection: MCPConnection, clear = false): string {
    return this.client.getStderr(connection, clear);
  }

  /**
   * Get list of connections for a specific server (all instances)
   */
  listServerConnections(serverName: string): ConnectionInfo[] {
    const result: ConnectionInfo[] = [];
    for (const [key, id] of this.keyToId.entries()) {
      const { server } = parseConnectionKey(key);
      if (server === serverName) {
        const info = this.connectionInfo.get(id);
        if (info && info.status === 'connected') {
          result.push(info);
        }
      }
    }
    return result;
  }

  /**
   * Get connection info by ID
   */
  getConnectionById(id: number): ConnectionInfo | null {
    return this.connectionInfo.get(id) || null;
  }

  /**
   * Get connection info by server name and optional connId
   */
  getConnectionByServer(serverName: string, connId?: string): ConnectionInfo | null {
    const key = getConnectionKey(serverName, connId);
    const id = this.keyToId.get(key);
    if (id !== undefined) {
      return this.connectionInfo.get(id) || null;
    }
    return null;
  }

  /**
   * Get the actual MCPConnection for a server (for internal use)
   */
  getRawConnection(serverName: string, connId?: string): MCPConnection | null {
    const info = this.getConnectionByServer(serverName, connId);
    if (info && info.status === 'connected') {
      // Update last used
      info.lastUsed = Date.now();
      return info.connection;
    }
    return null;
  }

  /**
   * Reconnect a specific server connection
   */
  async reconnect(serverName: string, connId?: string): Promise<ConnectionInfo> {
    const key = getConnectionKey(serverName, connId);
    const config = this.configs.get(key);
    if (!config) {
      throw new Error(`No configuration found for connection: ${key}`);
    }

    // Disconnect if connected
    await this.disconnect(serverName, connId);

    // Reconnect
    return this.getConnection(serverName, config, connId);
  }

  /**
   * Clean up stale connections (not used for TTL_MS)
   */
  private async cleanupStale(): Promise<void> {
    const now = Date.now();
    const toRemove: Array<{ server: string; connId?: string }> = [];

    for (const [key, id] of this.keyToId.entries()) {
      const info = this.connectionInfo.get(id);
      if (info && info.status === 'connected') {
        if (now - info.lastUsed > this.idleTimeoutMs) {
          toRemove.push(parseConnectionKey(key));
        }
      }
    }

    for (const { server, connId } of toRemove) {
      await this.disconnect(server, connId);
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
   * Update roots that will be forwarded to managed servers
   * This should be called when roots change from the MCP client
   */
  updateRoots(roots: string[]): void {
    this.roots = roots;
  }

  /**
   * Get current roots
   */
  getRoots(): string[] | undefined {
    return this.roots;
  }

  /**
   * Shutdown the pool
   */
  async shutdown(): Promise<void> {
    this.stopCleanup();
    await this.disconnectAll();
  }
}
