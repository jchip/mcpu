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

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Format JSON Schema type into a concise type string
 *
 * Examples:
 * - string → "string"
 * - array of strings → "string[]"
 * - enum → "enum(option1|option2|option3)"
 * - object → "{field1:type1, field2:type2}"
 * - array of objects → "array[{field1:type1, field2:type2}]"
 */
export function formatParamType(propSchema: any): string {
  let typeStr = propSchema.type || 'any';

  // Handle union types
  if (Array.isArray(typeStr)) {
    typeStr = typeStr.join('|');
  }

  // Handle enums
  if (propSchema.enum) {
    return `enum(${propSchema.enum.join('|')})`;
  }

  // Handle arrays with item details
  if (propSchema.type === 'array' && propSchema.items) {
    const items = propSchema.items;

    // Simple array types
    if (items.type && items.type !== 'object') {
      return `${items.type}[]`;
    }

    // Array of objects - show structure with enum details
    if (items.type === 'object' && items.properties) {
      const props = items.properties;
      const requiredFields = items.required || [];
      const fields = Object.keys(props).map(key => {
        const req = requiredFields.includes(key) ? '' : '?';
        const fieldSchema = props[key];

        // Show enum if present
        if (fieldSchema.enum) {
          return `${key}${req}:enum(${fieldSchema.enum.join('|')})`;
        }

        const propType = fieldSchema.type || 'any';
        return `${key}${req}:${propType}`;
      }).join(', ');
      return `array[{${fields}}]`;
    }

    return 'object[]';
  }

  // Handle objects with properties
  if (propSchema.type === 'object' && propSchema.properties) {
    const props = propSchema.properties;
    const requiredFields = propSchema.required || [];
    const fields = Object.keys(props).map(key => {
      const req = requiredFields.includes(key) ? '' : '?';
      const fieldSchema = props[key];

      // Show enum if present
      if (fieldSchema.enum) {
        return `${key}${req}:enum(${fieldSchema.enum.join('|')})`;
      }

      const propType = fieldSchema.type || 'any';
      return `${key}${req}:${propType}`;
    }).join(', ');
    return `{${fields}}`;
  }

  return typeStr;
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
 * @param serverName - Server name for usage examples
 * @returns Human-readable text representation
 */
export function formatToolInfo(tool: Tool, serverName: string): string {
  const toolAny = tool as any;
  let output = '';

  // Header: use title if available, otherwise name
  const displayName = toolAny.title || tool.name;
  output += `\n${displayName}\n`;
  if (toolAny.title && toolAny.title !== tool.name) {
    output += `(${tool.name})\n`;
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

    output += 'Parameters:\n';

    if (Object.keys(properties).length === 0) {
      output += '  (none)\n';
    } else {
      for (const [name, prop] of Object.entries(properties)) {
        const propSchema = prop as any;
        const requiredMark = required.includes(name) ? '' : '?';

        // Build type string with nested structure details
        const typeStr = formatParamType(propSchema);
        const desc = propSchema.description ? ` - ${propSchema.description}` : '';
        const defaultVal = propSchema.default !== undefined ? ` (default: ${JSON.stringify(propSchema.default)})` : '';

        output += `  ${name}${requiredMark}: ${typeStr}${desc}${defaultVal}\n`;
      }
    }
    output += '\n';
  }

  // Output schema (if specified)
  if (toolAny.outputSchema) {
    const outSchema = toolAny.outputSchema;
    let outType = outSchema.type || 'any';
    if (Array.isArray(outType)) {
      outType = outType.join('|');
    }
    output += `Returns: ${outType}\n\n`;
  }

  // Usage example
  output += 'Usage:\n';
  output += `  mcpu call ${serverName} ${tool.name}\n\n`;

  return output;
}

/**
 * Format MCP response content for human-readable display
 *
 * Unwraps standard MCP response format and extracts meaningful content
 * according to the MCP spec content types: text, image, resource
 *
 * @param response - MCP response with content array
 * @returns Formatted text output
 */
export function formatMcpResponse(response: unknown): string {
  // Handle non-object responses
  if (typeof response === 'string') {
    return response;
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
        parts.push(item.text);
      } else if (item.type === 'image') {
        parts.push(`[Image: ${item.mimeType || 'unknown type'}]`);
      } else if (item.type === 'resource') {
        const resourceInfo = [`[Resource: ${item.uri || 'unknown'}]`];
        if (item.text) {
          resourceInfo.push(item.text);
        }
        parts.push(resourceInfo.join('\n'));
      }
    }

    return parts.join('\n');
  }

  // Fallback: stringify the response
  return JSON.stringify(response, null, 2);
}
