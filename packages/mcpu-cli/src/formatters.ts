/**
 * Text formatters for MCP structures
 *
 * Converts structured MCP responses (tools, resources, etc.) into
 * concise, human-readable text format while preserving essential information.
 *
 * Design principles:
 * - Show enough detail to use the feature without consulting raw schema
 * - Keep output concise and scannable
 * - Follow MCP spec for complete field coverage
 * - Consistent formatting across all MCP types
 */

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ResolvedAutoSaveConfig } from './config.ts';

/**
 * Try to compact a JSON string by parsing and re-stringifying without indentation.
 * Returns the original string if it's not valid JSON.
 */
export function compactJson(text: string): string {
  const trimmed = text.trim();
  // Quick check: must start with { or [ to be JSON
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return text;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

/**
 * Type abbreviation map: full type name -> single letter code
 * Arrays use [] suffix notation (e.g., S[], O[])
 */
const TYPE_ABBREV: Record<string, string> = {
  'string': 'S',
  'integer': 'I',
  'number': 'N',
  'null': 'Z',
  'boolean': 'B',
  'object': 'O',
};

/** Section header for legend */
export const LEGEND_HEADER = '# Legend';

/** Types abbreviation line */
export const TYPES_LINE = 'Types: S=string, I=integer, N=number, Z=null, B=bool, O=object';

/**
 * Abbreviate type names to single-letter codes
 */
export function abbreviateType(type: string): string {
  return TYPE_ABBREV[type] || type;
}

/**
 * Extract enum/range value from a property schema
 * Returns the extracted value string or null if not found
 */
export function extractEnumOrRange(propSchema: any): string | null {
  // Check schema enum first
  if (propSchema.enum) {
    return propSchema.enum.join('|');
  }

  if (propSchema.description) {
    // Try to extract enum-like patterns from description
    const enumMatch = propSchema.description.match(/(?:Type|Enum|Status|Values?|Options?|Allowed|One of):\s*([a-zA-Z0-9_-]+(?:\s*\|\s*[a-zA-Z0-9_-]+)+)/i);
    if (enumMatch) {
      return enumMatch[1].replace(/\s+/g, '');
    }

    // Try to extract range patterns
    const rangeMatch = propSchema.description.match(/(?:Values?|Range):\s*(\d+)\s*-\s*(\d+)/i);
    if (rangeMatch) {
      return `${rangeMatch[1]}-${rangeMatch[2]}`;
    }
  }

  return null;
}

/**
 * Recursively extract all enums from a schema property
 */
function extractEnumsFromSchema(schema: any, enumCounts: Map<string, number>): void {
  if (!schema || typeof schema !== 'object') return;

  // Check this schema for enum
  const enumValue = extractEnumOrRange(schema);
  if (enumValue && enumValue.includes('|')) {
    enumCounts.set(enumValue, (enumCounts.get(enumValue) || 0) + 1);
  }

  // Recurse into object properties
  if (schema.properties) {
    for (const prop of Object.values(schema.properties)) {
      extractEnumsFromSchema(prop, enumCounts);
    }
  }

  // Recurse into array items
  if (schema.items) {
    extractEnumsFromSchema(schema.items, enumCounts);
  }
}

/**
 * Collect all enums from tools for deduplication
 * Returns a map of enum value -> reference name (E1, E2, etc.)
 */
export function collectEnums(tools: Tool[]): Map<string, string> {
  const enumCounts = new Map<string, number>();

  // Count occurrences of each enum (recursively)
  for (const tool of tools) {
    if (!tool.inputSchema || typeof tool.inputSchema !== 'object') continue;
    extractEnumsFromSchema(tool.inputSchema, enumCounts);

    // Also check outputSchema if present
    const toolAny = tool as any;
    if (toolAny.outputSchema) {
      extractEnumsFromSchema(toolAny.outputSchema, enumCounts);
    }
  }

  // Create references for enums that appear more than once or are long
  const enumRefs = new Map<string, string>();
  let refIndex = 1;

  for (const [enumValue, count] of enumCounts.entries()) {
    // Create reference if used more than once or if it's long (> 20 chars)
    if (count > 1 || enumValue.length > 20) {
      enumRefs.set(enumValue, `@E${refIndex}`);
      refIndex++;
    }
  }

  return enumRefs;
}

/**
 * Format enum legend for output header
 */
export function formatEnumLegend(enumRefs: Map<string, string>): string {
  if (enumRefs.size === 0) return '';

  const lines: string[] = [];
  for (const [enumValue, ref] of enumRefs.entries()) {
    lines.push(`${ref}: ${enumValue}`);
  }
  return lines.join('\n');
}

/**
 * Generate object shape string from schema properties
 */
function generateObjectShape(schema: any, enumRefs?: Map<string, string>, depth: number = 1): string {
  if (!schema.properties || depth <= 0) return 'O';

  const props = schema.properties;
  const requiredFields = schema.required || [];
  const fields = Object.keys(props).map(key => {
    const req = requiredFields.includes(key) ? '' : '?';
    const fieldSchema = props[key];
    return `${key}${req}:${formatParamTypeInternal(fieldSchema, enumRefs, undefined, depth - 1)}`;
  }).join(', ');
  return `O{${fields}}`;
}

/**
 * Get enum display value - use E1, E2 ref if available, otherwise full value
 */
function getEnumDisplay(enumValue: string, enumRefs?: Map<string, string>): string {
  if (enumRefs) {
    const ref = enumRefs.get(enumValue);
    if (ref) return ref;
  }
  return enumValue;
}

/**
 * Format a type (handles union types and abbreviation)
 */
function formatType(type: any): string {
  if (Array.isArray(type)) {
    return type.map(abbreviateType).join('|');
  }
  return abbreviateType(type || 'any');
}

/**
 * Internal implementation of formatParamType
 */
function formatParamTypeInternal(
  propSchema: any,
  enumRefs?: Map<string, string>,
  _unused?: any,
  depth: number = 1
): string {
  let typeStr = propSchema.type || 'any';

  // Handle enums from schema - use @E1, @E2 ref if available
  if (propSchema.enum) {
    const enumValue = propSchema.enum.join('|');
    return getEnumDisplay(enumValue, enumRefs);
  }

  // Check for enums/ranges extracted from description (before union types)
  const extracted = extractEnumOrRange(propSchema);
  if (extracted) {
    // If it's a range like "0-4", return it directly
    if (/^\d+-\d+$/.test(extracted)) {
      return extracted;
    }
    // Use ref if available, otherwise return the extracted enum directly
    return getEnumDisplay(extracted, enumRefs);
  }

  // Handle union types - but check for object properties first
  if (Array.isArray(typeStr)) {
    // If union includes 'object' and has properties, show them
    if (typeStr.includes('object') && propSchema.properties && depth > 0) {
      const shape = generateObjectShape(propSchema, enumRefs, depth);
      const hasNull = typeStr.includes('null');
      return hasNull ? `Z|${shape}` : shape;
    }
    typeStr = typeStr.map(abbreviateType).join('|');
    return typeStr;
  }

  // Handle arrays with item details
  if (propSchema.type === 'array' && propSchema.items) {
    const items = propSchema.items;

    // Handle union types in array items (e.g., ['null', 'object'])
    if (Array.isArray(items.type)) {
      // Nullable array of objects
      if (items.type.includes('object') && items.type.includes('null')) {
        if (items.properties && depth > 0) {
          return `Z|${generateObjectShape(items, enumRefs, depth)}[]`;
        }
        return 'Z|O[]';
      }
      // Other union - just format the types
      return `${formatType(items.type)}[]`;
    }

    // Simple array types
    if (items.type && items.type !== 'object') {
      return `${abbreviateType(items.type)}[]`;
    }

    // Array of objects - show structure if depth > 0
    if (items.type === 'object' && items.properties && depth > 0) {
      return `${generateObjectShape(items, enumRefs, depth)}[]`;
    }

    return `${abbreviateType('object')}[]`;
  }

  // Handle objects with properties - show structure if depth > 0
  if (propSchema.type === 'object' && propSchema.properties && depth > 0) {
    return generateObjectShape(propSchema, enumRefs, depth);
  }

  // Object without properties or depth exhausted
  if (propSchema.type === 'object') {
    return abbreviateType('object');
  }

  return abbreviateType(typeStr);
}

/**
 * Format JSON Schema type into a concise abbreviated type string
 *
 * Examples:
 * - string → "S"
 * - array of strings → "S[]"
 * - enum → "@E1" or "option1|option2|option3"
 * - object → "O{field1:S, field2:I}"
 * - array of objects → "O{field1:S, field2:I}[]"
 *
 * @param propSchema - JSON Schema property
 * @param enumRefs - Optional map of enum values to references (@E1, @E2, etc.)
 * @param _unused - Deprecated, kept for API compatibility
 * @param depth - How many levels of object properties to show (default 1)
 */
export function formatParamType(
  propSchema: any,
  enumRefs?: Map<string, string>,
  _unused?: any,
  depth: number = 1
): string {
  return formatParamTypeInternal(propSchema, enumRefs, undefined, depth);
}

/**
 * Format MCP Tool into concise human-readable text
 *
 * Uses all MCP spec fields:
 * - name, title (optional UI-friendly name)
 * - description
 * - inputSchema (parameters with nested structures)
 * - outputSchema (optional return type)
 * - annotations (hints like destructive, readOnly, openWorld, idempotent)
 *
 * @param tool - MCP Tool object from tools/list
 * @param enumRefs - Optional map of enum values to references (@E1, @E2, etc.)
 * @returns Human-readable text representation
 */
export function formatToolInfo(tool: Tool, enumRefs?: Map<string, string>): string {
  const toolAny = tool as any;
  let output = '';

  // Header: # tool_name (with title if different)
  output += `# ${tool.name}\n`;
  if (toolAny.title && toolAny.title !== tool.name) {
    output += `(${toolAny.title})\n`;
  }
  output += '\n';

  // Description
  if (tool.description) {
    output += `${tool.description}\n\n`;
  }

  // Annotations (important behavioral hints)
  if (toolAny.annotations) {
    const hints = [];
    if (toolAny.annotations.readOnlyHint === true) hints.push('read-only');
    if (toolAny.annotations.destructiveHint === true) hints.push('destructive');
    if (toolAny.annotations.openWorldHint === true) hints.push('open-world');
    if (toolAny.annotations.idempotentHint === true) hints.push('idempotent');

    if (hints.length > 0) {
      output += `Hints: ${hints.join(', ')}\n\n`;
    }
  }

  // Input parameters
  const schema = tool.inputSchema as any;
  if (schema && schema.properties) {
    const properties = schema.properties;
    const required = schema?.required || [];

    output += 'ARGS:\n';

    if (Object.keys(properties).length === 0) {
      output += '  (none)\n';
    } else {
      // Sort: required args first, then optional
      const entries = Object.entries(properties);
      const sortedEntries = [
        ...entries.filter(([name]) => required.includes(name)),
        ...entries.filter(([name]) => !required.includes(name)),
      ];

      for (const [name, prop] of sortedEntries) {
        const propSchema = prop as any;
        const requiredMark = required.includes(name) ? '' : '?';

        // Build type string with nested structure details (depth=2 for ARGS)
        const typeStr = formatParamType(propSchema, enumRefs, undefined, 2);

        // Get default value from schema or extract from description
        let defaultStr = '';
        let description = propSchema.description || '';

        if (propSchema.default !== undefined) {
          const defVal = typeof propSchema.default === 'string'
            ? propSchema.default
            : JSON.stringify(propSchema.default);
          defaultStr = `=${defVal}`;
        } else if (description) {
          // Extract default from description like "(default: xxx)" or "(default xxx)"
          const defaultMatch = description.match(/\(default:?\s*([^)]+)\)/i);
          if (defaultMatch) {
            defaultStr = `=${defaultMatch[1].trim()}`;
            // Strip the default from description since we show it as =value
            description = description.replace(/\s*\(default:?\s*[^)]+\)/i, '').trim();
          }
        }

        // If we're using an enum (ref or inline) or range, strip redundant patterns from description
        const hasEnumOrRange = typeStr.startsWith('@E') || /^\d+-\d+$/.test(typeStr) || /^[a-zA-Z0-9_-]+\|[a-zA-Z0-9_|-]+$/.test(typeStr);
        if (hasEnumOrRange) {
          // Strip patterns like "Type: a|b|c" or "Status: a|b|c" or "Values: 0-4"
          description = description.replace(/(?:Type|Enum|Status|Values?|Options?|Allowed|One of|Range):\s*[a-zA-Z0-9_|-]+(\s*\|\s*[a-zA-Z0-9_-]+)*/gi, '').trim();
          description = description.replace(/(?:Values?|Range):\s*\d+\s*-\s*\d+/gi, '').trim();
          // Clean up any leftover " - " at start or end
          description = description.replace(/^-\s*/, '').replace(/\s*-\s*$/, '').trim();
        }

        const desc = description ? ` - ${description}` : '';

        output += `  ${name}${requiredMark}: ${typeStr}${defaultStr}${desc}\n`;
      }
    }
    output += '\n';
  }

  // Output schema (if specified) - simplified return type (depth=1)
  if (toolAny.outputSchema) {
    output += `-> ${formatParamType(toolAny.outputSchema, enumRefs, undefined, 1)}\n\n`;
  }

  return output;
}

