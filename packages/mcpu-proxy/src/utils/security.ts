import * as fs from 'fs/promises';
import * as path from 'path';
import { MCPServer, SecurityConfig, GlobalSecurityConfig } from '../types';
import { createChildLogger } from './logger';
import { configManager } from '../config';

const logger = createChildLogger('Security');

export class SecurityManager {
  private securityConfig: GlobalSecurityConfig;

  constructor() {
    this.securityConfig = configManager.getSecurityConfig();
  }

  async validateServerConfig(server: MCPServer): Promise<boolean> {
    const config = server.config.security;

    // Check network access
    if (config.networkAccess && this.securityConfig.defaultDeny) {
      logger.warn(`Server ${server.id} requests network access but default deny is enabled`);
      return false;
    }

    // Check filesystem access
    if (config.filesystemAccess) {
      if (!this.isPathAllowed(config.allowedPaths || [])) {
        logger.warn(`Server ${server.id} requests filesystem access to disallowed paths`);
        return false;
      }
    }

    // Validate resource limits
    if (config.resourceLimits) {
      if (!this.validateResourceLimits(config.resourceLimits)) {
        logger.warn(`Server ${server.id} has invalid resource limits`);
        return false;
      }
    }

    return true;
  }

  private isPathAllowed(paths: string[]): boolean {
    // In a real implementation, this would check against a whitelist
    // For now, deny all filesystem access if default deny is enabled
    return !this.securityConfig.defaultDeny || paths.length === 0;
  }

  private validateResourceLimits(limits: any): boolean {
    if (limits.maxMemory && limits.maxMemory < 0) return false;
    if (limits.maxCpu && (limits.maxCpu < 0 || limits.maxCpu > 100)) return false;
    if (limits.timeout && limits.timeout < 0) return false;
    return true;
  }

  async createSandboxEnvironment(server: MCPServer): Promise<NodeJS.ProcessEnv> {
    const baseEnv = { ...process.env };

    // Remove sensitive environment variables
    const sensitiveVars = [
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'GOOGLE_API_KEY',
      'OPENAI_API_KEY',
      // Add more as needed
    ];

    sensitiveVars.forEach(key => delete baseEnv[key]);

    // Add server-specific environment variables
    Object.assign(baseEnv, server.config.environment);

    // Set resource limits if configured
    if (server.config.security.resourceLimits) {
      // In a real implementation, this would set actual process limits
      logger.info(`Setting resource limits for server ${server.id}`);
    }

    return baseEnv;
  }

  async auditLog(action: string, details: Record<string, any>): Promise<void> {
    if (!this.securityConfig.auditLogging) return;

    const logEntry = {
      timestamp: new Date(),
      action,
      details,
      user: process.env.USER || 'unknown'
    };

    const auditLogPath = path.join(configManager.getDataDir(), 'audit.log');

    try {
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      await fs.appendFile(auditLogPath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      logger.error('Failed to write audit log:', error);
    }
  }

  async performSecurityScan(server: MCPServer): Promise<SecurityScanResult> {
    const result: SecurityScanResult = {
      passed: true,
      issues: []
    };

    // Check for common security issues
    if (server.source.type === 'npm' && server.source.url.includes('http://')) {
      result.issues.push({
        severity: 'high',
        message: 'HTTP URL detected - should use HTTPS for package sources'
      });
    }

    if (server.config.security.networkAccess && server.config.security.filesystemAccess) {
      result.issues.push({
        severity: 'medium',
        message: 'Server has both network and filesystem access - consider principle of least privilege'
      });
      result.passed = false;
    }

    if (result.issues.some(issue => issue.severity === 'high')) {
      result.passed = false;
    }

    return result;
  }

  async quarantineServer(serverId: string, reason: string): Promise<void> {
    logger.warn(`Quarantining server ${serverId}: ${reason}`);
    // In a real implementation, this would move the server to a quarantine state
    // and prevent it from running
  }
}

export interface SecurityScanResult {
  passed: boolean;
  issues: SecurityIssue[];
}

export interface SecurityIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
}