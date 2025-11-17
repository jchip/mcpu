export interface MCPServer {
  id: string;
  name: string;
  namespace: string;
  version: string;
  description?: string;
  source: ServerSource;
  installPath?: string;
  config: ServerConfig;
  status: ServerStatus;
  metadata: ServerMetadata;
}

export interface ServerSource {
  type: 'npm' | 'pip' | 'docker' | 'git' | 'binary' | 'local';
  url: string;
  version?: string;
  checksum?: string;
  signature?: string;
}

export interface ServerConfig {
  capabilities: ServerCapabilities;
  environment: Record<string, string>;
  args: string[];
  transport: 'stdio' | 'websocket';
  security: SecurityConfig;
}

export interface ServerCapabilities {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
  logging?: boolean;
  sampling?: boolean;
}

export interface SecurityConfig {
  networkAccess: boolean;
  filesystemAccess: boolean;
  allowedPaths?: string[];
  environmentIsolation: boolean;
  resourceLimits?: ResourceLimits;
}

export interface ResourceLimits {
  maxMemory?: number;
  maxCpu?: number;
  timeout?: number;
}

export type ServerStatus = 'installed' | 'running' | 'stopped' | 'error' | 'updating';

export interface ServerMetadata {
  installedAt: Date;
  lastUsed?: Date;
  healthChecks: HealthCheck[];
  auditLog: AuditEntry[];
}

export interface HealthCheck {
  timestamp: Date;
  status: 'healthy' | 'unhealthy' | 'unknown';
  responseTime?: number;
  error?: string;
}

export interface AuditEntry {
  timestamp: Date;
  action: string;
  user?: string;
  details: Record<string, any>;
}

export interface MCPRegistry {
  id: string;
  name: string;
  url: string;
  type: 'official' | 'community' | 'enterprise';
  format: 'yaml' | 'json';
  lastSync?: Date;
  servers: RegistryServer[];
}

export interface RegistryServer {
  name: string;
  namespace: string;
  version: string;
  description?: string;
  source: ServerSource;
  tags?: string[];
  author?: string;
  homepage?: string;
}

export interface ClientProfile {
  id: string;
  name: string;
  clientType: 'claude' | 'cursor' | 'custom';
  configPath?: string;
  servers: ProfileServer[];
  autoSync: boolean;
}

export interface ProfileServer {
  serverId: string;
  enabled: boolean;
  config: ServerConfig;
}

export interface MCPMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: any;
}

export interface ProxyConfig {
  port: number;
  host: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  dataDir: string;
  registries: string[];
  security: GlobalSecurityConfig;
}

export interface GlobalSecurityConfig {
  defaultDeny: boolean;
  auditLogging: boolean;
  sandboxing: boolean;
  allowedRegistries: string[];
}