/**
 * Format MCP response content for human-readable display
 *
 * Unwraps standard MCP response format and extracts meaningful content
 * according to the MCP spec content types: text, image, resource
 *
 * JSON text content is automatically compacted to reduce output size.
 *
 * @param response - MCP response with content array
 * @returns Formatted text output
 */
export function formatMcpResponse(response: unknown): string {
  // Handle non-object responses
  if (typeof response === 'string') {
    return compactJson(response);
  }

  if (typeof response !== 'object' || response === null) {
    return String(response);
  }

  const mcpResponse = response as any;

  // Check for error responses
  if (mcpResponse.isError === true) {
    const errorText = mcpResponse.content?.[0]?.text || 'Unknown error';
    throw new Error(errorText);
  }

  // Handle standard MCP response with content array
  if ('content' in mcpResponse && Array.isArray(mcpResponse.content)) {
    const content = mcpResponse.content;
    const parts: string[] = [];

    for (const item of content) {
      if (item.type === 'text' && item.text) {
        // Compact JSON text to reduce output size
        parts.push(compactJson(item.text));
      } else if (item.type === 'image') {
        parts.push(`[Image: ${item.mimeType || 'unknown type'}]`);
      } else if (item.type === 'resource') {
        const resourceInfo = [`[Resource: ${item.uri || 'unknown'}]`];
        if (item.text) {
          resourceInfo.push(compactJson(item.text));
        }
        parts.push(resourceInfo.join('\n'));
      }
    }

    return parts.join('\n');
  }

  // Fallback: stringify the response (compact)
  return JSON.stringify(response);
}

