/**
 * Context Injection - Automatically inject context values (cwd, projectDir) into tool parameters
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ArgsPassThruConfig, ContextKeywords, MCPServerConfig } from '../types.ts';

/**
 * Default keywords for auto-detection
 */
const DEFAULT_CWD_KEYWORDS = [
  'cwd',
  'workingdir',
  'workingdirectory',
  'currentdir',
  'currentdirectory',
];

const DEFAULT_PROJECT_DIR_KEYWORDS = [
  'projectdir',
  'projectdirectory',
  'projectpath',
  'projectroot',
  'rootdir',
  'rootpath',
];

/**
 * Context values available for injection
 */
export interface ContextValues {
  cwd?: string;
  projectDir?: string;
}

/**
 * Config for context injection (resolved from global + server config)
 */
export interface ResolvedContextConfig {
  autoDetectContext: boolean;
  contextKeywords: Required<ContextKeywords>;
  argsPassThru?: ArgsPassThruConfig;
}

/**
 * Resolve context config for a server (merge global + server config)
 */
export function resolveContextConfig(
  globalConfig: {
    autoDetectContext?: boolean;
    contextKeywords?: ContextKeywords;
  },
  serverConfig: MCPServerConfig
): ResolvedContextConfig {
  // Merge autoDetectContext (server > global > default true)
  const autoDetectContext =
    serverConfig.autoDetectContext ??
    globalConfig.autoDetectContext ??
    true;

  // Merge contextKeywords (server > global > defaults)
  const cwdKeywords =
    serverConfig.contextKeywords?.cwd ??
    globalConfig.contextKeywords?.cwd ??
    DEFAULT_CWD_KEYWORDS;

  const projectDirKeywords =
    serverConfig.contextKeywords?.projectDir ??
    globalConfig.contextKeywords?.projectDir ??
    DEFAULT_PROJECT_DIR_KEYWORDS;

  return {
    autoDetectContext,
    contextKeywords: {
      cwd: cwdKeywords,
      projectDir: projectDirKeywords,
    },
    argsPassThru: serverConfig.argsPassThru,
  };
}

/**
 * Check if a parameter name matches any of the keywords (case-insensitive)
 */
function matchesKeyword(paramName: string, keywords: string[]): boolean {
  const lowerParamName = paramName.toLowerCase();
  return keywords.some((keyword) => lowerParamName === keyword.toLowerCase());
}

/**
 * Auto-detect context parameters in tool schema
 * Returns a map of parameter names to context variable names
 */
export function autoDetectContextParams(
  tool: Tool,
  config: ResolvedContextConfig
): Map<string, '$cwd' | '$projectDir'> {
  const detectedParams = new Map<string, '$cwd' | '$projectDir'>();

  if (!config.autoDetectContext) {
    return detectedParams;
  }

  // Get top-level parameters from tool schema
  const schema = tool.inputSchema;
  if (!schema || typeof schema !== 'object' || !('properties' in schema)) {
    return detectedParams;
  }

  const properties = schema.properties as Record<string, any>;

  for (const [paramName, paramDef] of Object.entries(properties)) {
    // Only inject into string parameters
    if (paramDef.type !== 'string') {
      continue;
    }

    // Check for cwd keywords
    if (matchesKeyword(paramName, config.contextKeywords.cwd)) {
      detectedParams.set(paramName, '$cwd');
      continue;
    }

    // Check for projectDir keywords
    if (matchesKeyword(paramName, config.contextKeywords.projectDir)) {
      detectedParams.set(paramName, '$projectDir');
    }
  }

  return detectedParams;
}

/**
 * Set a value at a dot-notation path in an object
 * Creates nested objects as needed
 */
function setAtPath(obj: Record<string, any>, path: string, value: any): void {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Inject context values into tool arguments based on config and auto-detection
 */
export function injectContext(
  tool: Tool,
  toolArgs: Record<string, unknown>,
  contextValues: ContextValues,
  config: ResolvedContextConfig
): Record<string, unknown> {
  // Clone args to avoid mutation
  const injectedArgs = { ...toolArgs };

  // Build injection map from explicit config + auto-detection
  const injectionMap = new Map<string, string>(); // path -> contextValue

  // 1. Auto-detection (lower priority)
  const autoDetected = autoDetectContextParams(tool, config);
  for (const [paramName, varName] of autoDetected.entries()) {
    const value = varName === '$cwd' ? contextValues.cwd : contextValues.projectDir;
    if (value !== undefined) {
      injectionMap.set(paramName, value);
    }
  }

  // 2. Explicit argsPassThru config (higher priority, can override auto-detection)
  if (config.argsPassThru) {
    // Check for exact tool name match
    if (tool.name in config.argsPassThru) {
      const passThru = config.argsPassThru[tool.name];
      const value = passThru.value === '$cwd' ? contextValues.cwd : contextValues.projectDir;
      if (value !== undefined) {
        injectionMap.set(passThru.path, value);
      }
    }

    // Check for wildcard match
    if ('*' in config.argsPassThru) {
      const passThru = config.argsPassThru['*'];
      const value = passThru.value === '$cwd' ? contextValues.cwd : contextValues.projectDir;
      if (value !== undefined) {
        injectionMap.set(passThru.path, value);
      }
    }
  }

  // Apply all injections
  for (const [path, value] of injectionMap.entries()) {
    setAtPath(injectedArgs, path, value);
  }

  return injectedArgs;
}