/**
 * Result of auto-save response check
 */
export interface AutoSaveResult {
  /** Whether the response was saved to file */
  saved: boolean;
  /** The output to return (truncated preview or original) */
  output: string;
  /** Path to manifest file (if saved) */
  manifestPath?: string;
  /** Paths to all extracted files */
  extractedFiles?: string[];
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
  };
  return mimeToExt[mimeType] || 'bin';
}

/**
 * Check if text content is valid JSON
 */
function isJsonContent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract and save MCP response content to files
 *
 * @param response - Raw MCP response object
 * @param server - Server name
 * @param tool - Tool name
 * @param config - Resolved auto-save configuration
 * @param cwd - Working directory for relative paths
 * @returns AutoSaveResult with formatted output and file paths
 */
export async function autoSaveResponse(
  response: unknown,
  server: string,
  tool: string,
  config: ResolvedAutoSaveConfig,
  cwd: string
): Promise<AutoSaveResult> {
  // Format response for size check
  const formattedResponse = formatMcpResponse(response);
  const responseSize = Buffer.byteLength(formattedResponse, 'utf-8');

  // Check if response exceeds threshold
  if (responseSize <= config.thresholdSize) {
    return { saved: false, output: formattedResponse };
  }

  const mcpResponse = response as any;

  // Check for standard MCP response with content array
  if (!mcpResponse?.content || !Array.isArray(mcpResponse.content)) {
    // Not a standard MCP response, save as plain text
    return await saveSimpleResponse(formattedResponse, server, tool, config, cwd);
  }

  const timestamp = Date.now();
  const baseFilename = `${server}-${tool}-${timestamp}`;
  const responseDir = join(cwd, config.dir);

  // Ensure directory exists
  await mkdir(responseDir, { recursive: true });

  const extractedFiles: string[] = [];
  const manifest = { ...mcpResponse, content: [] as any[] };

  // Track content type counts for multi-item indexing
  const typeCounts: Record<string, number> = { text: 0, image: 0 };

  for (const item of mcpResponse.content) {
    if (item.type === 'text' && item.text) {
      // Extract text content
      const index = typeCounts.text++;
      const suffix = typeCounts.text > 1 || mcpResponse.content.filter((i: any) => i.type === 'text').length > 1 ? `-${index}` : '';

      // Determine if JSON and format accordingly
      const isJson = isJsonContent(item.text);
      const ext = isJson ? 'json' : 'txt';
      const filename = `${baseFilename}${suffix}.${ext}`;
      const filePath = join(responseDir, filename);

      // Pretty-print JSON, save text as-is
      const content = isJson ? JSON.stringify(JSON.parse(item.text), null, 2) : item.text;
      await writeFile(filePath, content, 'utf-8');

      extractedFiles.push(filePath);
      manifest.content.push({ type: 'text', _extracted: filename });

    } else if (item.type === 'image' && item.data) {
      // Extract and decode image content
      const index = typeCounts.image++;
      const suffix = typeCounts.image > 1 || mcpResponse.content.filter((i: any) => i.type === 'image').length > 1 ? `-${index}` : '';

      const ext = getExtensionFromMimeType(item.mimeType || 'application/octet-stream');
      const filename = `${baseFilename}${suffix}.${ext}`;
      const filePath = join(responseDir, filename);

      // Decode base64 and save binary
      const buffer = Buffer.from(item.data, 'base64');
      await writeFile(filePath, buffer);

      extractedFiles.push(filePath);
      manifest.content.push({
        type: 'image',
        mimeType: item.mimeType,
        _extracted: filename
      });

    } else {
      // Resource or other types - keep as-is in manifest
      manifest.content.push(item);
    }
  }

  // Save manifest JSON
  const manifestFilename = `${baseFilename}.json`;
  const manifestPath = join(responseDir, manifestFilename);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  // Generate preview output
  const sizeKB = (responseSize / 1024).toFixed(1);
  const relativeDir = config.dir;

  const fileList = extractedFiles.map(f => `  - ${join(relativeDir, f.split('/').pop()!)}`).join('\n');
  const preview = formattedResponse.slice(0, config.previewSize);

  const truncatedOutput = `[Response ${sizeKB}KB - extracted to ${relativeDir}/]

Files:
  - ${manifestFilename} (manifest)
${fileList}

Preview (first ${config.previewSize} chars):
${preview}${formattedResponse.length > config.previewSize ? '...' : ''}

Use \`grep\` or \`read\` to explore the files.`;

  return {
    saved: true,
    output: truncatedOutput,
    manifestPath,
    extractedFiles,
  };
}

/**
 * Save a simple (non-MCP structured) response
 */
async function saveSimpleResponse(
  content: string,
  server: string,
  tool: string,
  config: ResolvedAutoSaveConfig,
  cwd: string
): Promise<AutoSaveResult> {
  const timestamp = Date.now();
  const isJson = isJsonContent(content);
  const ext = isJson ? 'json' : 'txt';
  const filename = `${server}-${tool}-${timestamp}.${ext}`;
  const responseDir = join(cwd, config.dir);
  const filePath = join(responseDir, filename);

  await mkdir(responseDir, { recursive: true });

  // Pretty-print JSON, save text as-is
  const toSave = isJson ? JSON.stringify(JSON.parse(content), null, 2) : content;
  await writeFile(filePath, toSave, 'utf-8');

  const sizeKB = (Buffer.byteLength(content, 'utf-8') / 1024).toFixed(1);
  const preview = content.slice(0, config.previewSize);
  const relativePath = join(config.dir, filename);

  const truncatedOutput = `[Response ${sizeKB}KB saved to ${relativePath}]

Preview (first ${config.previewSize} chars):
${preview}${content.length > config.previewSize ? '...' : ''}

Use \`grep\` or \`read\` to explore the file.`;

  return {
    saved: true,
    output: truncatedOutput,
    extractedFiles: [filePath],
  };
}
